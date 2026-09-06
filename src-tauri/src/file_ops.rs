use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

// -------------------------------------------------------------
// NATIVE WORKSPACE SANDBOXING & BOUNDARY VALIDATION
// -------------------------------------------------------------

/// Validates that a target path is strictly located within the active workspace root.
/// Uses canonicalized paths to protect against `..` traversal, symlink escapes, and absolute path escapes.
pub fn validate_path_in_workspace(target_path: &Path, workspace_root: &Path) -> Result<PathBuf, String> {
    // 1. Canonicalize workspace root
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|e| format!("Invalid workspace root '{}': {}", workspace_root.display(), e))?;

    // 2. If target path exists on disk, canonicalize it directly and check prefix
    if target_path.exists() {
        let canonical_target = target_path
            .canonicalize()
            .map_err(|e| format!("Invalid path '{}': {}", target_path.display(), e))?;

        if !canonical_target.starts_with(&canonical_root) {
            return Err(format!(
                "Security violation: path '{}' escapes active workspace '{}'",
                target_path.display(),
                canonical_root.display()
            ));
        }

        return Ok(canonical_target);
    }

    // 3. If target path does not exist yet (e.g. creating new file/folder or writing new file):
    // Walk up the path hierarchy to find the closest existing ancestor directory.
    let mut ancestor = target_path.to_path_buf();
    let mut non_existent_parts = Vec::new();

    while !ancestor.exists() {
        if let Some(file_name) = ancestor.file_name() {
            let name_str = file_name.to_string_lossy();
            if name_str == ".." || name_str == "." {
                return Err("Security violation: path traversal components are prohibited".to_string());
            }
            non_existent_parts.push(file_name.to_os_string());
        }
        if let Some(parent) = ancestor.parent() {
            ancestor = parent.to_path_buf();
        } else {
            return Err(format!("Invalid path '{}': no valid root found", target_path.display()));
        }
    }

    // Canonicalize the existing ancestor directory
    let canonical_ancestor = ancestor
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize ancestor '{}': {}", ancestor.display(), e))?;

    // Ensure the ancestor is inside the workspace
    if !canonical_ancestor.starts_with(&canonical_root) {
        return Err(format!(
            "Security violation: target parent '{}' escapes active workspace '{}'",
            canonical_ancestor.display(),
            canonical_root.display()
        ));
    }

    // Reconstruct the path from canonical ancestor + non-existent parts (reversed)
    non_existent_parts.reverse();
    let mut validated_path = canonical_ancestor;
    for part in non_existent_parts {
        validated_path.push(part);
    }

    Ok(validated_path)
}

// -------------------------------------------------------------
// EXPLORER PATH UTILITIES & OPERATIONS
// -------------------------------------------------------------
#[tauri::command]
pub fn list_directory_contents(dir_path: String) -> Result<Vec<FileEntry>, String> {
    let workspace_root = crate::config::get_active_workspace_path();
    let target_path = if dir_path.trim().is_empty() {
        workspace_root.clone()
    } else {
        validate_path_in_workspace(Path::new(&dir_path), &workspace_root)?
    };

    if !target_path.exists() {
        return Err("Directory does not exist".to_string());
    }

    let mut entries = Vec::new();
    if let Ok(dir_entries) = fs::read_dir(target_path) {
        for entry in dir_entries.flatten() {
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            entries.push(FileEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
            });
        }
    }
    
    // Sort directories first, then files alphabetically
    entries.sort_by(|a, b| {
        if a.is_dir && !b.is_dir {
            std::cmp::Ordering::Less
        } else if !a.is_dir && b.is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

#[tauri::command]
pub fn list_all_workspace_files() -> Result<Vec<FileEntry>, String> {
    let root_path = crate::config::get_active_workspace_path();

    if !root_path.exists() {
        return Ok(Vec::new());
    }

    let mut result = Vec::new();
    let mut dirs_to_visit = vec![(root_path.clone(), 0)];

    while let Some((dir, depth)) = dirs_to_visit.pop() {
        if depth > 5 { continue; } // limit depth for supreme performance
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                
                // Skip common heavy and hidden directories
                if name.starts_with('.') 
                    || name == "node_modules" 
                    || name == "target" 
                    || name == "dist" 
                    || name == "build" 
                    || name == ".git"
                {
                    continue;
                }

                let metadata = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let is_dir = metadata.is_dir();
                // Get path relative to root
                let rel_path = path.strip_prefix(&root_path)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| name.clone())
                    .replace('\\', "/"); // standard slash format

                result.push(FileEntry {
                    name: rel_path.clone(),
                    path: path.to_string_lossy().to_string(),
                    is_dir,
                    size: metadata.len(),
                });

                if is_dir {
                    dirs_to_visit.push((path, depth + 1));
                }
            }
        }
    }

    // Sort alphabetically: files first, then directories (or just alphabetical relative paths)
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(result)
}

#[tauri::command]
pub fn read_text_file(file_path: String) -> Result<String, String> {
    let workspace_root = crate::config::get_active_workspace_path();
    let validated = validate_path_in_workspace(Path::new(&file_path), &workspace_root)?;
    if !validated.exists() {
        return Err("File does not exist".to_string());
    }
    fs::read_to_string(validated).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text_file(file_path: String, content: String) -> Result<(), String> {
    let workspace_root = crate::config::get_active_workspace_path();
    let validated = validate_path_in_workspace(Path::new(&file_path), &workspace_root)?;
    if let Some(parent) = validated.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(validated, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_new_file(parent_dir: String, name: String) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name == ".." || name == "." || name.trim().is_empty() {
        return Err("Invalid file name: path separators and traversal are prohibited".to_string());
    }
    let workspace_root = crate::config::get_active_workspace_path();
    let parent = if parent_dir.trim().is_empty() {
        workspace_root.clone()
    } else {
        validate_path_in_workspace(Path::new(&parent_dir), &workspace_root)?
    };
    let target = parent.join(&name);
    let validated = validate_path_in_workspace(&target, &workspace_root)?;
    if validated.exists() {
        return Err("File already exists".to_string());
    }
    fs::write(&validated, "").map_err(|e| e.to_string())?;
    Ok(validated.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_new_folder(parent_dir: String, name: String) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name == ".." || name == "." || name.trim().is_empty() {
        return Err("Invalid folder name: path separators and traversal are prohibited".to_string());
    }
    let workspace_root = crate::config::get_active_workspace_path();
    let parent = if parent_dir.trim().is_empty() {
        workspace_root.clone()
    } else {
        validate_path_in_workspace(Path::new(&parent_dir), &workspace_root)?
    };
    let target = parent.join(&name);
    let validated = validate_path_in_workspace(&target, &workspace_root)?;
    if validated.exists() {
        return Err("Folder already exists".to_string());
    }
    fs::create_dir_all(&validated).map_err(|e| e.to_string())?;
    Ok(validated.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_file_or_dir(path: String) -> Result<(), String> {
    let workspace_root = crate::config::get_active_workspace_path();
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|e| format!("Invalid workspace root: {}", e))?;
    let validated = validate_path_in_workspace(Path::new(&path), &workspace_root)?;
    if !validated.exists() {
        return Err("Target does not exist".to_string());
    }
    if validated == canonical_root {
        return Err("Security violation: cannot delete the workspace root directory".to_string());
    }
    if validated.is_dir() {
        fs::remove_dir_all(validated).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(validated).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_file_or_dir(old_path: String, new_name: String) -> Result<String, String> {
    if new_name.contains('/') || new_name.contains('\\') || new_name == ".." || new_name == "." || new_name.trim().is_empty() {
        return Err("Invalid new name: path separators and traversal are prohibited".to_string());
    }
    let workspace_root = crate::config::get_active_workspace_path();
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|e| format!("Invalid workspace root: {}", e))?;
    let old_validated = validate_path_in_workspace(Path::new(&old_path), &workspace_root)?;
    if !old_validated.exists() {
        return Err("Source file does not exist".to_string());
    }
    if old_validated == canonical_root {
        return Err("Security violation: cannot rename the workspace root directory".to_string());
    }
    let parent = old_validated.parent().ok_or_else(|| "Source has no parent directory".to_string())?;
    let new_target = parent.join(&new_name);
    let new_validated = validate_path_in_workspace(&new_target, &workspace_root)?;
    if new_validated.exists() {
        return Err(format!("'{}' already exists", new_name));
    }
    fs::rename(old_validated, &new_validated).map_err(|e| e.to_string())?;
    Ok(new_validated.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_binary_file_base64(file_path: String) -> Result<String, String> {
    use base64::Engine;
    let workspace_root = crate::config::get_active_workspace_path();
    let validated = validate_path_in_workspace(Path::new(&file_path), &workspace_root)?;
    if !validated.exists() {
        return Err("File does not exist".to_string());
    }
    let bytes = fs::read(validated).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_binary_file_base64(file_path: String, base64_content: String) -> Result<(), String> {
    use base64::Engine;
    let workspace_root = crate::config::get_active_workspace_path();
    let validated = validate_path_in_workspace(Path::new(&file_path), &workspace_root)?;
    if let Some(parent) = validated.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    // Handle data URL prefix if present (e.g. data:application/pdf;base64,...)
    let clean_b64 = if let Some(idx) = base64_content.find(",") {
        &base64_content[idx + 1..]
    } else {
        &base64_content
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(clean_b64.trim())
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    fs::write(validated, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// Inspects a list of external filesystem paths and returns FileEntry metadata.
#[tauri::command]
pub fn inspect_paths(paths: Vec<String>) -> Vec<FileEntry> {
    paths
        .into_iter()
        .filter_map(|p| {
            let path = Path::new(&p);
            if path.exists() {
                let meta = path.metadata().ok()?;
                Some(FileEntry {
                    name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                    path: p,
                    is_dir: meta.is_dir(),
                    size: meta.len(),
                })
            } else {
                None
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_path_inside_workspace() {
        let ws = std::env::temp_dir().join("composer_test_sandbox");
        let _ = fs::create_dir_all(&ws);
        let test_file = ws.join("sample.txt");
        let _ = fs::write(&test_file, "hello");

        let validated = validate_path_in_workspace(&test_file, &ws);
        assert!(validated.is_ok());

        // Clean up
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn test_traversal_path_rejected() {
        let ws = std::env::temp_dir().join("composer_test_sandbox_trav");
        let _ = fs::create_dir_all(&ws);
        let evil = ws.join("..").join("outside.txt");

        let validated = validate_path_in_workspace(&evil, &ws);
        assert!(validated.is_err());

        // Clean up
        let _ = fs::remove_dir_all(&ws);
    }

    #[test]
    fn test_absolute_outside_path_rejected() {
        let ws = std::env::temp_dir().join("composer_test_sandbox_abs");
        let _ = fs::create_dir_all(&ws);
        let outside = std::env::temp_dir().join("some_other_dir_outside_ws");

        let validated = validate_path_in_workspace(&outside, &ws);
        assert!(validated.is_err());

        // Clean up
        let _ = fs::remove_dir_all(&ws);
    }
}
