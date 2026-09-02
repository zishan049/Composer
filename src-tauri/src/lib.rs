pub mod config;
pub mod scheduler;
pub mod models;
pub mod memory;
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
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.dialog().file().pick_folder(move |path| {
        let as_str = path.map(|p| p.to_string());
        let _ = tx.send(as_str);
    });
    rx.recv().ok().flatten()
}

/// Opens native OS file picker, returns chosen path or None if cancelled.
#[tauri::command]
async fn pick_file(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.dialog().file().pick_file(move |path| {
        let as_str = path.map(|p| p.to_string());
        let _ = tx.send(as_str);
    });
    rx.recv().ok().flatten()
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Register thread-safe states
        .manage(models::ActiveModelManager::new())
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
            import_to_directory,
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
            // Model downloader commands
            models::query_huggingface_models,
            models::start_model_download,
            models::cancel_model_download,
            models::load_active_model,
            models::unload_active_model,
            models::get_loaded_model,
            models::list_whisper_models,
            models::run_whisper_transcription,
            models::download_whisper_model,
            models::cancel_whisper_download,
            models::download_whisper_binary,
            models::check_whisper_binary,
            models::save_wav_audio,
            models::detect_gpu_devices,
            models::set_model_gpu_config,
            models::get_model_gpu_config,
            models::init_gpu_from_config,
            models::get_vram_recommendation,
            models::check_vram_available,
            models::refresh_gpu_status,
            models::run_chat_inference,
            models::list_downloaded_models,
            // Memory commands
            memory::query_memories,
            memory::add_memory_node,
            memory::toggle_memory_pin,
            memory::delete_memory_node,
            memory::trigger_memory_compression,
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
            // Conversations & Projects operations
            file_ops::get_conversations_list,
            file_ops::save_conversation_session,
            file_ops::delete_conversation_session,
            file_ops::create_project_folder,
            file_ops::rename_project_folder,
            file_ops::delete_project_folder,
            file_ops::run_project_naming_inference,
            // Document scan & index RAG operations
            file_ops::scan_and_index_document,
            file_ops::semantic_rag_search,
            // Skills operations
            file_ops::load_skills_list,
            file_ops::save_skill_details,
            file_ops::delete_skill_details,
            // Audio temp file for Whisper
            save_temp_audio,
            get_system_ram_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Saves raw audio bytes from the browser (webm/ogg) to a temp file and returns its path.
/// The Whisper command reads this file for transcription.
#[tauri::command]
fn save_temp_audio(data: Vec<u8>) -> Result<String, String> {
    let tmp_path = std::env::temp_dir().join("composer_audio_input.webm");
    std::fs::write(&tmp_path, &data).map_err(|e| e.to_string())?;
    Ok(tmp_path.to_string_lossy().to_string())
}

/// Dynamic exact physical CPU system RAM utilization percentage query.
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
// Force rebuild trigger to resolve file lock.
