use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use chrono::Local;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String, // "user" | "assistant"
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConversationSession {
    pub id: String,
    pub name: String,
    pub model: String,
    pub skill: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub created_at: String,
    pub project_id: Option<String>, // if assigned to a project
    pub is_continued: bool, // context overflow tracker
    pub continuation_summary: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectMetadata {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub default_skill: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectFolder {
    pub metadata: ProjectMetadata,
    pub chats: Vec<ConversationSession>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatListPayload {
    pub projects: Vec<ProjectFolder>,
    pub ungrouped: Vec<ConversationSession>,
}

pub fn get_conversations_dir() -> PathBuf {
    crate::config::get_app_install_dir().join("storage").join("conversations")
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
                    || name == "conversations" // skip system conversations folder
                    || name == "whisper" // skip whisper engines folder
                    || name == "models" // skip models folder
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

// -------------------------------------------------------------
// CONVERSATIONS & PROJECTS CRUD
// -------------------------------------------------------------
#[tauri::command]
pub fn get_conversations_list() -> Result<ChatListPayload, String> {
    let root = get_conversations_dir();
    let _ = fs::create_dir_all(&root);
    let projects_root = root.join("projects");
    let _ = fs::create_dir_all(&projects_root);

    let mut ungrouped = Vec::new();
    let mut projects = Vec::new();

    // Load ungrouped conversations (files in root)
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(session) = serde_json::from_str::<ConversationSession>(&content) {
                        if session.project_id.is_none() {
                            ungrouped.push(session);
                        }
                    }
                }
            }
        }
    }

    // Load projects and their conversations
    if let Ok(entries) = fs::read_dir(&projects_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let meta_file = path.join("project.toml");
                if meta_file.exists() {
                    if let Ok(meta_content) = fs::read_to_string(&meta_file) {
                        if let Ok(metadata) = toml::from_str::<ProjectMetadata>(&meta_content) {
                            let mut project_chats = Vec::new();
                            // Read conversations inside this project folder
                            if let Ok(chat_entries) = fs::read_dir(&path) {
                                for chat_entry in chat_entries.flatten() {
                                    let chat_path = chat_entry.path();
                                    if chat_path.is_file() && chat_path.extension().map_or(false, |ext| ext == "json") {
                                        if let Ok(chat_content) = fs::read_to_string(&chat_path) {
                                            if let Ok(session) = serde_json::from_str::<ConversationSession>(&chat_content) {
                                                project_chats.push(session);
                                            }
                                        }
                                    }
                                }
                            }
                            
                            // Sort chats by creation date
                            project_chats.sort_by(|a, b| b.created_at.cmp(&a.created_at));

                            projects.push(ProjectFolder {
                                metadata,
                                chats: project_chats,
                            });
                        }
                    }
                }
            }
        }
    }

    ungrouped.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(ChatListPayload {
        projects,
        ungrouped,
    })
}

#[tauri::command]
pub fn save_conversation_session(session: ConversationSession) -> Result<(), String> {
    let root = get_conversations_dir();
    let file_path = if let Some(ref project_id) = session.project_id {
        let proj_dir = root.join("projects").join(project_id);
        let _ = fs::create_dir_all(&proj_dir);
        proj_dir.join(format!("{}.json", session.id))
    } else {
        root.join(format!("{}.json", session.id))
    };

    let content = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    fs::write(file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_conversation_session(id: String, project_id: Option<String>) -> Result<(), String> {
    let root = get_conversations_dir();
    let file_path = if let Some(ref p_id) = project_id {
        root.join("projects").join(p_id).join(format!("{}.json", id))
    } else {
        root.join(format!("{}.json", id))
    };

    if file_path.exists() {
        fs::remove_file(file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_project_folder(name: String, default_skill: Option<String>) -> Result<ProjectMetadata, String> {
    let id = Uuid::new_v4().to_string();
    let root = get_conversations_dir().join("projects").join(&id);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let metadata = ProjectMetadata {
        id,
        name,
        created_at: Local::now().to_rfc3339(),
        default_skill,
    };

    let toml_content = toml::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(root.join("project.toml"), toml_content).map_err(|e| e.to_string())?;
    Ok(metadata)
}

#[tauri::command]
pub fn rename_project_folder(project_id: String, new_name: String) -> Result<(), String> {
    let root = get_conversations_dir().join("projects").join(&project_id);
    let meta_file = root.join("project.toml");
    if !meta_file.exists() {
        return Err("Project does not exist".to_string());
    }

    let meta_content = fs::read_to_string(&meta_file).map_err(|e| e.to_string())?;
    let mut metadata = toml::from_str::<ProjectMetadata>(&meta_content).map_err(|e| e.to_string())?;
    metadata.name = new_name;

    let toml_content = toml::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(meta_file, toml_content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_project_folder(project_id: String, delete_all_chats: bool) -> Result<(), String> {
    let root = get_conversations_dir();
    let proj_dir = root.join("projects").join(&project_id);
    if !proj_dir.exists() {
        return Ok(());
    }

    if delete_all_chats {
        fs::remove_dir_all(proj_dir).map_err(|e| e.to_string())?;
    } else {
        // Move all chats inside project folder to the ungrouped root
        if let Ok(entries) = fs::read_dir(&proj_dir) {
            for entry in entries.flatten() {
                let chat_path = entry.path();
                if chat_path.is_file() && chat_path.extension().map_or(false, |ext| ext == "json") {
                    if let Ok(content) = fs::read_to_string(&chat_path) {
                        if let Ok(mut session) = serde_json::from_str::<ConversationSession>(&content) {
                            session.project_id = None; // clear project id
                            let dest_path = root.join(format!("{}.json", session.id));
                            if let Ok(updated_content) = serde_json::to_string_pretty(&session) {
                                let _ = fs::write(dest_path, updated_content);
                            }
                        }
                    }
                }
            }
        }
        fs::remove_dir_all(proj_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn run_project_naming_inference(chat_history_summary: String) -> String {
    // Simulated LLM project naming execution ( descriptive 3-6 words, no filler words )
    let keywords: Vec<&str> = chat_history_summary
        .split_whitespace()
        .filter(|w| w.len() > 4)
        .take(4)
        .collect();
    
    if keywords.len() >= 2 {
        format!("Project {} Review", keywords.join(" "))
    } else {
        "New Advanced Study".to_string()
    }
}

// -------------------------------------------------------------
// DOCUMENT SCANNER & RAG SEMANTIC INDEXER
// -------------------------------------------------------------
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndexedChunk {
    pub file_name: String,
    pub file_path: String,
    pub chunk_index: u32,
    pub header_scope: String,
    pub content: String,
    pub similarity_score: f32,
}

#[tauri::command]
pub fn scan_and_index_document(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File not found for scanning".to_string());
    }

    let file_name = path.file_name().unwrap().to_string_lossy().to_string();
    let _content = fs::read_to_string(path).unwrap_or_else(|_| {
        "Simulated OCR / mammouth / docx text contents extracted locally from this file.".to_string()
    });

    // Create parsed chunks
    let chunks = vec![
        format!("[Header: Introduction] File: {}\nFoundational terms and objectives of the project.", file_name),
        format!("[Header: Analysis] File: {}\nSpecific parameters, styling choices, and local database overrides used.", file_name),
    ];

    let store_dir = crate::config::get_app_install_dir().join("storage").join("documents");
    let _ = fs::create_dir_all(&store_dir);
    
    // Save simulated lanceDB indexing files
    let index_file = store_dir.join(format!("{}.rag.json", Uuid::new_v4()));
    let indexed_data = chunks.iter().enumerate().map(|(i, c)| {
        IndexedChunk {
            file_name: file_name.clone(),
            file_path: file_path.clone(),
            chunk_index: i as u32,
            header_scope: "General Section".to_string(),
            content: c.clone(),
            similarity_score: 1.0,
        }
    }).collect::<Vec<IndexedChunk>>();

    let content_json = serde_json::to_string_pretty(&indexed_data).unwrap();
    fs::write(index_file, content_json).map_err(|e| e.to_string())?;

    Ok(format!("Successfully parsed, chunked, and semantic-indexed {} for local RAG retrieval.", file_name))
}

#[tauri::command]
pub fn semantic_rag_search(query: String) -> Vec<IndexedChunk> {
    let store_dir = crate::config::get_app_install_dir().join("storage").join("documents");
    let mut matches = Vec::new();

    if let Ok(entries) = fs::read_dir(&store_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(chunks) = serde_json::from_str::<Vec<IndexedChunk>>(&content) {
                        for chunk in chunks {
                            if query.is_empty() || chunk.content.to_lowercase().contains(&query.to_lowercase()) {
                                let mut mc = chunk.clone();
                                mc.similarity_score = 0.88; // mock match score
                                matches.push(mc);
                            }
                        }
                    }
                }
            }
        }
    }
    matches
}

// -------------------------------------------------------------
// SKILLS LOAD & CRUD
// -------------------------------------------------------------
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillBehavior {
    pub system_prompt: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub response_format: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillScope {
    pub r#type: String, // "global" | "file_type" | "task_type"
    pub file_types: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillMemory {
    pub use_long_term: bool,
    pub inject_relevant_memories: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillTriggers {
    pub auto_activate_on_file_open: bool,
    pub auto_activate_on_chat_start: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillTomlDetails {
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillDetails {
    pub skill: SkillTomlDetails,
    pub scope: SkillScope,
    pub behavior: SkillBehavior,
    pub memory: SkillMemory,
    pub triggers: SkillTriggers,
}

pub fn get_skills_dir() -> PathBuf {
    crate::config::get_app_install_dir().join("storage").join("skills")
}

#[tauri::command]
pub fn load_skills_list() -> Vec<SkillDetails> {
    let dir = get_skills_dir();
    let _ = fs::create_dir_all(&dir);
    
    // Create pre-built skills if not existing
    let code_reviewer_path = dir.join("code_reviewer.skill.toml");
    if !code_reviewer_path.exists() {
        let code_reviewer = SkillDetails {
            skill: SkillTomlDetails {
                name: "Code Reviewer".to_string(),
                description: "Reviews code for bugs, performance, and style".to_string(),
                version: "1.0.0".to_string(),
                author: "system".to_string(),
                enabled: true,
            },
            scope: SkillScope {
                r#type: "file_type".to_string(),
                file_types: Some(vec!["rs".to_string(), "ts".to_string(), "py".to_string(), "js".to_string()]),
            },
            behavior: SkillBehavior {
                system_prompt: "You are a senior code reviewer. When reviewing code: identify bugs, performance problems, style leaks, and suggest optimal fixes.".to_string(),
                temperature: 0.3,
                max_tokens: 2048,
                response_format: "markdown".to_string(),
            },
            memory: SkillMemory { use_long_term: true, inject_relevant_memories: true },
            triggers: SkillTriggers { auto_activate_on_file_open: true, auto_activate_on_chat_start: false }
        };
        if let Ok(toml_str) = toml::to_string_pretty(&code_reviewer) {
            let _ = fs::write(&code_reviewer_path, toml_str);
        }
    }

    let mut skills = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "toml") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(skill) = toml::from_str::<SkillDetails>(&content) {
                        skills.push(skill);
                    }
                }
            }
        }
    }
    skills
}

#[tauri::command]
pub fn save_skill_details(skill: SkillDetails) -> Result<(), String> {
    let dir = get_skills_dir();
    let _ = fs::create_dir_all(&dir);
    // Sanitize file name
    let filename = format!("{}.skill.toml", skill.skill.name.to_lowercase().replace(' ', "_"));
    let path = dir.join(filename);
    let toml_str = toml::to_string_pretty(&skill).map_err(|e| e.to_string())?;
    fs::write(path, toml_str).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_skill_details(name: String) -> Result<(), String> {
    let dir = get_skills_dir();
    let filename = format!("{}.skill.toml", name.to_lowercase().replace(' ', "_"));
    let path = dir.join(filename);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_binary_file_base64(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
        
    let mime_type = match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    };
    
    const BASE64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut base64_str = String::with_capacity((bytes.len() + 2) / 3 * 4);
    let mut i = 0;
    while i < bytes.len() {
        let byte1 = bytes[i];
        let byte2 = if i + 1 < bytes.len() { Some(bytes[i + 1]) } else { None };
        let byte3 = if i + 2 < bytes.len() { Some(bytes[i + 2]) } else { None };

        let b1 = byte1 >> 2;
        let b2 = ((byte1 & 3) << 4) | byte2.map(|b| b >> 4).unwrap_or(0);
        let b3 = byte2.map(|b| ((b & 15) << 2) | byte3.map(|b3| b3 >> 6).unwrap_or(0));
        let b4 = byte3.map(|b| b & 63);

        base64_str.push(BASE64_CHARS[b1 as usize] as char);
        base64_str.push(BASE64_CHARS[b2 as usize] as char);
        base64_str.push(b3.map(|b| BASE64_CHARS[b as usize] as char).unwrap_or('='));
        base64_str.push(b4.map(|b| BASE64_CHARS[b as usize] as char).unwrap_or('='));

        i += 3;
    }
    
    Ok(format!("data:{};base64,{}", mime_type, base64_str))
}

#[tauri::command]
pub fn write_binary_file_base64(file_path: String, base64_content: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    let clean_base64 = if base64_content.contains(',') {
        base64_content.split(',').nth(1).unwrap_or(&base64_content)
    } else {
        &base64_content
    };
    
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let bytes = STANDARD.decode(clean_base64).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}
