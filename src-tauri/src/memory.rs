use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use chrono::Local;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryNode {
    pub id: String,
    pub scope: String,      // "global" | "document" | "project"
    pub context_id: String, // project_id, file_path, or empty for global
    pub content: String,
    pub created_at: String,
    pub is_pinned: bool,
}

pub fn get_memory_dir() -> PathBuf {
    crate::config::get_app_install_dir().join("storage").join("memory")
}

pub fn load_all_memories() -> Vec<MemoryNode> {
    let file_path = get_memory_dir().join("memory_store.json");
    if file_path.exists() {
        if let Ok(content) = fs::read_to_string(&file_path) {
            if let Ok(nodes) = serde_json::from_str::<Vec<MemoryNode>>(&content) {
                return nodes;
            }
        }
    }
    Vec::new()
}

pub fn save_all_memories(nodes: &[MemoryNode]) -> Result<(), String> {
    let dir = get_memory_dir();
    let _ = fs::create_dir_all(&dir);
    let file_path = dir.join("memory_store.json");
    let content = serde_json::to_string_pretty(nodes).map_err(|e| e.to_string())?;
    fs::write(file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn query_memories(scope: String, context_id: String, search_query: String) -> Vec<MemoryNode> {
    let nodes = load_all_memories();
    nodes.into_iter().filter(|node| {
        let scope_matches = node.scope == scope;
        let context_matches = node.context_id == context_id;
        
        if !scope_matches || !context_matches {
            return false;
        }
        
        if search_query.is_empty() {
            return true;
        }

        node.content.to_lowercase().contains(&search_query.to_lowercase())
    }).collect()
}

#[tauri::command]
pub fn add_memory_node(scope: String, context_id: String, content: String) -> Result<MemoryNode, String> {
    let mut nodes = load_all_memories();
    let new_node = MemoryNode {
        id: Uuid::new_v4().to_string(),
        scope,
        context_id,
        content,
        created_at: Local::now().to_rfc3339(),
        is_pinned: false,
    };
    nodes.push(new_node.clone());
    save_all_memories(&nodes)?;
    Ok(new_node)
}

#[tauri::command]
pub fn toggle_memory_pin(id: String) -> Result<bool, String> {
    let mut nodes = load_all_memories();
    let mut pinned = false;
    for node in nodes.iter_mut() {
        if node.id == id {
            node.is_pinned = !node.is_pinned;
            pinned = node.is_pinned;
            break;
        }
    }
    save_all_memories(&nodes)?;
    Ok(pinned)
}

#[tauri::command]
pub fn delete_memory_node(id: String) -> Result<(), String> {
    let mut nodes = load_all_memories();
    nodes.retain(|node| node.id != id);
    save_all_memories(&nodes)?;
    Ok(())
}

// Memory compression pipeline execution
#[tauri::command]
pub fn trigger_memory_compression(scope: String, context_id: String) -> Result<String, String> {
    let nodes = load_all_memories();
    
    // Separate unpinned and pinned memories for scope
    let (to_compress, mut remaining): (Vec<MemoryNode>, Vec<MemoryNode>) = nodes
        .into_iter()
        .partition(|node| node.scope == scope && node.context_id == context_id && !node.is_pinned);
        
    if to_compress.len() < 3 {
        return Ok("Not enough unpinned nodes to trigger compression.".to_string());
    }

    // Archive raw memories before compression
    let archive_dir = get_memory_dir().join("archive");
    let _ = fs::create_dir_all(&archive_dir);
    let archive_file = archive_dir.join(format!("archive-{}-{}.json", scope, Uuid::new_v4()));
    let archive_content = serde_json::to_string_pretty(&to_compress).unwrap();
    let _ = fs::write(archive_file, archive_content);

    // Create compressed summary node
    let compressed_text = format!(
        "[COMPRESSED MEMORY PREFERENCES]\nIn past sessions, user established the following preferences: {}\nThese preferences are synthesized from {} raw memory items archived locally.",
        to_compress.iter().map(|n| n.content.clone()).collect::<Vec<String>>().join("; "),
        to_compress.len()
    );

    let summary_node = MemoryNode {
        id: Uuid::new_v4().to_string(),
        scope: scope.clone(),
        context_id: context_id.clone(),
        content: compressed_text,
        created_at: Local::now().to_rfc3339(),
        is_pinned: true, // pin the summary automatically
    };

    remaining.push(summary_node);
    save_all_memories(&remaining)?;

    Ok(format!("Successfully compressed {} memory nodes into a single structured summary node.", to_compress.len()))
}
