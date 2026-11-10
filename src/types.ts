// -------------------------------------------------------------
// APP CONFIGURATION TYPE DEFINITIONS
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
  nav_layout: string; // "sidebar" | "vertical_pills" | "top_navbar"
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
