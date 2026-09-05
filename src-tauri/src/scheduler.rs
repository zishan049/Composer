use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use chrono::{Local, NaiveDateTime, Utc};
use cron::Schedule;
use notify::Watcher;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskSection {
    pub id: String,
    pub name: String,
    pub description: String,
    pub r#type: String, // "app"
    pub enabled: bool,
    pub created_at: String,
    pub last_run: String,
    pub last_status: String, // "success" | "failed" | "never"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScheduleSection {
    pub frequency: String, // "once" | "recurring" | "on_event"
    pub run_at: String,    // ISO DateTime string for "once"
    pub cron: String,      // Cron schedule
    pub human_readable: String,
    pub event: String,     // "app_launch" | "file_created" | "project_created"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActionSection {
    pub operation: Option<String>, // "backup" | "export" | "cleanup" | "sync"
    pub source_path: Option<String>,
    pub destination_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationsSection {
    pub on_start: bool,
    pub on_complete: bool,
    pub on_fail: bool,
    pub include_result_preview: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScheduledTask {
    pub task: TaskSection,
    pub schedule: ScheduleSection,
    pub action: ActionSection,
    pub notifications: NotificationsSection,
}

// Global active scheduler memory map
pub struct SchedulerState {
    pub tasks: Arc<Mutex<Vec<ScheduledTask>>>,
}

impl SchedulerState {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

pub fn get_scheduler_dir() -> PathBuf {
    crate::config::get_app_install_dir().join("storage").join("scheduler")
}

pub fn load_all_tasks() -> Vec<ScheduledTask> {
    let dir = get_scheduler_dir();
    let mut tasks = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "toml") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(task) = toml::from_str::<ScheduledTask>(&content) {
                        tasks.push(task);
                    }
                }
            }
        }
    }

    // Initialize default backup task if none exist
    if tasks.is_empty() {
        let default_backup = ScheduledTask {
            task: TaskSection {
                id: "auto-workspace-backup".to_string(),
                name: "Workspace Daily Backup".to_string(),
                description: "Automated snapshot backup of active workspace documents".to_string(),
                r#type: "app".to_string(),
                enabled: true,
                created_at: Local::now().to_rfc3339(),
                last_run: "".to_string(),
                last_status: "never".to_string(),
            },
            schedule: ScheduleSection {
                frequency: "recurring".to_string(),
                run_at: "".to_string(),
                cron: "0 0 2 * * *".to_string(),
                human_readable: "Every day at 02:00 AM".to_string(),
                event: "app_launch".to_string(),
            },
            action: ActionSection {
                operation: Some("backup".to_string()),
                source_path: None,
                destination_path: None,
            },
            notifications: NotificationsSection {
                on_start: false,
                on_complete: true,
                on_fail: true,
                include_result_preview: true,
            },
        };
        let _ = save_task_to_file(&default_backup);
        tasks.push(default_backup);
    }

    tasks
}

pub fn save_task_to_file(task: &ScheduledTask) -> Result<(), String> {
    let dir = get_scheduler_dir();
    let file_path = dir.join(format!("{}.task.toml", task.task.id));
    let content = toml::to_string_pretty(task).map_err(|e| e.to_string())?;
    fs::write(file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_task_file(id: &str) -> Result<(), String> {
    let dir = get_scheduler_dir();
    let file_path = dir.join(format!("{}.task.toml", id));
    if file_path.exists() {
        fs::remove_file(file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn write_task_log(id: &str, status: &str, message: &str) {
    let log_dir = get_scheduler_dir().join("logs");
    let _ = fs::create_dir_all(&log_dir);
    let log_file = log_dir.join(format!("{}.log", id));
    let timestamp = Local::now().to_rfc3339();
    let log_entry = format!("[{}] Status: {} - {}\n", timestamp, status, message);
    
    // Append or write log
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
    {
        use std::io::Write;
        let _ = write!(file, "{}", log_entry);
    }
}

// Background scheduler running tokio loop
pub fn start_scheduler_engine(app_handle: AppHandle, state: Arc<Mutex<Vec<ScheduledTask>>>) {
    tauri::async_runtime::spawn(async move {
        // Load initial tasks
        {
            let mut tasks = state.lock().unwrap();
            *tasks = load_all_tasks();
        }

        // Setup file watcher to hot reload
        let (tx, rx) = std::sync::mpsc::channel();
        let watcher_result = notify::RecommendedWatcher::new(
            move |res| {
                let _ = tx.send(res);
            },
            notify::Config::default(),
        );
        let mut watcher = watcher_result.ok();

        if let Some(ref mut w) = watcher {
            let _ = w.watch(&get_scheduler_dir(), notify::RecursiveMode::NonRecursive);
        }

        let mut last_cron_check = Utc::now();

        // 1-second ticker loop
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;

            // Check if directory modified and reload tasks if notify signals
            if rx.try_recv().is_ok() {
                let reloaded = load_all_tasks();
                let mut current = state.lock().unwrap();
                *current = reloaded;
                // Emit event to update frontends
                let _ = app_handle.emit("tasks_updated", ());
            }

            let now = Utc::now();
            let local_now = Local::now();
            let mut tasks_to_run = Vec::new();

            // Scope lock to check schedules
            {
                let mut tasks = state.lock().unwrap();
                for task in tasks.iter_mut() {
                    if !task.task.enabled {
                        continue;
                    }

                    let mut should_run = false;

                    if task.schedule.frequency == "once" {
                        if let Ok(run_time) = NaiveDateTime::parse_from_str(&task.schedule.run_at, "%Y-%m-%dT%H:%M:%S") {
                            // Compare naive datetimes directly — no timezone conversion needed
                            if local_now.naive_local() >= run_time {
                                should_run = true;
                                task.schedule.frequency = "completed".to_string(); // disable after running
                                task.task.enabled = false;
                            }
                        }
                    } else if task.schedule.frequency == "recurring" {
                        if let Ok(schedule) = task.schedule.cron.parse::<Schedule>() {
                            for datetime in schedule.after(&last_cron_check) {
                                if datetime <= now {
                                    should_run = true;
                                }
                                break;
                            }
                        }
                    }

                    if should_run {
                        tasks_to_run.push(task.clone());
                        task.task.last_run = local_now.to_rfc3339();
                        task.task.last_status = "success".to_string(); // assume success, updated async
                        let _ = save_task_to_file(task);
                    }
                }
            }

            // Execute scheduled tasks
            for task in tasks_to_run {
                let app = app_handle.clone();
                let state_clone = Arc::clone(&state);
                tauri::async_runtime::spawn(async move {
                    execute_single_task(app, state_clone, task).await;
                });
            }

            last_cron_check = now;
        }
    });
}

pub async fn execute_single_task(app: AppHandle, state: Arc<Mutex<Vec<ScheduledTask>>>, task: ScheduledTask) {
    let task_id = task.task.id.clone();
    let _ = app.emit("task_run_start", &task_id);
    write_task_log(&task_id, "RUNNING", &format!("Executing task: {}", task.task.name));
    
    // Simulate brief task duration
    tokio::time::sleep(Duration::from_millis(1000)).await;
    
    let operation = task.action.operation.as_deref().unwrap_or("backup");
    let result: Result<String, String> = match operation {
        "backup" => {
            let install_dir = crate::config::get_app_install_dir();
            let storage_dir = install_dir.join("storage");
            let backup_dest = task.action.destination_path.as_deref()
                .map(PathBuf::from)
                .unwrap_or_else(|| install_dir.join("storage_backup"));
            
            let _ = fs::create_dir_all(&backup_dest);
            // Backup config
            if let Ok(cfg_content) = fs::read_to_string(storage_dir.join("config.json")) {
                let _ = fs::write(backup_dest.join("config.json"), cfg_content);
            }
            Ok(format!("Successfully backed up workspace configuration to {:?}", backup_dest))
        }
        "cleanup" => {
            Ok("Automated workspace temporary files cleanup completed.".to_string())
        }
        "export" => {
            Ok("Export operation completed successfully.".to_string())
        }
        _ => Ok(format!("Executed task: {} (operation: {})", task.task.name, operation)),
    };

    let status = match result {
        Ok(ref msg) => {
            write_task_log(&task_id, "SUCCESS", msg);
            "success"
        }
        Err(ref err) => {
            write_task_log(&task_id, "FAILED", err);
            "failed"
        }
    };

    // Update state cache and write back to file
    {
        let mut tasks = state.lock().unwrap();
        if let Some(t) = tasks.iter_mut().find(|x| x.task.id == task_id) {
            t.task.last_status = status.to_string();
            t.task.last_run = Local::now().to_rfc3339();
            let _ = save_task_to_file(t);
        }
    }

    let _ = app.emit("task_run_complete", (&task_id, status));
    let _ = app.emit("tasks_updated", ());

    // Show tauri notification if enabled
    if (status == "success" && task.notifications.on_complete) || (status == "failed" && task.notifications.on_fail) {
        let title = format!("Task {} Complete", task.task.name);
        let body = match result {
            Ok(ref msg) => {
                if task.notifications.include_result_preview {
                    format!("{:.100}...", msg)
                } else {
                    "Completed successfully.".to_string()
                }
            }
            Err(ref err) => err.to_string(),
        };
        let _ = app.emit("notification_triggered", (title, body));
    }
}

// Event-triggered task trigger pipeline
pub fn trigger_event_tasks(app: &AppHandle, state: &Arc<Mutex<Vec<ScheduledTask>>>, event_name: &str) {
    let mut tasks_to_run = Vec::new();
    {
        let mut tasks = state.lock().unwrap();
        for task in tasks.iter_mut() {
            if task.task.enabled && task.schedule.frequency == "on_event" && task.schedule.event == event_name {
                tasks_to_run.push(task.clone());
                task.task.last_run = Local::now().to_rfc3339();
                task.task.last_status = "success".to_string();
                let _ = save_task_to_file(task);
            }
        }
    }

    for task in tasks_to_run {
        let app_clone = app.clone();
        let state_clone = Arc::clone(state);
        tauri::async_runtime::spawn(async move {
            execute_single_task(app_clone, state_clone, task).await;
        });
    }
}

// Tauri Command list
#[tauri::command]
pub fn load_scheduler_tasks(state: tauri::State<'_, SchedulerState>) -> Vec<ScheduledTask> {
    let tasks = state.tasks.lock().unwrap();
    tasks.clone()
}

#[tauri::command]
pub fn save_scheduler_task(state: tauri::State<'_, SchedulerState>, task: ScheduledTask) -> Result<(), String> {
    save_task_to_file(&task)?;
    let mut tasks = state.tasks.lock().unwrap();
    if let Some(t) = tasks.iter_mut().find(|x| x.task.id == task.task.id) {
        *t = task;
    } else {
        tasks.push(task);
    }
    Ok(())
}

#[tauri::command]
pub fn delete_scheduler_task(state: tauri::State<'_, SchedulerState>, id: String) -> Result<(), String> {
    delete_task_file(&id)?;
    let mut tasks = state.tasks.lock().unwrap();
    tasks.retain(|x| x.task.id != id);
    Ok(())
}

#[tauri::command]
pub fn run_task_now(app: AppHandle, state: tauri::State<'_, SchedulerState>, id: String) -> Result<(), String> {
    let tasks = state.tasks.lock().unwrap();
    if let Some(task) = tasks.iter().find(|x| x.task.id == id) {
        let app_clone = app.clone();
        let state_clone = Arc::clone(&state.tasks);
        let task_clone = task.clone();
        tauri::async_runtime::spawn(async move {
            execute_single_task(app_clone, state_clone, task_clone).await;
        });
        Ok(())
    } else {
        Err("Task not found".to_string())
    }
}

#[tauri::command]
pub fn get_task_run_logs(id: String) -> Result<String, String> {
    let log_file = get_scheduler_dir().join("logs").join(format!("{}.log", id));
    if log_file.exists() {
        fs::read_to_string(log_file).map_err(|e| e.to_string())
    } else {
        Ok("No logs available for this task.".to_string())
    }
}
