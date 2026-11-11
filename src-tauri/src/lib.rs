pub mod config;
pub mod file_ops;
pub mod intelligence;
pub mod session;
pub mod worktrees;

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
        return Err(format!(
            "'{}' already exists in workspace",
            name.to_string_lossy()
        ));
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

/// Dynamic physical system RAM utilization percentage query.
#[tauri::command]
async fn get_system_ram_usage() -> u8 {
    tauri::async_runtime::spawn_blocking(|| {
        if let Ok(mem) = sys_info::mem_info() {
            if mem.total > 0 {
                let used = mem.total.saturating_sub(mem.free);
                return ((used as f64 / mem.total as f64) * 100.0).round().clamp(0.0, 100.0) as u8;
            }
        }
        50
    })
    .await
    .unwrap_or(50)
}

#[cfg(windows)]
fn sample_system_cpu_usage() -> u8 {
    use std::sync::Mutex;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct FileTime {
        dw_low_date_time: u32,
        dw_high_date_time: u32,
    }

    #[derive(Clone, Copy)]
    struct CpuSampleState {
        idle: u64,
        kernel: u64,
        user: u64,
        last_pct: u8,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemTimes(
            idle_time: *mut FileTime,
            kernel_time: *mut FileTime,
            user_time: *mut FileTime,
        ) -> i32;
    }

    fn read_times() -> Option<(u64, u64, u64)> {
        let mut idle = FileTime { dw_low_date_time: 0, dw_high_date_time: 0 };
        let mut kernel = FileTime { dw_low_date_time: 0, dw_high_date_time: 0 };
        let mut user = FileTime { dw_low_date_time: 0, dw_high_date_time: 0 };
        let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) };
        if ok == 0 {
            return None;
        }
        let to_u64 = |ft: FileTime| {
            ((ft.dw_high_date_time as u64) << 32) | (ft.dw_low_date_time as u64)
        };
        Some((to_u64(idle), to_u64(kernel), to_u64(user)))
    }

    static CPU_STATE: Mutex<Option<CpuSampleState>> = Mutex::new(None);
    let mut guard = CPU_STATE.lock().unwrap_or_else(|e| e.into_inner());

    let (prev, curr, fallback_pct) = match *guard {
        Some(state) => match read_times() {
            Some(now) => ((state.idle, state.kernel, state.user), now, state.last_pct),
            None => return state.last_pct,
        },
        None => {
            let Some(t0) = read_times() else {
                return 0;
            };
            std::thread::sleep(std::time::Duration::from_millis(150));
            let Some(t1) = read_times() else {
                *guard = Some(CpuSampleState {
                    idle: t0.0,
                    kernel: t0.1,
                    user: t0.2,
                    last_pct: 0,
                });
                return 0;
            };
            (t0, t1, 0)
        }
    };

    let idle_delta = curr.0.saturating_sub(prev.0);
    let kernel_delta = curr.1.saturating_sub(prev.1);
    let user_delta = curr.2.saturating_sub(prev.2);
    let total = kernel_delta.saturating_add(user_delta);
    if total == 0 {
        return fallback_pct;
    }

    let busy = total.saturating_sub(idle_delta);
    let pct = ((busy as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0) as u8;
    *guard = Some(CpuSampleState {
        idle: curr.0,
        kernel: curr.1,
        user: curr.2,
        last_pct: pct,
    });
    pct
}

#[cfg(not(windows))]
fn sample_system_cpu_usage() -> u8 {
    let cores = sys_info::cpu_num().unwrap_or(1).max(1) as f64;
    if let Ok(load) = sys_info::loadavg() {
        return ((load.one / cores) * 100.0).round().clamp(0.0, 100.0) as u8;
    }
    0
}

/// Dynamic physical system CPU utilization percentage query.
#[tauri::command]
async fn get_system_cpu_usage() -> u8 {
    tauri::async_runtime::spawn_blocking(sample_system_cpu_usage)
        .await
        .unwrap_or(0)
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
        let disjoint =
            *old != canonical && !canonical.starts_with(old) && !old.starts_with(&canonical);
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
            get_system_cpu_usage,
            // Config commands
            config::get_app_config,
            config::save_app_config,
            config::open_workspace_dir,
            config::remove_recent_workspace,
            config::export_theme_toml,
            config::import_theme_toml,
            config::get_app_install_path,
            config::get_workspace_path,
            config::get_cache_path,
            // Explorer file operations
            file_ops::list_directory_contents,
            file_ops::list_all_workspace_files,
            file_ops::get_cached_workspace_index,
            file_ops::get_workspace_stats,
            file_ops::invalidate_workspace_index,
            file_ops::search_workspace,
            file_ops::open_in_file_manager,
            file_ops::read_text_file,
            file_ops::read_binary_file_base64,
            file_ops::write_text_file,
            file_ops::write_binary_file_base64,
            file_ops::create_new_file,
            file_ops::create_new_folder,
            file_ops::delete_file_or_dir,
            file_ops::rename_file_or_dir,
            file_ops::inspect_paths,
            // Worktree commands (v0.4)
            worktrees::get_parent_workspace,
            worktrees::create_worktree,
            worktrees::rename_worktree,
            worktrees::set_active_worktree,
            worktrees::remove_worktree,
            worktrees::save_worktree_state,
            worktrees::load_worktree_state,
            // File intelligence commands (v0.4)
            intelligence::get_file_intelligence,
            intelligence::get_file_relationships,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
