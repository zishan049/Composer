pub mod config;
pub mod file_ops;
pub mod session;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use session::SessionPaths;

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// -------------------------------------------------------------
// SESSION PATH ALLOWLIST REGISTRATION (native dialogs)
// -------------------------------------------------------------

/// Records a dialog-produced path in the session allowlist so restricted
/// commands (import / inspect / theme export & import) accept it.
fn register_picked_path(app: &tauri::AppHandle, path: &str) {
    app.state::<SessionPaths>().register(Path::new(path));
}

/// Opens native OS folder picker, returns chosen path or None if cancelled.
#[tauri::command]
async fn pick_directory(app: tauri::AppHandle) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<String>>(1);
    app.dialog().file().pick_folder(move |path| {
        let as_str = path.map(|p| p.to_string());
        let _ = tx.blocking_send(as_str);
    });
    let picked = rx.recv().await.flatten();
    if let Some(path) = &picked {
        register_picked_path(&app, path);
    }
    picked
}

/// Opens native OS folder picker supporting multiple selection, returns chosen paths or None if cancelled.
#[tauri::command]
async fn pick_directories(app: tauri::AppHandle) -> Option<Vec<String>> {
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<Vec<String>>>(1);
    app.dialog().file().pick_folders(move |paths| {
        let as_strings = paths.map(|list| list.into_iter().map(|p| p.to_string()).collect());
        let _ = tx.blocking_send(as_strings);
    });
    let picked = rx.recv().await.flatten();
    if let Some(paths) = &picked {
        for path in paths {
            register_picked_path(&app, path);
        }
    }
    picked
}

/// Opens native OS file picker, returns chosen path or None if cancelled.
#[tauri::command]
async fn pick_file(app: tauri::AppHandle) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<String>>(1);
    app.dialog().file().pick_file(move |path| {
        let as_str = path.map(|p| p.to_string());
        let _ = tx.blocking_send(as_str);
    });
    let picked = rx.recv().await.flatten();
    if let Some(path) = &picked {
        register_picked_path(&app, path);
    }
    picked
}

/// Opens native OS file picker supporting multiple selection, returns chosen paths or None if cancelled.
#[tauri::command]
async fn pick_files(app: tauri::AppHandle) -> Option<Vec<String>> {
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<Vec<String>>>(1);
    app.dialog().file().pick_files(move |paths| {
        let as_strings = paths.map(|list| list.into_iter().map(|p| p.to_string()).collect());
        let _ = tx.blocking_send(as_strings);
    });
    let picked = rx.recv().await.flatten();
    if let Some(paths) = &picked {
        for path in paths {
            register_picked_path(&app, path);
        }
    }
    picked
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
    let picked = rx.recv().await.flatten();
    if let Some(path) = &picked {
        register_picked_path(&app, path);
    }
    picked
}

// -------------------------------------------------------------
// IMPORT (external source → workspace destination)
// -------------------------------------------------------------

/// Imports a file or folder from the system into the specified destination directory.
/// The source must be user-confirmed (inside the active workspace or produced by a
/// native dialog / drag-and-drop this session); the destination is strictly
/// validated within the active workspace.
#[tauri::command]
async fn import_to_directory(
    app: tauri::AppHandle,
    source_path: String,
    dest_dir: String,
) -> Result<String, String> {
    let session_paths = app.state::<SessionPaths>();
    let src = PathBuf::from(&source_path);
    if !src.exists() {
        return Err(format!("Source does not exist: {}", source_path));
    }

    // Source must be user-confirmed: inside the active workspace, or chosen
    // through a native dialog / drag-and-drop during this session.
    let workspace_root = config::get_active_workspace_path();
    let src = match file_ops::validate_path_in_workspace(&src, &workspace_root) {
        Ok(validated) => validated,
        Err(_) => {
            if session_paths.is_allowed(&src) {
                session::canonicalize_best_effort(&src)
            } else {
                return Err(
                    "Import source must be inside the active workspace or selected through the file picker / drag-and-drop"
                        .to_string(),
                );
            }
        }
    };

    let name = src.file_name().ok_or("Invalid source name")?.to_os_string();

    // Validate destination is strictly within active workspace
    let validated_dest_dir = if dest_dir.trim().is_empty() {
        workspace_root.clone()
    } else {
        file_ops::validate_path_in_workspace(Path::new(&dest_dir), &workspace_root)?
    };

    let dest = validated_dest_dir.join(&name);
    let validated_dest = file_ops::validate_path_in_workspace(&dest, &workspace_root)?;
    if validated_dest.exists() {
        return Err(format!("'{}' already exists in workspace", name.to_string_lossy()));
    }

    let return_path = validated_dest.to_string_lossy().to_string();

    // Recursive copies / large file copies must not block the async runtime.
    let dest_for_copy = validated_dest.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if src.is_dir() {
            copy_dir_all(&src, &dest_for_copy)
        } else {
            std::fs::copy(&src, &dest_for_copy)
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(return_path)
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

// -------------------------------------------------------------
// SYSTEM INFO
// -------------------------------------------------------------

/// Dynamic physical CPU system RAM utilization percentage query.
#[tauri::command]
async fn get_system_ram_usage() -> u8 {
    tauri::async_runtime::spawn_blocking(|| {
        if let Ok(mem) = sys_info::mem_info() {
            if mem.total > 0 {
                let used = mem.total.saturating_sub(mem.free);
                return ((used as f64 / mem.total as f64) * 100.0).round() as u8;
            }
        }
        50
    })
    .await
    .unwrap_or(50)
}

// -------------------------------------------------------------
// RUNTIME ASSET PROTOCOL SCOPE
// -------------------------------------------------------------

/// Workspace directories currently allowed in the runtime asset protocol
/// scope. Tracked so a workspace switch can revoke the previous ones
/// (the static scope in `tauri.conf.json` is intentionally empty).
#[derive(Default)]
struct AssetScopeDirs(Mutex<Vec<PathBuf>>);

/// Adds `workspace` to the runtime asset protocol scope and revokes
/// previously allowed roots that no longer overlap it.
pub fn refresh_asset_protocol_scope(app: &tauri::AppHandle, workspace: &Path) {
    let canonical = session::canonicalize_best_effort(workspace);
    let scope = app.asset_protocol_scope();
    let tracked = app.state::<AssetScopeDirs>();
    let mut dirs = tracked.0.lock().unwrap();

    for old in dirs.iter() {
        // Forbid roots that are disjoint from the new workspace. Overlapping
        // roots cannot be revoked without also blocking the new workspace,
        // because deny patterns take precedence over allowed ones.
        let disjoint = *old != canonical
            && !canonical.starts_with(old)
            && !old.starts_with(&canonical);
        if disjoint {
            let _ = scope.forbid_directory(old, true);
        }
    }

    let _ = scope.allow_directory(&canonical, true);

    // Retain ancestors of the new workspace (their broader allow is still
    // active) and the new root itself; everything else is revoked or covered.
    dirs.retain(|p| canonical.starts_with(p));
    if !dirs.contains(&canonical) {
        dirs.push(canonical);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_webview_event(|webview, event| {
            // Register externally dragged-and-dropped paths in the session
            // allowlist so they can be imported/inspected like picked files.
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if let Some(session_paths) = webview.app_handle().try_state::<SessionPaths>() {
                    for path in paths {
                        session_paths.register(path);
                    }
                }
            }
        })
        .setup(|app| {
            app.manage(SessionPaths::default());
            app.manage(AssetScopeDirs::default());

            // Prime the config cache and open the runtime asset protocol
            // scope to the active workspace (and its subpaths) only.
            let workspace = config::get_active_workspace_path();
            refresh_asset_protocol_scope(app.handle(), &workspace);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            pick_directory,
            pick_directories,
            pick_file,
            pick_files,
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
            config::get_cache_path,
            // Explorer file operations
            file_ops::list_directory_contents,
            file_ops::list_all_workspace_files,
            file_ops::get_cached_workspace_index,
            file_ops::read_text_file,
            file_ops::read_binary_file_base64,
            file_ops::write_text_file,
            file_ops::write_binary_file_base64,
            file_ops::create_new_file,
            file_ops::create_new_folder,
            file_ops::delete_file_or_dir,
            file_ops::rename_file_or_dir,
            file_ops::inspect_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
