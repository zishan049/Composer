pub mod config;
pub mod scheduler;
pub mod file_ops;

use std::sync::Arc;
use std::path::{Path, PathBuf};
use tauri::Manager;

use tauri_plugin_dialog::DialogExt;

// Default greet command
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Opens native OS folder picker, returns chosen path or None if cancelled.
#[tauri::command]
async fn pick_directory(app: tauri::AppHandle) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<String>>(1);
    app.dialog().file().pick_folder(move |path| {
        let as_str = path.map(|p| p.to_string());
        let _ = tx.blocking_send(as_str);
    });
    rx.recv().await.flatten()
}

/// Opens native OS file picker, returns chosen path or None if cancelled.
#[tauri::command]
async fn pick_file(app: tauri::AppHandle) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<String>>(1);
    app.dialog().file().pick_file(move |path| {
        let as_str = path.map(|p| p.to_string());
        let _ = tx.blocking_send(as_str);
    });
    rx.recv().await.flatten()
}

/// Opens native OS save file picker, returns chosen destination path or None if cancelled.
#[tauri::command]
async fn save_file_dialog(
    app: tauri::AppHandle,
    default_name: Option<String>,
    default_dir: Option<String>,
) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<String>>(1);
    let mut builder = app.dialog().file();
    if let Some(name) = default_name {
        builder = builder.set_file_name(&name);
    }
    if let Some(dir) = default_dir {
        builder = builder.set_directory(PathBuf::from(dir));
    }
    builder = builder.add_filter("PDF Document", &["pdf"]);
    builder.save_file(move |path| {
        let as_str = path.map(|p| p.to_string());
        let _ = tx.blocking_send(as_str);
    });
    rx.recv().await.flatten()
}

/// Imports a file or folder from the system into the specified destination directory.
#[tauri::command]
fn import_to_directory(source_path: String, dest_dir: String) -> Result<String, String> {
    let src = Path::new(&source_path);
    if !src.exists() {
        return Err("Source file/folder does not exist".to_string());
    }
    let name = src.file_name().ok_or("Invalid source name")?;
    let dest = PathBuf::from(dest_dir).join(name);
    if dest.exists() {
        return Err("Target already exists in workspace".to_string());
    }

    if src.is_dir() {
        copy_dir_all(src, &dest)?;
    } else {
        std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    }
    Ok(dest.to_string_lossy().to_string())
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Dynamic physical CPU system RAM utilization percentage query.
#[tauri::command]
fn get_system_ram_usage() -> u8 {
    if let Ok(mem) = sys_info::mem_info() {
        if mem.total > 0 {
            let used = mem.total.saturating_sub(mem.free);
            return ((used as f64 / mem.total as f64) * 100.0).round() as u8;
        }
    }
    50
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Register thread-safe scheduler state
        .manage(scheduler::SchedulerState::new())
        // Initialize background scheduler on startup
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<scheduler::SchedulerState>();
            let tasks_clone = Arc::clone(&state.tasks);
            scheduler::start_scheduler_engine(handle, tasks_clone);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            pick_directory,
            pick_file,
            save_file_dialog,
            import_to_directory,
            get_system_ram_usage,
            // Config commands
            config::get_app_config,
            config::save_app_config,
            config::export_theme_toml,
            config::import_theme_toml,
            config::get_app_install_path,
            config::get_workspace_path,
            // Scheduler commands
            scheduler::load_scheduler_tasks,
            scheduler::save_scheduler_task,
            scheduler::delete_scheduler_task,
            scheduler::run_task_now,
            scheduler::get_task_run_logs,
            // Explorer file operations
            file_ops::list_directory_contents,
            file_ops::list_all_workspace_files,
            file_ops::read_text_file,
            file_ops::read_binary_file_base64,
            file_ops::write_text_file,
            file_ops::write_binary_file_base64,
            file_ops::create_new_file,
            file_ops::create_new_folder,
            file_ops::delete_file_or_dir,
            file_ops::rename_file_or_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
