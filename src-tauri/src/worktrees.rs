//! Composer v0.4 — Worktree persistence backend
//!
//! A Worktree is a named, independently navigable sub-workspace inside a
//! parent workspace. Each parent workspace stores its worktrees in a JSON
//! metadata file: `<workspace>/.composer/worktrees.json`.
//!
//! This module provides the full CRUD lifecycle plus the Tauri IPC commands
//! for the frontend.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// ── Data model ────────────────────────────────────────────────────

pub type WorktreeId = String;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct WorktreeMetadata {
    pub id: WorktreeId,
    pub name: String,
    pub parent_workspace_id: String,
    pub root_path: String,
    pub created_ms: u64,
    pub last_opened_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ParentWorkspace {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub worktrees: Vec<WorktreeMetadata>,
    pub active_worktree_id: Option<WorktreeId>,
    pub created_ms: u64,
    pub last_opened_ms: u64,
    /// Schema version for future migrations
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
}

fn default_schema_version() -> u32 {
    1
}

// ── Persistence helpers ───────────────────────────────────────────

fn composer_meta_dir(workspace_path: &Path) -> PathBuf {
    workspace_path.join(".composer")
}

fn worktrees_file(workspace_path: &Path) -> PathBuf {
    composer_meta_dir(workspace_path).join("worktrees.json")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn generate_id() -> String {
    // Simple unique ID: timestamp + random suffix
    let ms = now_ms();
    let rand: u32 = {
        // Use process entropy via hash of time for uniqueness
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        ms.hash(&mut h);
        std::process::id().hash(&mut h);
        h.finish() as u32
    };
    format!("wt-{}-{:08x}", ms, rand)
}

/// Atomically write JSON to `path`.
fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let dir = path.parent().ok_or("Invalid path")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("tmp-{}", now_ms()));
    fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

// ── Low-level workspace operations ───────────────────────────────

/// Load or create a ParentWorkspace record for the given path.
pub fn load_parent_workspace(workspace_path: &Path) -> ParentWorkspace {
    let file = worktrees_file(workspace_path);
    if file.exists() {
        if let Ok(content) = fs::read_to_string(&file) {
            if let Ok(ws) = serde_json::from_str::<ParentWorkspace>(&content) {
                return ws;
            }
        }
    }
    // Create fresh record
    let name = workspace_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Workspace".to_string());
    let now = now_ms();
    ParentWorkspace {
        id: generate_id(),
        name,
        root_path: workspace_path.to_string_lossy().to_string(),
        worktrees: Vec::new(),
        active_worktree_id: None,
        created_ms: now,
        last_opened_ms: now,
        schema_version: 1,
    }
}

fn save_parent_workspace(workspace_path: &Path, ws: &ParentWorkspace) -> Result<(), String> {
    write_json_atomic(&worktrees_file(workspace_path), ws)
}

// ── Validation helpers ────────────────────────────────────────────

fn validate_worktree_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("Worktree name cannot be empty".to_string());
    }
    if n.len() > 80 {
        return Err("Worktree name must be 80 characters or fewer".to_string());
    }
    // Disallow OS-reserved characters
    if n.chars()
        .any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
    {
        return Err("Worktree name contains invalid characters".to_string());
    }
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────

/// Return the ParentWorkspace record for the active workspace, or None if no
/// workspace is set.
#[tauri::command]
pub async fn get_parent_workspace(workspace_path: String) -> Option<ParentWorkspace> {
    if workspace_path.trim().is_empty() {
        return None;
    }
    let p = PathBuf::from(&workspace_path);
    if !p.exists() {
        return None;
    }
    let ws = tauri::async_runtime::spawn_blocking(move || load_parent_workspace(&p))
        .await
        .ok()?;
    Some(ws)
}

/// Create a new worktree inside the active workspace.
#[tauri::command]
pub async fn create_worktree(
    name: String,
    root_path: String,
    parent_workspace_id: String,
) -> Result<WorktreeMetadata, String> {
    validate_worktree_name(&name)?;

    let root = PathBuf::from(root_path.trim());
    if !root.exists() {
        return Err(format!("Directory does not exist: {}", root.display()));
    }
    if !root.is_dir() {
        return Err("Worktree path must be a directory".to_string());
    }

    let workspace_path = crate::config::get_active_workspace_path();
    let name = name.trim().to_string();
    let root_path_str = crate::session::canonicalize_best_effort(&root)
        .to_string_lossy()
        .to_string();

    tauri::async_runtime::spawn_blocking(move || {
        let mut ws = load_parent_workspace(&workspace_path);

        // Enforce unique name within workspace
        if ws
            .worktrees
            .iter()
            .any(|w| w.name.eq_ignore_ascii_case(&name))
        {
            return Err(format!("A worktree named '{}' already exists", name));
        }

        // Enforce unique root_path
        if ws.worktrees.iter().any(|w| {
            crate::session::canonicalize_best_effort(Path::new(&w.root_path))
                == crate::session::canonicalize_best_effort(Path::new(&root_path_str))
        }) {
            return Err("A worktree for that directory already exists".to_string());
        }

        let now = now_ms();
        let wt = WorktreeMetadata {
            id: generate_id(),
            name,
            parent_workspace_id: if parent_workspace_id.is_empty() {
                ws.id.clone()
            } else {
                parent_workspace_id
            },
            root_path: root_path_str,
            created_ms: now,
            last_opened_ms: now,
        };

        ws.worktrees.push(wt.clone());
        save_parent_workspace(&workspace_path, &ws)?;
        Ok(wt)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Rename a worktree (display name only — never touches the filesystem).
#[tauri::command]
pub async fn rename_worktree(worktree_id: String, new_name: String) -> Result<(), String> {
    validate_worktree_name(&new_name)?;

    let workspace_path = crate::config::get_active_workspace_path();
    let new_name = new_name.trim().to_string();

    tauri::async_runtime::spawn_blocking(move || {
        let mut ws = load_parent_workspace(&workspace_path);

        // Check duplicate name (excluding the target itself)
        if ws
            .worktrees
            .iter()
            .any(|w| w.id != worktree_id && w.name.eq_ignore_ascii_case(&new_name))
        {
            return Err(format!("A worktree named '{}' already exists", new_name));
        }

        let wt = ws
            .worktrees
            .iter_mut()
            .find(|w| w.id == worktree_id)
            .ok_or_else(|| format!("Worktree '{}' not found", worktree_id))?;

        wt.name = new_name;
        save_parent_workspace(&workspace_path, &ws)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Persist which worktree is currently active.
#[tauri::command]
pub async fn set_active_worktree(
    workspace_path: String,
    worktree_id: Option<String>,
) -> Result<(), String> {
    let ws_path = PathBuf::from(workspace_path);
    tauri::async_runtime::spawn_blocking(move || {
        let mut ws = load_parent_workspace(&ws_path);
        ws.active_worktree_id = worktree_id.clone();
        ws.last_opened_ms = now_ms();

        // Update last_opened on the worktree itself
        if let Some(ref id) = worktree_id {
            if let Some(wt) = ws.worktrees.iter_mut().find(|w| w.id == *id) {
                wt.last_opened_ms = now_ms();
            }
        }

        save_parent_workspace(&ws_path, &ws)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Remove a worktree from Composer's metadata. Never deletes files from disk.
/// Pass `delete_files: true` only if you want to also remove the filesystem
/// directory (requires confirmation in the frontend before calling).
#[tauri::command]
pub async fn remove_worktree(worktree_id: String, delete_files: bool) -> Result<(), String> {
    let workspace_path = crate::config::get_active_workspace_path();

    tauri::async_runtime::spawn_blocking(move || {
        let mut ws = load_parent_workspace(&workspace_path);

        let wt = ws
            .worktrees
            .iter()
            .find(|w| w.id == worktree_id)
            .ok_or_else(|| format!("Worktree '{}' not found", worktree_id))?
            .clone();

        // Safety: refuse to delete the active workspace root
        let ws_canonical = crate::session::canonicalize_best_effort(&workspace_path);
        let wt_canonical = crate::session::canonicalize_best_effort(Path::new(&wt.root_path));
        if wt_canonical == ws_canonical {
            return Err("Cannot delete the active workspace root directory".to_string());
        }

        if delete_files && wt_canonical.exists() {
            fs::remove_dir_all(&wt_canonical).map_err(|e| e.to_string())?;
        }

        ws.worktrees.retain(|w| w.id != worktree_id);
        if ws.active_worktree_id.as_deref() == Some(&worktree_id) {
            ws.active_worktree_id = None;
        }

        save_parent_workspace(&workspace_path, &ws)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Worktree state persistence (tab / scroll state) ───────────────

/// Simple per-worktree state store (open tabs, active tab).
/// Stored in `<workspace>/.composer/state/<worktree_id>.json`.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct WorktreeState {
    pub worktree_id: WorktreeId,
    pub open_tab_paths: Vec<String>,
    pub active_tab_path: Option<String>,
    pub scroll_positions: HashMap<String, f64>,
}

fn worktree_state_file(workspace_path: &Path, worktree_id: &str) -> PathBuf {
    composer_meta_dir(workspace_path)
        .join("state")
        .join(format!("{}.json", worktree_id))
}

#[tauri::command]
pub async fn save_worktree_state(state: WorktreeState) -> Result<(), String> {
    let workspace_path = crate::config::get_active_workspace_path();
    let id = state.worktree_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = worktree_state_file(&workspace_path, &id);
        write_json_atomic(&path, &state)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn load_worktree_state(worktree_id: String) -> Option<WorktreeState> {
    let workspace_path = crate::config::get_active_workspace_path();
    tauri::async_runtime::spawn_blocking(move || {
        let path = worktree_state_file(&workspace_path, &worktree_id);
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                return serde_json::from_str::<WorktreeState>(&content).ok();
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_workspace() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        let seq = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "composer_wt_test_{}_{}_{}",
            std::process::id(),
            now_ms(),
            seq
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_create_and_load_parent_workspace() {
        let ws = tmp_workspace();
        let pw = load_parent_workspace(&ws);
        assert_eq!(pw.worktrees.len(), 0);
        assert_eq!(pw.schema_version, 1);
        fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn test_save_and_reload_parent_workspace() {
        let ws = tmp_workspace();
        let mut pw = load_parent_workspace(&ws);
        pw.worktrees.push(WorktreeMetadata {
            id: "wt-test".to_string(),
            name: "Test Worktree".to_string(),
            parent_workspace_id: pw.id.clone(),
            root_path: ws.to_string_lossy().to_string(),
            created_ms: 1000,
            last_opened_ms: 2000,
        });
        save_parent_workspace(&ws, &pw).unwrap();

        let reloaded = load_parent_workspace(&ws);
        assert_eq!(reloaded.worktrees.len(), 1);
        assert_eq!(reloaded.worktrees[0].name, "Test Worktree");
        fs::remove_dir_all(&ws).ok();
    }

    #[test]
    fn test_validate_worktree_name_empty_fails() {
        assert!(validate_worktree_name("").is_err());
        assert!(validate_worktree_name("   ").is_err());
    }

    #[test]
    fn test_validate_worktree_name_reserved_chars_fails() {
        assert!(validate_worktree_name("bad:name").is_err());
        assert!(validate_worktree_name("bad/name").is_err());
        assert!(validate_worktree_name("bad\\name").is_err());
    }

    #[test]
    fn test_validate_worktree_name_valid() {
        assert!(validate_worktree_name("My Feature Branch").is_ok());
        assert!(validate_worktree_name("v0.4-redesign").is_ok());
        assert!(validate_worktree_name("API (draft)").is_ok());
    }

    #[test]
    fn test_remove_worktree_keeps_files() {
        let ws = tmp_workspace();
        let wt_dir = ws.join("my_worktree");
        fs::create_dir_all(&wt_dir).unwrap();
        // Write a sentinel file
        fs::write(wt_dir.join("file.txt"), "content").unwrap();

        let mut pw = load_parent_workspace(&ws);
        let wt = WorktreeMetadata {
            id: "wt-rem-test".to_string(),
            name: "Removal Test".to_string(),
            parent_workspace_id: pw.id.clone(),
            root_path: wt_dir.to_string_lossy().to_string(),
            created_ms: now_ms(),
            last_opened_ms: now_ms(),
        };
        pw.worktrees.push(wt);
        save_parent_workspace(&ws, &pw).unwrap();

        // Remove with delete_files = false
        let mut pw2 = load_parent_workspace(&ws);
        pw2.worktrees.retain(|w| w.id != "wt-rem-test");
        save_parent_workspace(&ws, &pw2).unwrap();

        // Files must still be there
        assert!(wt_dir.join("file.txt").exists());
        fs::remove_dir_all(&ws).ok();
    }
}
