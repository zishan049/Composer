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

export interface ModelsConfig {
  default_llm: string;
  hf_token: string;
  default_whisper: string;
}

export interface MemoryConfig {
  enabled: boolean;
  size_limit_mb: number;
  compression_ratio_target: number;
  compression_model: string;
  default_scope: string;
}

export interface ModelCard {
  name: string;
  family: string;
  repo_id: string;
  filename: string;
  size_gb: number;
  quantization: string;
  context_length: number;
  estimated_ram_gb: number;
  estimated_vram_gb: number;
  author: string;
  downloads: number;
  is_downloaded: boolean;
  download_progress: number;
  gpu_layers: number;
  gpu_backend: string;
}

export interface GpuDevice {
  index: number;
  name: string;
  vram_total_mb: number;
  vram_free_mb: number;
  backend: string;
  compute_capability: string;
}

export interface WhisperModelInfo {
  name: string;
  size_mb: number;
  is_downloaded: boolean;
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

export interface VoiceConfig {
  enabled: boolean;
  active_whisper_model: string;
  microphone_device: string;
  language_hint: string;
  display_type: string; // "inline" | "popup"
}

export interface ChatConfig {
  auto_project_promotion_threshold: number;
  auto_project_promotion_enabled: boolean;
  project_naming_model: string;
  default_sort: string;
  default_ai_mode: string;
  context_overflow_enabled: boolean;
  context_overflow_buffer_percent: number;
  continuation_summary_model: string;
  auto_switch_to_continuation: boolean;
  show_context_summary_banner: string; // "always" | "collapsed" | "never"
  user_avatar_image?: string;
}

export interface SchedulerConfig {
  enabled: boolean;
  max_concurrent_inferences: number;
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
  models: ModelsConfig;
  memory: MemoryConfig;
  editor: EditorConfig;
  voice: VoiceConfig;
  chat: ChatConfig;
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
  type: string; // "app" | "ai"
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
  model?: string;
  skill?: string;
  prompt?: string;
  output_path?: string;
  output_mode?: string;
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

// -------------------------------------------------------------
// CONVERSATIONS & PROJECTS TYPES
// -------------------------------------------------------------
export interface ChatMessage {
  role: string; // "user" | "assistant"
  content: string;
  timestamp: string;
}

export interface ConversationSession {
  id: string;
  name: string;
  model: string;
  skill?: string | null;
  messages: ChatMessage[];
  created_at: string;
  project_id?: string | null;
  is_continued: boolean;
  continuation_summary?: string | null;
}

export interface ProjectMetadata {
  id: string;
  name: string;
  created_at: string;
  default_skill?: string | null;
}

export interface ProjectFolder {
  metadata: ProjectMetadata;
  chats: ConversationSession[];
}

export interface ChatListPayload {
  projects: ProjectFolder[];
  ungrouped: ConversationSession[];
}

// -------------------------------------------------------------
// MEMORY TYPES
// -------------------------------------------------------------
export interface MemoryNode {
  id: string;
  scope: string; // "global" | "document" | "project"
  context_id: string;
  content: string;
  created_at: string;
  is_pinned: boolean;
}

// -------------------------------------------------------------
// SKILLS TYPES
// -------------------------------------------------------------
export interface SkillTomlDetails {
  name: string;
  description: string;
  version: string;
  author: string;
  enabled: boolean;
}

export interface SkillScope {
  type: string; // "global" | "file_type" | "task_type"
  file_types?: string[] | null;
}

export interface SkillBehavior {
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  response_format: string;
}

export interface SkillMemory {
  use_long_term: boolean;
  inject_relevant_memories: boolean;
}

export interface SkillTriggers {
  auto_activate_on_file_open: boolean;
  auto_activate_on_chat_start: boolean;
}

export interface SkillDetails {
  skill: SkillTomlDetails;
  scope: SkillScope;
  behavior: SkillBehavior;
  memory: SkillMemory;
  triggers: SkillTriggers;
}

export interface IndexedChunk {
  file_name: string;
  file_path: string;
  chunk_index: number;
  header_scope: string;
  content: string;
  similarity_score: number;
}
