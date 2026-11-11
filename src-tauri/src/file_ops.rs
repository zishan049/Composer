use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceStats {
    pub file_count: u32,
    pub folder_count: u32,
    pub total_size_bytes: u64,
    pub workspace_path: String,
    pub workspace_name: String,
    #[serde(default)]
    pub file_types: std::collections::HashMap<String, u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct SearchResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub match_type: String, // "exact_filename" | "prefix_filename" | "substring_filename" | "path" | "content"
    pub score: u8,          // 1: exact, 2: prefix, 3: substring, 4: path, 5: content
    pub snippet: Option<String>,
    pub line_number: Option<usize>,
}

// -------------------------------------------------------------
// NATIVE WORKSPACE SANDBOXING & BOUNDARY VALIDATION
// -------------------------------------------------------------

/// Validates that a target path is strictly located within the active workspace root.
/// Uses canonicalized paths to protect against `..` traversal, symlink escapes, and absolute path escapes.
pub fn validate_path_in_workspace(
    target_path: &Path,
    workspace_root: &Path,
) -> Result<PathBuf, String> {
    // 1. Canonicalize workspace root
    let canonical_root = workspace_root.canonicalize().map_err(|e| {
        format!(
            "Invalid workspace root '{}': {}",
            workspace_root.display(),
            e
        )
    })?;

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
                return Err(
                    "Security violation: path traversal components are prohibited".to_string(),
                );
            }
            non_existent_parts.push(file_name.to_os_string());
        }
        if let Some(parent) = ancestor.parent() {
            ancestor = parent.to_path_buf();
        } else {
            return Err(format!(
                "Invalid path '{}': no valid root found",
                target_path.display()
            ));
        }
    }

    // Canonicalize the existing ancestor directory
    let canonical_ancestor = ancestor.canonicalize().map_err(|e| {
        format!(
            "Failed to canonicalize ancestor '{}': {}",
            ancestor.display(),
            e
        )
    })?;

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
pub async fn list_directory_contents(dir_path: String) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
                let modified_ms = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64);
                entries.push(FileEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: entry.path().to_string_lossy().to_string(),
                    is_dir: metadata.is_dir(),
                    size: metadata.len(),
                    modified_ms,
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
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Recursively walks the workspace collecting file/folder entries (depth-limited).
fn walk_workspace_files(root_path: &Path) -> Vec<FileEntry> {
    let mut result = Vec::new();
    let mut dirs_to_visit = vec![(root_path.to_path_buf(), 0)];

    while let Some((dir, depth)) = dirs_to_visit.pop() {
        if depth > 5 {
            continue;
        } // limit depth for supreme performance
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();

                // Skip common heavy, hidden, and system directories (Cache is internal)
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == "target"
                    || name == "dist"
                    || name == "build"
                    || name == ".git"
                    || name == "Cache"
                // Composer system cache — do not index
                {
                    continue;
                }

                let metadata = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let is_dir = metadata.is_dir();
                // Get path relative to root
                let rel_path = path
                    .strip_prefix(root_path)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| name.clone())
                    .replace('\\', "/"); // standard slash format

                let modified_ms = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64);

                result.push(FileEntry {
                    name: rel_path.clone(),
                    path: path.to_string_lossy().to_string(),
                    is_dir,
                    size: metadata.len(),
                    modified_ms,
                });

                if is_dir {
                    dirs_to_visit.push((path, depth + 1));
                }
            }
        }
    }

    result
}

/// Writes the workspace index to `Cache/workspace_index.json`.
/// Uses compact serialization and skips the write entirely when the
/// serialized content is unchanged, so repeated walks do not keep
/// rewriting the file.
fn write_workspace_index(cache_dir: &Path, entries: &[FileEntry]) {
    let index_path = cache_dir.join("workspace_index.json");
    if let Ok(json) = serde_json::to_string(entries) {
        let changed = match fs::read_to_string(&index_path) {
            Ok(existing) => existing != json,
            Err(_) => true,
        };
        if changed {
            let _ = fs::write(&index_path, &json);
        }
    }
}

fn sort_entries_alphabetically(entries: &mut [FileEntry]) {
    entries.sort_by_key(|a| a.name.to_lowercase());
}

#[tauri::command]
pub async fn list_all_workspace_files() -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let root_path = crate::config::get_active_workspace_path();

        if !root_path.exists() {
            return Ok(Vec::new());
        }

        let mut result = walk_workspace_files(&root_path);

        // Sort alphabetically
        sort_entries_alphabetically(&mut result);

        // Write index to Cache for fast subsequent reads
        let cache_dir = crate::config::get_cache_dir();
        write_workspace_index(&cache_dir, &result);

        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Returns the cached workspace index from `Cache/workspace_index.json`.
/// Falls back to a live directory walk when no cache is present.
#[tauri::command]
pub async fn get_cached_workspace_index() -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let cache_dir = crate::config::get_cache_dir();
        let index_path = cache_dir.join("workspace_index.json");
        if index_path.exists() {
            if let Ok(content) = fs::read_to_string(&index_path) {
                if let Ok(entries) = serde_json::from_str::<Vec<FileEntry>>(&content) {
                    return Ok(entries);
                }
            }
        }
        // Cache miss — fall back to live walk
        let root_path = crate::config::get_active_workspace_path();
        if !root_path.exists() {
            return Ok(Vec::new());
        }

        let mut result = walk_workspace_files(&root_path);
        sort_entries_alphabetically(&mut result);
        write_workspace_index(&cache_dir, &result);

        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_text_file(file_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_root = crate::config::get_active_workspace_path();
        let validated = validate_path_in_workspace(Path::new(&file_path), &workspace_root)?;
        if !validated.exists() {
            return Err("File does not exist".to_string());
        }
        fs::read_to_string(validated).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Atomically writes text `content` to `path`: the data is first written to
/// a sibling temp file and then renamed over the target so a crash mid-write
/// cannot leave a truncated or corrupt file behind.
fn write_atomic_text(path: &Path, content: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "Invalid file path: no parent directory".to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(
        ".{}.{}.tmp-{}",
        file_name,
        std::process::id(),
        unique
    ));

    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn write_text_file(file_path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_root = crate::config::get_active_workspace_path();
        let validated = validate_path_in_workspace(Path::new(&file_path), &workspace_root)?;
        if let Some(parent) = validated.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        write_atomic_text(&validated, &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Returns a quick shallow estimate of workspace statistics by reading only
/// one level deep from the workspace root (no recursion). Fast and cheap.
#[tauri::command]
pub async fn get_workspace_stats() -> Result<WorkspaceStats, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let workspace_path = crate::config::get_active_workspace_path();
        let workspace_path_str = workspace_path.to_string_lossy().to_string();
        let workspace_name = workspace_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| workspace_path_str.clone());

        if !workspace_path.exists() {
            return Ok(WorkspaceStats {
                file_count: 0,
                folder_count: 0,
                total_size_bytes: 0,
                workspace_path: workspace_path_str,
                workspace_name,
                file_types: std::collections::HashMap::new(),
            });
        }

        let entries = walk_workspace_files(&workspace_path);
        let mut file_count: u32 = 0;
        let mut folder_count: u32 = 0;
        let mut total_size_bytes: u64 = 0;
        let mut file_types: std::collections::HashMap<String, u32> =
            std::collections::HashMap::new();

        for entry in &entries {
            if entry.is_dir {
                folder_count = folder_count.saturating_add(1);
            } else {
                file_count = file_count.saturating_add(1);
                total_size_bytes = total_size_bytes.saturating_add(entry.size);

                let ext = Path::new(&entry.name)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("other")
                    .to_lowercase();
                *file_types.entry(ext).or_insert(0) += 1;
            }
        }

        // Cache the index for instant subsequent operations
        let cache_dir = crate::config::get_cache_dir();
        write_workspace_index(&cache_dir, &entries);

        Ok(WorkspaceStats {
            file_count,
            folder_count,
            total_size_bytes,
            workspace_path: workspace_path_str,
            workspace_name,
            file_types,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Helper to delete `Cache/workspace_index.json` synchronously.
pub fn invalidate_cache_file() {
    let cache_dir = crate::config::get_cache_dir();
    let index_path = cache_dir.join("workspace_index.json");
    if index_path.exists() {
        let _ = fs::remove_file(&index_path);
    }
}

/// Deletes `Cache/workspace_index.json` so the next call to
/// `get_cached_workspace_index` triggers a fresh directory walk.
#[tauri::command]
pub async fn invalidate_workspace_index() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        invalidate_cache_file();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn is_searchable_text_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(
        ext.as_str(),
        "txt"
            | "md"
            | "markdown"
            | "json"
            | "toml"
            | "csv"
            | "yaml"
            | "yml"
            | "js"
            | "jsx"
            | "ts"
            | "tsx"
            | "html"
            | "htm"
            | "css"
            | "scss"
            | "rs"
            | "py"
            | "xml"
            | "sh"
            | "bash"
            | "sql"
            | "env"
    )
}

/// Deterministic workspace search ranking:
/// 1. Exact filename match
/// 2. Filename prefix match
/// 3. Filename substring match
/// 4. Path match
/// 5. Content match (for text files <= 1MB)
///
/// Stable tie-breaking: score ascending, then alphabetical by name, then path.
pub fn search_entries_with_ranking(
    entries: &[FileEntry],
    query: &str,
    limit: usize,
) -> Vec<SearchResult> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let query_lower = trimmed.to_lowercase();
    let mut results: Vec<SearchResult> = Vec::new();

    for entry in entries {
        let path_obj = Path::new(&entry.path);
        let file_name = path_obj
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| entry.name.clone());
        let file_name_lower = file_name.to_lowercase();
        let stem = path_obj
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| file_name.clone());
        let stem_lower = stem.to_lowercase();
        let rel_name_lower = entry.name.to_lowercase();

        // 1. Exact filename match (matches either full filename or file stem)
        if file_name_lower == query_lower || stem_lower == query_lower {
            results.push(SearchResult {
                name: entry.name.clone(),
                path: entry.path.clone(),
                is_dir: entry.is_dir,
                match_type: "exact_filename".to_string(),
                score: 1,
                snippet: None,
                line_number: None,
            });
            continue;
        }

        // 2. Filename prefix match
        if file_name_lower.starts_with(&query_lower) {
            results.push(SearchResult {
                name: entry.name.clone(),
                path: entry.path.clone(),
                is_dir: entry.is_dir,
                match_type: "prefix_filename".to_string(),
                score: 2,
                snippet: None,
                line_number: None,
            });
            continue;
        }

        // 3. Filename substring match
        if file_name_lower.contains(&query_lower) {
            results.push(SearchResult {
                name: entry.name.clone(),
                path: entry.path.clone(),
                is_dir: entry.is_dir,
                match_type: "substring_filename".to_string(),
                score: 3,
                snippet: None,
                line_number: None,
            });
            continue;
        }

        // 4. Path match
        if rel_name_lower.contains(&query_lower) {
            results.push(SearchResult {
                name: entry.name.clone(),
                path: entry.path.clone(),
                is_dir: entry.is_dir,
                match_type: "path".to_string(),
                score: 4,
                snippet: None,
                line_number: None,
            });
            continue;
        }

        // 5. Content match: search within supported text files < 1MB
        if !entry.is_dir && entry.size <= 1024 * 1024 && is_searchable_text_file(path_obj) {
            if let Ok(file_content) = fs::read_to_string(&entry.path) {
                for (idx, line) in file_content.lines().enumerate() {
                    if line.to_lowercase().contains(&query_lower) {
                        let trimmed_line = line.trim();
                        let snippet = if trimmed_line.chars().count() > 140 {
                            let snippet_str: String = trimmed_line.chars().take(140).collect();
                            format!("{}...", snippet_str)
                        } else {
                            trimmed_line.to_string()
                        };

                        results.push(SearchResult {
                            name: entry.name.clone(),
                            path: entry.path.clone(),
                            is_dir: false,
                            match_type: "content".to_string(),
                            score: 5,
                            snippet: Some(snippet),
                            line_number: Some(idx + 1),
                        });
                        break;
                    }
                }
            }
        }
    }

    results.sort_by(|a, b| {
        a.score
            .cmp(&b.score)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.path.cmp(&b.path))
    });

    if results.len() > limit {
        results.truncate(limit);
    }

    results
}

#[tauri::command]
pub async fn search_workspace(query: String) -> Result<Vec<SearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root_path = crate::config::get_active_workspace_path();
        if !root_path.exists() {
            return Ok(Vec::new());
        }

        let entries = {
            let cache_dir = crate::config::get_cache_dir();
            let index_path = cache_dir.join("workspace_index.json");
            if let Ok(content) = fs::read_to_string(&index_path) {
                serde_json::from_str::<Vec<FileEntry>>(&content)
                    .unwrap_or_else(|_| walk_workspace_files(&root_path))
            } else {
                walk_workspace_files(&root_path)
            }
        };

        Ok(search_entries_with_ranking(&entries, &query, 50))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_new_file(parent_dir: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if name.contains('/')
            || name.contains('\\')
            || name == ".."
            || name == "."
            || name.trim().is_empty()
        {
            return Err(
                "Invalid file name: path separators and traversal are prohibited".to_string(),
            );
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
        invalidate_cache_file();
        Ok(validated.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_new_folder(parent_dir: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if name.contains('/')
            || name.contains('\\')
            || name == ".."
            || name == "."
            || name.trim().is_empty()
        {
            return Err(
                "Invalid folder name: path separators and traversal are prohibited".to_string(),
            );
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
        invalidate_cache_file();
        Ok(validated.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_file_or_dir(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_root = crate::config::get_active_workspace_path();
        let canonical_root = workspace_root
            .canonicalize()
            .map_err(|e| format!("Invalid workspace root: {}", e))?;
        let validated = validate_path_in_workspace(Path::new(&path), &workspace_root)?;
        if !validated.exists() {
            return Err("Target does not exist".to_string());
        }
        if validated == canonical_root {
            return Err(
                "Security violation: cannot delete the workspace root directory".to_string(),
            );
        }
        if validated.is_dir() {
            fs::remove_dir_all(validated).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(validated).map_err(|e| e.to_string())?;
        }
        invalidate_cache_file();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rename_file_or_dir(old_path: String, new_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if new_name.contains('/')
            || new_name.contains('\\')
            || new_name == ".."
            || new_name == "."
            || new_name.trim().is_empty()
        {
            return Err(
                "Invalid new name: path separators and traversal are prohibited".to_string(),
            );
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
            return Err(
                "Security violation: cannot rename the workspace root directory".to_string(),
            );
        }
        let parent = old_validated
            .parent()
            .ok_or_else(|| "Source has no parent directory".to_string())?;
        let new_target = parent.join(&new_name);
        let new_validated = validate_path_in_workspace(&new_target, &workspace_root)?;
        if new_validated.exists() {
            return Err(format!("'{}' already exists", new_name));
        }
        fs::rename(old_validated, &new_validated).map_err(|e| e.to_string())?;
        invalidate_cache_file();
        Ok(new_validated.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_binary_file_base64(file_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let workspace_root = crate::config::get_active_workspace_path();
        let validated = validate_path_in_workspace(Path::new(&file_path), &workspace_root)?;
        if !validated.exists() {
            return Err("File does not exist".to_string());
        }
        let bytes = fs::read(validated).map_err(|e| e.to_string())?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_binary_file_base64(
    file_path: String,
    base64_content: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Inspects a list of filesystem paths and returns FileEntry metadata.
/// Only paths inside the active workspace or explicitly user-confirmed this
/// session (native dialog pick / drag-and-drop) are inspected — this command
/// must not act as a filesystem enumeration oracle for arbitrary paths.
#[tauri::command]
pub async fn inspect_paths(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<FileEntry>, String> {
    let session_paths = app.state::<crate::session::SessionPaths>();
    let allowed = session_paths.snapshot();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_root = crate::config::get_active_workspace_path();
        paths
            .into_iter()
            .filter(|p| {
                crate::session::is_in_allowed_set(&allowed, Path::new(p))
                    || validate_path_in_workspace(Path::new(p), &workspace_root).is_ok()
            })
            .filter_map(|p| {
                let path = Path::new(&p);
                if path.exists() {
                    let meta = path.metadata().ok()?;
                    let modified_ms = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64);
                    Some(FileEntry {
                        name: path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string(),
                        path: p,
                        is_dir: meta.is_dir(),
                        size: meta.len(),
                        modified_ms,
                    })
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_in_file_manager(path: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_root = crate::config::get_active_workspace_path();
        let target = match path {
            Some(ref p) if !p.trim().is_empty() => {
                validate_path_in_workspace(Path::new(p), &workspace_root)?
            }
            _ => workspace_root,
        };

        if !target.exists() {
            return Err("Target path does not exist on disk".to_string());
        }

        #[cfg(target_os = "windows")]
        {
            let mut cmd = std::process::Command::new("explorer");
            if target.is_file() {
                cmd.arg(format!("/select,{}", target.to_string_lossy()));
            } else {
                cmd.arg(target.to_string_lossy().to_string());
            }
            cmd.spawn().map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "macos")]
        {
            let mut cmd = std::process::Command::new("open");
            if target.is_file() {
                cmd.arg("-R");
            }
            cmd.arg(&target);
            cmd.spawn().map_err(|e| e.to_string())?;
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let mut cmd = std::process::Command::new("xdg-open");
            let dir = if target.is_file() {
                target.parent().unwrap_or(&target)
            } else {
                &target
            };
            cmd.arg(dir);
            cmd.spawn().map_err(|e| e.to_string())?;
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
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

    #[test]
    fn test_write_workspace_index_compact_and_skips_unchanged() {
        let dir = std::env::temp_dir().join("composer_test_workspace_index");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);

        let entries = vec![FileEntry {
            name: "a.md".to_string(),
            path: "/ws/a.md".to_string(),
            is_dir: false,
            size: 3,
            modified_ms: None,
        }];

        write_workspace_index(&dir, &entries);
        let index_path = dir.join("workspace_index.json");
        let content = fs::read_to_string(&index_path).expect("index should be written");
        // Compact serialization: no pretty-printed newlines.
        assert!(!content.contains('\n'), "index JSON should be compact");

        // A second write with identical content must not touch the file.
        let first_mtime = fs::metadata(&index_path).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        write_workspace_index(&dir, &entries);
        let second_mtime = fs::metadata(&index_path).unwrap().modified().unwrap();
        assert_eq!(
            first_mtime, second_mtime,
            "unchanged index must not be rewritten"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_write_text_file_atomic_does_not_corrupt_on_overwrite() {
        let dir = std::env::temp_dir().join("composer_test_atomic_text");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        // Write initial content
        let file = dir.join("test.txt");
        fs::write(&file, "initial").unwrap();
        // Overwrite atomically by using the write_atomic pattern
        // (this tests the helper function logic, since write_text_file needs Tauri runtime)
        write_atomic_text(&file, "updated").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "updated");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_deterministic_search_ranking() {
        let dir = std::env::temp_dir().join("composer_test_search_ranking");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);

        let file_exact = dir.join("readme.md");
        let file_prefix = dir.join("readme_notes.md");
        let file_sub = dir.join("project_readme.md");
        let file_path = dir.join("docs").join("architecture.md");
        let file_content = dir.join("content.txt");

        let _ = fs::create_dir_all(dir.join("docs"));
        fs::write(&file_exact, "Hello world").unwrap();
        fs::write(&file_prefix, "Hello notes").unwrap();
        fs::write(&file_sub, "Hello project").unwrap();
        fs::write(&file_path, "Hello architecture").unwrap();
        fs::write(
            &file_content,
            "Here is a guide with the term readme inside the body",
        )
        .unwrap();

        let entries = vec![
            FileEntry {
                name: "docs/architecture.md".to_string(),
                path: file_path.to_string_lossy().to_string(),
                is_dir: false,
                size: 20,
                modified_ms: None,
            },
            FileEntry {
                name: "project_readme.md".to_string(),
                path: file_sub.to_string_lossy().to_string(),
                is_dir: false,
                size: 20,
                modified_ms: None,
            },
            FileEntry {
                name: "readme.md".to_string(),
                path: file_exact.to_string_lossy().to_string(),
                is_dir: false,
                size: 20,
                modified_ms: None,
            },
            FileEntry {
                name: "readme_notes.md".to_string(),
                path: file_prefix.to_string_lossy().to_string(),
                is_dir: false,
                size: 20,
                modified_ms: None,
            },
            FileEntry {
                name: "content.txt".to_string(),
                path: file_content.to_string_lossy().to_string(),
                is_dir: false,
                size: 50,
                modified_ms: None,
            },
        ];

        let results = search_entries_with_ranking(&entries, "readme", 10);
        assert!(!results.is_empty());
        // Rank 1: exact filename match
        assert_eq!(results[0].match_type, "exact_filename");
        assert_eq!(results[0].name, "readme.md");
        // Rank 2: prefix filename match
        assert_eq!(results[1].match_type, "prefix_filename");
        assert_eq!(results[1].name, "readme_notes.md");
        // Rank 3: substring filename match
        assert_eq!(results[2].match_type, "substring_filename");
        assert_eq!(results[2].name, "project_readme.md");
        // Rank 5: content match (file_content has "readme" inside content)
        assert_eq!(results[3].match_type, "content");
        assert_eq!(results[3].name, "content.txt");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_workspace_stats_with_file_types() {
        let mut file_types = std::collections::HashMap::new();
        file_types.insert("md".to_string(), 4);
        file_types.insert("ts".to_string(), 8);

        let stats = WorkspaceStats {
            file_count: 12,
            folder_count: 3,
            total_size_bytes: 4096,
            workspace_path: "/workspace/my_project".to_string(),
            workspace_name: "my_project".to_string(),
            file_types,
        };

        let json = serde_json::to_string(&stats).expect("serialize");
        let parsed: WorkspaceStats = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.file_count, 12);
        assert_eq!(parsed.folder_count, 3);
        assert_eq!(parsed.file_types.get("md"), Some(&4));
        assert_eq!(parsed.file_types.get("ts"), Some(&8));
    }
}
