// -------------------------------------------------------------
// APP CONFIGURATION TYPE DEFINITIONS
// -------------------------------------------------------------
export interface GeneralConfig {
  app_name: string;
  language: string;
  date_format: string;
  launch_page: string;
  auto_update: boolean;
}

export interface StorageConfig {
  root_path: string;
  workspace_path: string;
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
}
