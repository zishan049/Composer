//! Composer v0.4 — File Intelligence backend
//!
//! Provides real file metadata extraction and deterministic static-analysis
//! relationship detection for the File Intelligence screen.
//! Does NOT execute user files. All analysis is based on file contents and metadata.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// ── File category detection ───────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileCategory {
    Code,
    Document,
    Markdown,
    Image,
    Media,
    Data,
    Config,
    Other,
}

fn classify_extension(ext: &str) -> FileCategory {
    match ext.to_lowercase().as_str() {
        // Markdown
        "md" | "mdx" | "markdown" => FileCategory::Markdown,
        // Code
        "rs" | "js" | "jsx" | "ts" | "tsx" | "py" | "rb" | "go" | "c" | "cpp" | "h" | "hpp"
        | "java" | "cs" | "swift" | "kt" | "php" | "lua" | "zig" | "dart" | "scala" | "clj"
        | "ex" | "exs" | "elm" | "ml" | "mli" | "fs" | "fsx" | "sh" | "bash" | "zsh" | "fish"
        | "ps1" | "bat" | "cmd" | "mjs" | "cjs" | "vue" | "svelte" | "astro" | "html" | "htm"
        | "css" | "scss" | "sass" | "less" | "styl" | "tf" | "hcl" | "sol" => FileCategory::Code,
        // Data / serialization
        "json" | "jsonc" | "json5" | "toml" | "yaml" | "yml" | "xml" | "csv" | "tsv" | "ndjson"
        | "parquet" => FileCategory::Data,
        // Config
        "env" | "gitignore" | "gitattributes" | "dockerignore" | "editorconfig" | "eslintrc"
        | "prettierrc" | "babelrc" | "npmrc" | "nvmrc" | "tool-versions" | "cargo.lock"
        | "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock" | "makefile" | "dockerfile"
        | "containerfile" | "ini" | "cfg" | "conf" | "lock" => FileCategory::Config,
        // Documents
        "txt" | "rtf" | "doc" | "docx" | "odt" | "pdf" | "tex" | "org" | "rst" | "adoc"
        | "asciidoc" => FileCategory::Document,
        // Images
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "tiff" | "tif" | "avif"
        | "heic" | "heif" | "svg" | "eps" | "ai" | "psd" | "xcf" | "sketch" | "figma" => {
            FileCategory::Image
        }
        // Media
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "flv" | "wmv" | "m4v" | "mp3" | "wav" | "flac"
        | "ogg" | "m4a" | "aac" | "opus" | "wma" => FileCategory::Media,
        _ => FileCategory::Other,
    }
}

/// Checks whether a file is likely binary by scanning its first 8KB.
/// Returns true if more than 30% of bytes are non-printable (excluding
/// common whitespace), which is a reliable heuristic for binary content.
fn is_binary(path: &Path) -> bool {
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    let sample = &bytes[..bytes.len().min(8192)];
    if sample.is_empty() {
        return false;
    }
    let non_printable = sample
        .iter()
        .filter(|&&b| b < 0x08 || (b > 0x0D && b < 0x20) || b == 0x7F)
        .count();
    non_printable * 10 > sample.len() * 3
}

fn count_lines(path: &Path, binary: bool) -> Option<usize> {
    if binary {
        return None;
    }
    // Only count lines for files up to 2 MB
    let meta = fs::metadata(path).ok()?;
    if meta.len() > 2 * 1024 * 1024 {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    Some(content.lines().count())
}

// ── Entry struct ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileIntelligenceEntry {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub category: FileCategory,
    pub size_bytes: u64,
    pub modified_ms: u64,
    pub created_ms: Option<u64>,
    pub mime_type: Option<String>,
    pub line_count: Option<usize>,
    pub is_binary: bool,
}

// ── Relationship detection ────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileRelationship {
    pub source_path: String,
    pub target_path: String,
    pub relationship_type: String,
    pub confidence: String,
}

/// Detect relationships from a text file's contents.
/// Only uses deterministic static analysis — no execution.
fn detect_relationships_in_file(
    file_path: &Path,
    content: &str,
    all_files: &[PathBuf],
    workspace_root: &Path,
) -> Vec<FileRelationship> {
    let mut rels = Vec::new();
    let ext = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    // Build a lookup from filename -> full path for quick resolution
    let name_to_path: std::collections::HashMap<String, &PathBuf> = all_files
        .iter()
        .map(|p| {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            (name.to_string(), p)
        })
        .collect();

    let resolve_ref = |ref_str: &str| -> Option<String> {
        // Try as relative path from workspace root
        let candidate = workspace_root.join(ref_str);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
        // Try relative to source file's directory
        if let Some(parent) = file_path.parent() {
            let candidate = parent.join(ref_str);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        // Fallback: match by filename
        let basename = Path::new(ref_str)
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        name_to_path
            .get(basename.as_str())
            .map(|p| p.to_string_lossy().to_string())
    };

    let src_str = file_path.to_string_lossy().to_string();

    match ext.as_str() {
        "html" | "htm" => {
            // <link rel="stylesheet" href="...">
            for cap in content.split("href=\"").skip(1) {
                if let Some(end) = cap.find('"') {
                    let href = cap[..end].trim();
                    if !href.is_empty() && !href.starts_with("http") && !href.starts_with('#') {
                        if let Some(target) = resolve_ref(href) {
                            let rel_type = if href.ends_with(".css") {
                                "html_references_css"
                            } else if href.ends_with(".js") || href.ends_with(".mjs") {
                                "html_references_js"
                            } else {
                                continue;
                            };
                            rels.push(FileRelationship {
                                source_path: src_str.clone(),
                                target_path: target,
                                relationship_type: rel_type.to_string(),
                                confidence: "high".to_string(),
                            });
                        }
                    }
                }
            }
            // <script src="...">
            for cap in content.split("src=\"").skip(1) {
                if let Some(end) = cap.find('"') {
                    let src = cap[..end].trim();
                    if !src.is_empty()
                        && !src.starts_with("http")
                        && (src.ends_with(".js") || src.ends_with(".mjs"))
                    {
                        if let Some(target) = resolve_ref(src) {
                            rels.push(FileRelationship {
                                source_path: src_str.clone(),
                                target_path: target,
                                relationship_type: "html_references_js".to_string(),
                                confidence: "high".to_string(),
                            });
                        }
                    }
                }
            }
        }
        "md" | "mdx" | "markdown" => {
            // [text](link) — only internal links
            for cap in content.split("](").skip(1) {
                if let Some(end) = cap.find(')') {
                    let href = cap[..end].trim();
                    if !href.is_empty() && !href.starts_with("http") && !href.starts_with('#') {
                        // Strip anchors
                        let clean = href.split('#').next().unwrap_or(href);
                        if !clean.is_empty() {
                            if let Some(target) = resolve_ref(clean) {
                                rels.push(FileRelationship {
                                    source_path: src_str.clone(),
                                    target_path: target,
                                    relationship_type: "md_links_to".to_string(),
                                    confidence: "high".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
        "js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs" => {
            // import '...' / require('...')
            for line in content.lines() {
                let line = line.trim();
                let ref_str = if line.starts_with("import") {
                    // import ... from '...'
                    line.rsplit("from").next().and_then(|s| {
                        let s = s.trim().trim_matches(';');
                        if s.starts_with('"') || s.starts_with('\'') {
                            Some(&s[1..s.len() - 1])
                        } else {
                            None
                        }
                    })
                } else if line.contains("require(") {
                    line.split("require(").nth(1).and_then(|s| {
                        let s = s.trim();
                        if s.starts_with('"') || s.starts_with('\'') {
                            let inner = &s[1..];
                            inner.find(['"', '\'']).map(|e| &inner[..e])
                        } else {
                            None
                        }
                    })
                } else {
                    None
                };

                if let Some(r) = ref_str {
                    if !r.is_empty() && (r.starts_with('.') || r.starts_with('/')) {
                        if let Some(target) = resolve_ref(r) {
                            rels.push(FileRelationship {
                                source_path: src_str.clone(),
                                target_path: target,
                                relationship_type: "imports".to_string(),
                                confidence: "high".to_string(),
                            });
                        }
                    }
                }
            }
        }
        _ => {}
    }

    rels
}

// ── Main analysis command ─────────────────────────────────────────

#[tauri::command]
pub async fn get_file_intelligence() -> Result<Vec<FileIntelligenceEntry>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let root = crate::config::get_active_workspace_path();
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut entries = Vec::new();
        walk_for_intelligence(&root, &mut entries);
        // Sort: category, then name
        entries.sort_by(|a, b| {
            format!("{:?}", a.category)
                .cmp(&format!("{:?}", b.category))
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn walk_for_intelligence(dir: &Path, out: &mut Vec<FileIntelligenceEntry>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden, system, and heavy-build directories
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "dist"
            || name == "build"
            || name == ".git"
            || name == "Cache"
        {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if metadata.is_dir() {
            walk_for_intelligence(&path, out);
        } else if metadata.is_file() {
            // Skip very large files for analysis
            if metadata.len() > 50 * 1024 * 1024 {
                continue;
            }

            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default()
                .to_string();

            let category = classify_extension(&ext);

            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let created_ms = metadata
                .created()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);

            let binary = is_binary(&path);
            let line_count = count_lines(&path, binary);

            let mime_type = mime_from_ext(&ext);

            out.push(FileIntelligenceEntry {
                path: path.to_string_lossy().to_string(),
                name,
                extension: ext,
                category,
                size_bytes: metadata.len(),
                modified_ms,
                created_ms,
                mime_type,
                line_count,
                is_binary: binary,
            });
        }
    }
}

fn mime_from_ext(ext: &str) -> Option<String> {
    let m = match ext {
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" => "application/typescript",
        "json" => "application/json",
        "xml" => "application/xml",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "md" | "markdown" => "text/markdown",
        "txt" => "text/plain",
        "toml" => "application/toml",
        "yaml" | "yml" => "application/yaml",
        "csv" => "text/csv",
        "rs" => "text/x-rust",
        "py" => "text/x-python",
        "sh" => "application/x-sh",
        _ => return None,
    };
    Some(m.to_string())
}

#[tauri::command]
pub async fn get_file_relationships() -> Result<Vec<FileRelationship>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let root = crate::config::get_active_workspace_path();
        if !root.exists() {
            return Ok(Vec::new());
        }

        // Collect all file paths first
        let mut all_paths: Vec<PathBuf> = Vec::new();
        collect_paths(&root, &mut all_paths);

        let mut all_rels: Vec<FileRelationship> = Vec::new();

        for path in &all_paths {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            // Only analyse text-based files for relationships
            match ext.as_str() {
                "html" | "htm" | "md" | "mdx" | "markdown" | "js" | "jsx" | "ts" | "tsx"
                | "mjs" | "cjs" => {}
                _ => continue,
            }

            // Skip large files
            if let Ok(meta) = fs::metadata(path) {
                if meta.len() > 2 * 1024 * 1024 {
                    continue;
                }
            }

            if let Ok(content) = fs::read_to_string(path) {
                let rels = detect_relationships_in_file(path, &content, &all_paths, &root);
                all_rels.extend(rels);
            }
        }

        // Deduplicate
        all_rels.dedup_by(|a, b| {
            a.source_path == b.source_path
                && a.target_path == b.target_path
                && a.relationship_type == b.relationship_type
        });

        Ok(all_rels)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn collect_paths(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "dist"
            || name == "build"
            || name == ".git"
            || name == "Cache"
        {
            continue;
        }
        if path.is_dir() {
            collect_paths(&path, out);
        } else {
            out.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_code_extensions() {
        assert_eq!(classify_extension("rs"), FileCategory::Code);
        assert_eq!(classify_extension("ts"), FileCategory::Code);
        assert_eq!(classify_extension("tsx"), FileCategory::Code);
        assert_eq!(classify_extension("html"), FileCategory::Code);
    }

    #[test]
    fn test_classify_markdown() {
        assert_eq!(classify_extension("md"), FileCategory::Markdown);
        assert_eq!(classify_extension("mdx"), FileCategory::Markdown);
    }

    #[test]
    fn test_classify_data() {
        assert_eq!(classify_extension("json"), FileCategory::Data);
        assert_eq!(classify_extension("csv"), FileCategory::Data);
        assert_eq!(classify_extension("toml"), FileCategory::Data);
    }

    #[test]
    fn test_classify_image() {
        assert_eq!(classify_extension("png"), FileCategory::Image);
        assert_eq!(classify_extension("svg"), FileCategory::Image);
    }

    #[test]
    fn test_classify_config() {
        assert_eq!(classify_extension("env"), FileCategory::Config);
        assert_eq!(classify_extension("gitignore"), FileCategory::Config);
    }

    #[test]
    fn test_binary_detection_text_file() {
        let dir = std::env::temp_dir().join("composer_intel_test");
        std::fs::create_dir_all(&dir).ok();
        let path = dir.join("test.txt");
        std::fs::write(&path, "Hello, world!\nThis is a text file.\n").unwrap();
        assert!(!is_binary(&path));
        std::fs::remove_dir_all(&dir).ok();
    }
}
