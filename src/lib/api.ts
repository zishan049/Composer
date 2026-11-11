import { invoke } from "@tauri-apps/api/core";
import {
  AppConfig, FileEntry, WorkspaceStats, SearchResult,
  ParentWorkspace, WorktreeMetadata, WorktreeState,
  FileIntelligenceEntry, FileRelationship
} from "../types";

export type {
  WorkspaceStats, SearchResult,
  ParentWorkspace, WorktreeMetadata, WorktreeState,
  FileIntelligenceEntry, FileRelationship
};

// ── Config commands ──────────────────────────────────────────
export const getAppConfig = (): Promise<AppConfig> =>
  invoke("get_app_config");

export const saveAppConfig = (config: AppConfig): Promise<void> =>
  invoke("save_app_config", { config });

export const getAppVersion = (): Promise<string> =>
  invoke("get_app_version");

export const getAppInstallPath = (): Promise<string> =>
  invoke("get_app_install_path");

export const getWorkspacePath = (): Promise<string> =>
  invoke("get_workspace_path");

export const openWorkspaceDir = (path: string): Promise<AppConfig> =>
  invoke("open_workspace_dir", { path });

export const removeRecentWorkspace = (path: string): Promise<AppConfig> =>
  invoke("remove_recent_workspace", { path });

export const openInFileManager = (path?: string): Promise<void> =>
  invoke("open_in_file_manager", { path });

export const getCachePath = (): Promise<string> =>
  invoke("get_cache_path");

// ── Workspace/index commands ─────────────────────────────────
export const getWorkspaceStats = (): Promise<WorkspaceStats> =>
  invoke("get_workspace_stats");

export const listDirectoryContents = (dirPath: string): Promise<FileEntry[]> =>
  invoke("list_directory_contents", { dirPath });

export const listAllWorkspaceFiles = (): Promise<FileEntry[]> =>
  invoke("list_all_workspace_files");

export const getCachedWorkspaceIndex = (): Promise<FileEntry[]> =>
  invoke("get_cached_workspace_index");

export const invalidateWorkspaceIndex = (): Promise<void> =>
  invoke("invalidate_workspace_index");

export const searchWorkspace = (query: string): Promise<SearchResult[]> =>
  invoke("search_workspace", { query });

// ── File operation commands ───────────────────────────────────
export const readTextFile = (filePath: string): Promise<string> =>
  invoke("read_text_file", { filePath });

export const writeTextFile = (filePath: string, content: string): Promise<void> =>
  invoke("write_text_file", { filePath, content });

export const readBinaryFileBase64 = (filePath: string): Promise<string> =>
  invoke("read_binary_file_base64", { filePath });

export const writeBinaryFileBase64 = (filePath: string, base64Content: string): Promise<void> =>
  invoke("write_binary_file_base64", { filePath, base64Content });

export const createNewFile = (parentDir: string, name: string): Promise<string> =>
  invoke("create_new_file", { parentDir, name });

export const createNewFolder = (parentDir: string, name: string): Promise<string> =>
  invoke("create_new_folder", { parentDir, name });

export const deleteFileOrDir = (path: string): Promise<void> =>
  invoke("delete_file_or_dir", { path });

export const renameFileOrDir = (oldPath: string, newName: string): Promise<string> =>
  invoke("rename_file_or_dir", { oldPath, newName });

export const inspectPaths = (paths: string[]): Promise<FileEntry[]> =>
  invoke("inspect_paths", { paths });

// ── Dialog commands ───────────────────────────────────────────
export const pickDirectory = (): Promise<string | null> =>
  invoke("pick_directory");

export const pickDirectories = (): Promise<string[] | null> =>
  invoke("pick_directories");

export const pickFile = (): Promise<string | null> =>
  invoke("pick_file");

export const pickFiles = (): Promise<string[] | null> =>
  invoke("pick_files");

export const saveFileDialog = (defaultName?: string, defaultDir?: string): Promise<string | null> =>
  invoke("save_file_dialog", { defaultName, defaultDir });

// ── Import ────────────────────────────────────────────────────
export const importToDirectory = (sourcePath: string, destDir: string): Promise<string> =>
  invoke("import_to_directory", { sourcePath, destDir });

// ── Theme ─────────────────────────────────────────────────────
export const exportThemeToml = (
  theme: AppConfig["theme"],
  exportPath: string,
  overwrite?: boolean
): Promise<void> =>
  invoke("export_theme_toml", { theme, exportPath, overwrite });

export const importThemeToml = (importPath: string): Promise<AppConfig["theme"]> =>
  invoke("import_theme_toml", { importPath });

// ── System ────────────────────────────────────────────────────
export const getSystemRamUsage = (): Promise<number> =>
  invoke("get_system_ram_usage");

export const getSystemCpuUsage = (): Promise<number> =>
  invoke("get_system_cpu_usage");

// ── Worktree commands (v0.4) ──────────────────────────────────
export const getParentWorkspace = (workspacePath: string): Promise<ParentWorkspace | null> =>
  invoke("get_parent_workspace", { workspacePath });

export const createWorktree = (
  workspacePath: string,
  name: string,
  relativePath: string
): Promise<WorktreeMetadata> =>
  invoke("create_worktree", { workspacePath, name, relativePath });

export const renameWorktree = (
  workspacePath: string,
  worktreeId: string,
  newName: string
): Promise<WorktreeMetadata> =>
  invoke("rename_worktree", { workspacePath, worktreeId, newName });

export const setActiveWorktree = (
  workspacePath: string,
  worktreeId: string | null
): Promise<void> =>
  invoke("set_active_worktree", { workspacePath, worktreeId });

export const removeWorktree = (
  workspacePath: string,
  worktreeId: string,
  deleteFiles: boolean = false
): Promise<void> =>
  invoke("remove_worktree", { workspacePath, worktreeId, deleteFiles });

export const saveWorktreeState = (
  workspacePath: string,
  worktreeId: string,
  state: WorktreeState
): Promise<void> =>
  invoke("save_worktree_state", { workspacePath, worktreeId, state });

export const loadWorktreeState = (
  workspacePath: string,
  worktreeId: string
): Promise<WorktreeState | null> =>
  invoke("load_worktree_state", { workspacePath, worktreeId });

// ── File Intelligence commands (v0.4) ─────────────────────────
export const getFileIntelligence = (): Promise<FileIntelligenceEntry[]> =>
  invoke("get_file_intelligence");

export const getFileRelationships = (): Promise<FileRelationship[]> =>
  invoke("get_file_relationships");
