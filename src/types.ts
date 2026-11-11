// -------------------------------------------------------------
// APP CONFIGURATION TYPE DEFINITIONS
// -------------------------------------------------------------
//
// v0.4 — Added Worktree types, FileIntelligence types,
//         per-document dirty state, search filter types
// -------------------------------------------------------------
export interface GeneralConfig {
  app_name: string;
  language: string;
  date_format: string;
  launch_page: string;
  auto_update: boolean;
  onboarding_completed: boolean;
}

export interface RecentWorkspace {
  path: string;
  name: string;
  last_opened: number;
}

export interface StorageConfig {
  root_path: string;
  workspace_path: string;
  recent_workspaces?: RecentWorkspace[];
}

export interface EditorConfig {
  font_family: string;
  font_size: number;
  line_height: number;
  tab_size: number;
  auto_save_interval_sec: number;
  vim_mode: boolean;
  max_versions_per_file: number;
  total_version_storage_limit_mb: number;
}

export interface ThemeConfig {
  theme_preset: string; // "light" | "dark" | "system"
  accent_color: string;
  background_override: string;
  font_family_ui: string;
  font_size_ui: number;
  compact_mode: boolean;
  reduce_motion: boolean;
  
  // Custom layout properties
  nav_layout: "top_navbar" | "bottom_navbar" | string;
  nav_sidebar_width: number;
  nav_show_app_label: boolean;
  nav_show_status_bar: boolean;
  nav_separator_line: boolean;
  nav_separator_color: string;
  nav_glass_effect: boolean;
  
  ui_overrides: Record<string, string>;
}

export interface AppConfig {
  general: GeneralConfig;
  storage: StorageConfig;
  editor: EditorConfig;
  theme: ThemeConfig;
}


// -------------------------------------------------------------
// FILE EXPLORER TYPES
// -------------------------------------------------------------
export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_ms?: number;
}

// -------------------------------------------------------------
// WORKSPACE STATS
// -------------------------------------------------------------
export interface WorkspaceStats {
  file_count: number;
  folder_count: number;
  total_size_bytes: number;
  workspace_path: string;
  workspace_name: string;
  file_types?: Record<string, number>;
}

export interface RecentFile {
  path: string;
  filename: string;
  lastOpened: number;
}

// -------------------------------------------------------------
// SEARCH TYPES
// -------------------------------------------------------------
export interface SearchResult {
  name: string;
  path: string;
  is_dir: boolean;
  match_type: "exact_filename" | "prefix_filename" | "substring_filename" | "path" | "content";
  score: number;
  snippet?: string;
  line_number?: number;
}

export type SearchFilterType = "all" | "md" | "code" | "data" | "text" | "image" | "config";

export interface SearchFilters {
  type: SearchFilterType;
  extension?: string;
  folder?: string;
}

// -------------------------------------------------------------
// WORKTREE TYPES (v0.4)
// -------------------------------------------------------------

export type WorktreeId = string;

export interface WorktreeMetadata {
  id: WorktreeId;
  name: string;
  parent_workspace_id: string;
  root_path: string;
  created_ms: number;
  last_opened_ms: number;
}

export interface ParentWorkspace {
  id: string;
  name: string;
  root_path: string;
  worktrees: WorktreeMetadata[];
  active_worktree_id: WorktreeId | null;
  created_ms: number;
  last_opened_ms: number;
}

export interface WorktreeState {
  worktree_id: WorktreeId;
  open_tab_paths: string[];
  active_tab_path: string | null;
  scroll_positions: Record<string, number>;
  cursor_positions: Record<string, { line: number; column: number }>;
}

// -------------------------------------------------------------
// FILE INTELLIGENCE TYPES (v0.4)
// -------------------------------------------------------------

export type FileCategory =
  | "code"
  | "document"
  | "markdown"
  | "image"
  | "media"
  | "data"
  | "config"
  | "other";

export interface FileIntelligenceEntry {
  path: string;
  name: string;
  extension: string;
  category: FileCategory;
  size_bytes: number;
  modified_ms: number;
  created_ms?: number;
  mime_type?: string;
  line_count?: number;
  is_binary: boolean;
}

export interface FileRelationship {
  source_path: string;
  target_path: string;
  relationship_type:
    | "html_references_css"
    | "html_references_js"
    | "md_links_to"
    | "imports"
    | "config_for";
  confidence: "high" | "medium";
}

// -------------------------------------------------------------
// BULK OPERATIONS (v0.4)
// -------------------------------------------------------------

export interface BulkOperationItem {
  path: string;
  name: string;
  is_dir: boolean;
}

export type BulkOperationType = "move" | "delete" | "rename_batch";

export interface BulkOperationPlan {
  type: BulkOperationType;
  items: BulkOperationItem[];
  destination?: string;
  collision_count: number;
  warnings: string[];
}

export interface BulkOperationResult {
  succeeded: string[];
  failed: { path: string; error: string }[];
}

// -------------------------------------------------------------
// PER-DOCUMENT DIRTY STATE (v0.4)
// -------------------------------------------------------------

export interface DocumentDirtyState {
  path: string;
  is_dirty: boolean;
}

export interface WorkspaceDirtyState {
  documents: Record<string, boolean>;
  has_any_dirty: boolean;
}
