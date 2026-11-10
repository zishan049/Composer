import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Clock,
  FileText,
  FileCode,
  Folder,
  Image as ImageIcon,
  Table as TableIcon,
  HardDrive,
  Trash2,
  X,
  AlertCircle,
  FolderOpen,
} from "lucide-react";
import { FileEntry, RecentFile, RecentWorkspace } from "../types";
import { getRecentFiles, removeRecentFile, formatRelativeTime } from "../utils/recentFiles";
import { inspectPaths, getCachedWorkspaceIndex, listAllWorkspaceFiles } from "../lib/api";
import { SvgFileIcon } from "./SvgFileIcon";
import { MarkdownFileIcon } from "./MarkdownFileIcon";

interface RecentViewProps {
  onOpenFile: (path: string, filename: string) => void;
  onSelectWorkspace: (path: string) => void;
  onRemoveRecentWorkspace: (path: string) => void;
  recentWorkspaces: RecentWorkspace[];
  currentWorkspace: string;
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "0 B";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${val} ${sizes[i] || "B"}`;
}

export const RecentView: React.FC<RecentViewProps> = ({
  onOpenFile,
  onSelectWorkspace,
  onRemoveRecentWorkspace,
  recentWorkspaces,
  currentWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<"opened" | "modified" | "workspaces">("opened");
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [availablePaths, setAvailablePaths] = useState<Set<string>>(new Set());
  const [workspaceFiles, setWorkspaceFiles] = useState<FileEntry[]>([]);

  // Load recently opened files from storage
  const refreshRecent = useCallback(async () => {
    const list = getRecentFiles();
    setRecentFiles(list);

    if (list.length > 0) {
      try {
        const paths = list.map((item) => item.path);
        const inspected: FileEntry[] = await inspectPaths(paths);
        const validSet = new Set(inspected.map((e) => e.path));
        setAvailablePaths(validSet);
      } catch {
        setAvailablePaths(new Set(list.map((i) => i.path)));
      }
    }
  }, []);

  // Load workspace files for recently modified list
  const loadWorkspaceFiles = useCallback(async () => {
    try {
      const cached = await getCachedWorkspaceIndex();
      if (cached && cached.length > 0) {
        setWorkspaceFiles(cached);
      } else {
        const fresh = await listAllWorkspaceFiles();
        setWorkspaceFiles(fresh);
      }
    } catch {
      // Empty or error
    }
  }, []);

  useEffect(() => {
    refreshRecent();
    loadWorkspaceFiles();
    const handleUpdate = () => {
      refreshRecent();
      loadWorkspaceFiles();
    };
    window.addEventListener("composer:recent-files-updated", handleUpdate);
    return () => window.removeEventListener("composer:recent-files-updated", handleUpdate);
  }, [refreshRecent, loadWorkspaceFiles]);

  const recentlyModifiedFiles = useMemo(() => {
    return workspaceFiles
      .filter((f) => !f.is_dir && f.modified_ms)
      .sort((a, b) => (b.modified_ms || 0) - (a.modified_ms || 0))
      .slice(0, 30);
  }, [workspaceFiles]);

  const getFileIcon = (filename: string, isDir?: boolean) => {
    const iconProps = { size: 14, style: { color: "var(--text-muted)", flexShrink: 0 } };
    if (isDir) return <Folder {...iconProps} style={{ color: "var(--accent)" }} />;
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "svg") return <SvgFileIcon {...iconProps} />;
    if (ext === "md" || ext === "markdown")
      return <MarkdownFileIcon {...iconProps} style={{ color: "var(--accent)" }} />;
    if (ext === "txt") return <FileText {...iconProps} />;
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext || ""))
      return <ImageIcon {...iconProps} />;
    if (["csv", "json", "toml"].includes(ext || "")) return <TableIcon {...iconProps} />;
    if (["js", "ts", "jsx", "tsx", "html", "css", "rs", "py"].includes(ext || ""))
      return <FileCode {...iconProps} />;
    return <FileText {...iconProps} />;
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-app)] select-none">
      {/* Header */}
      <div className="p-6 pb-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="max-w-3xl mx-auto">
          <div className="mb-3">
            <h1 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
              Recent Activity
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              Quickly resume work across recently opened files, modified files, and workspaces
            </p>
          </div>

          {/* Subtabs */}
          <div className="flex items-center gap-1.5 pt-1 text-xs">
            <button
              onClick={() => setActiveTab("opened")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "opened"
                  ? "bg-[var(--accent)] text-[#0B0D0F] font-semibold"
                  : "bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]"
              }`}
            >
              Recently Opened ({recentFiles.length})
            </button>
            <button
              onClick={() => setActiveTab("modified")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "modified"
                  ? "bg-[var(--accent)] text-[#0B0D0F] font-semibold"
                  : "bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]"
              }`}
            >
              Recently Modified on Disk ({recentlyModifiedFiles.length})
            </button>
            <button
              onClick={() => setActiveTab("workspaces")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "workspaces"
                  ? "bg-[var(--accent)] text-[#0B0D0F] font-semibold"
                  : "bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]"
              }`}
            >
              Workspaces ({recentWorkspaces.length})
            </button>
          </div>
        </div>
      </div>

      {/* Content Viewport */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {/* Tab 1: Recently Opened */}
          {activeTab === "opened" && (
            recentFiles.length > 0 ? (
              <div className="space-y-1.5">
                {recentFiles.map((file) => {
                  const isAvailable = availablePaths.has(file.path);
                  return (
                    <div
                      key={file.path}
                      onClick={() => {
                        if (!isAvailable) {
                          if (
                            confirm(
                              `"${file.filename}" was not found at this path. Remove it from recent files?`
                            )
                          ) {
                            removeRecentFile(file.path);
                          }
                          return;
                        }
                        onOpenFile(file.path, file.filename);
                      }}
                      className={`group flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                        !isAvailable ? "opacity-60" : ""
                      } bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--sidebar-nav-hover-bg)]`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        {getFileIcon(file.filename)}
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-[var(--text-primary)] truncate block">
                            {file.filename}
                          </span>
                          <span
                            className="text-[10.5px] text-[var(--text-muted)] font-mono truncate block"
                            title={file.path}
                          >
                            {file.path}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {!isAvailable && (
                          <span className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                            Unavailable
                          </span>
                        )}
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {formatRelativeTime(file.lastOpened)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecentFile(file.path);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-all"
                          title="Remove from recents"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-12 text-center text-xs text-[var(--text-muted)]">
                <Clock size={32} className="mx-auto mb-3 text-[var(--border-strong)]" />
                <p className="font-semibold text-[var(--text-secondary)] mb-1">
                  No recently opened files
                </p>
                <p>Files you open in the editor will appear here automatically.</p>
              </div>
            )
          )}

          {/* Tab 2: Recently Modified */}
          {activeTab === "modified" && (
            recentlyModifiedFiles.length > 0 ? (
              <div className="space-y-1.5">
                {recentlyModifiedFiles.map((file) => {
                  const filename = file.name.split(/[\\\/]/).pop() || file.name;
                  return (
                    <div
                      key={file.path}
                      onClick={() => onOpenFile(file.path, filename)}
                      className="group flex items-center justify-between p-3 rounded-lg border bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--sidebar-nav-hover-bg)] cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        {getFileIcon(filename, file.is_dir)}
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-[var(--text-primary)] truncate block">
                            {file.name}
                          </span>
                          <span
                            className="text-[10.5px] text-[var(--text-muted)] font-mono truncate block"
                            title={file.path}
                          >
                            {file.path}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[11px] text-[var(--text-muted)] font-mono">
                          {formatFileSize(file.size)}
                        </span>
                        {file.modified_ms && (
                          <span className="text-[11px] text-[var(--text-muted)]">
                            {formatRelativeTime(file.modified_ms)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-12 text-center text-xs text-[var(--text-muted)]">
                <AlertCircle size={32} className="mx-auto mb-3 text-[var(--border-strong)]" />
                <p className="font-semibold text-[var(--text-secondary)] mb-1">
                  No modified files indexed
                </p>
                <p>Modified files in this workspace will appear in chronological order.</p>
              </div>
            )
          )}

          {/* Tab 3: Recent Workspaces */}
          {activeTab === "workspaces" && (
            recentWorkspaces.length > 0 ? (
              <div className="space-y-1.5">
                {recentWorkspaces.map((ws) => {
                  const isActive =
                    ws.path.toLowerCase() === currentWorkspace.toLowerCase();
                  return (
                    <div
                      key={ws.path}
                      onClick={() => onSelectWorkspace(ws.path)}
                      className={`group flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                        isActive
                          ? "bg-[var(--accent-soft)] border-[var(--accent)]/40"
                          : "bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--sidebar-nav-hover-bg)]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <FolderOpen
                          size={15}
                          className={
                            isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                          }
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                              {ws.name}
                            </span>
                            {isActive && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase bg-[var(--accent)] text-[#0B0D0F]">
                                Active
                              </span>
                            )}
                          </div>
                          <span
                            className="text-[10.5px] text-[var(--text-muted)] font-mono truncate block"
                            title={ws.path}
                          >
                            {ws.path}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {ws.last_opened > 0 && (
                          <span className="text-[11px] text-[var(--text-muted)]">
                            {formatRelativeTime(ws.last_opened)}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveRecentWorkspace(ws.path);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-all"
                          title="Remove from recent workspaces list"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-12 text-center text-xs text-[var(--text-muted)]">
                <HardDrive size={32} className="mx-auto mb-3 text-[var(--border-strong)]" />
                <p className="font-semibold text-[var(--text-secondary)] mb-1">
                  No recent workspaces
                </p>
                <p>Workspaces you open will be remembered here for fast switching.</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
