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
// EXPLORER PATH UTILITIES & OPERATIONS
// -------------------------------------------------------------
#[tauri::command]
pub fn list_directory_contents(dir_path: String) -> Result<Vec<FileEntry>, String> {
    let target_path = if dir_path.is_empty() {
        // Use the user-configured workspace root from config
        let cfg = crate::config::load_config();
        if !cfg.storage.workspace_path.is_empty() {
            PathBuf::from(&cfg.storage.workspace_path)
        } else if !cfg.storage.root_path.is_empty() {
            PathBuf::from(&cfg.storage.root_path)
        } else {
            crate::config::get_app_install_dir().join("storage")
        }
    } else {
        PathBuf::from(&dir_path)
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
    let cfg = crate::config::load_config();
    let root_path = if !cfg.storage.workspace_path.is_empty() {
        PathBuf::from(&cfg.storage.workspace_path)
    } else if !cfg.storage.root_path.is_empty() {
        PathBuf::from(&cfg.storage.root_path)
    } else {
        crate::config::get_app_install_dir().join("storage")
    };

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
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text_file(file_path: String, content: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_new_file(parent_dir: String, name: String) -> Result<String, String> {
    let path = PathBuf::from(parent_dir).join(name);
    if path.exists() {
        return Err("File already exists".to_string());
    }
    fs::write(&path, "").map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_new_folder(parent_dir: String, name: String) -> Result<String, String> {
    let path = PathBuf::from(parent_dir).join(name);
    if path.exists() {
        return Err("Folder already exists".to_string());
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_file_or_dir(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("Target does not exist".to_string());
    }
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_file_or_dir(old_path: String, new_name: String) -> Result<String, String> {
    let old = Path::new(&old_path);
    if !old.exists() {
        return Err("Source file does not exist".to_string());
    }
    let parent = old.parent().unwrap_or_else(|| Path::new(""));
    let new_path = parent.join(new_name);
    fs::rename(old, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_binary_file_base64(file_path: String) -> Result<String, String> {
    use base64::Engine;
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_binary_file_base64(file_path: String, base64_content: String) -> Result<(), String> {
    use base64::Engine;
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
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
    fs::write(path, bytes).map_err(|e| e.to_string())?;
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
