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

export interface SchedulerConfig {
  enabled: boolean;
  default_notification_behavior: string; // "complete" | "fail_only" | "silent"
  log_retention_runs: number;
  retry_default: string; // "none" | "once" | "3_times"
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
  scheduler: SchedulerConfig;
  theme: ThemeConfig;
}

// -------------------------------------------------------------
// SCHEDULER TASK TYPES
// -------------------------------------------------------------
export interface TaskSection {
  id: string;
  name: string;
  description: string;
  type: string; // "app"
  enabled: boolean;
  created_at: string;
  last_run: string;
  last_status: string; // "success" | "failed" | "never"
}

export interface ScheduleSection {
  frequency: string; // "once" | "recurring" | "on_event"
  run_at: string;
  cron: string;
  human_readable: string;
  event: string;
}

export interface ActionSection {
  operation?: string;
  source_path?: string;
  destination_path?: string;
}

export interface NotificationsSection {
  on_start: boolean;
  on_complete: boolean;
  on_fail: boolean;
  include_result_preview: boolean;
}

export interface ScheduledTask {
  task: TaskSection;
  schedule: ScheduleSection;
  action: ActionSection;
  notifications: NotificationsSection;
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
