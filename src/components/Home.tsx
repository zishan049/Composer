import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  FileText,
  FileCode,
  Folder,
  Image as ImageIcon,
  Table as TableIcon,
  HardDrive,
  Clock,
  ExternalLink,
  Plus,
  FolderPlus,
  Files,
  Folders,
  PieChart,
  Copy,
  Check,
  AlertTriangle,
  GitBranch,
  File,
  ArrowRight,
} from "lucide-react";
import { RecentWorkspace, FileEntry, WorkspaceStats } from "../types";
import {
  getWorkspaceStats,
  inspectPaths,
  openInFileManager,
} from "../lib/api";
import {
  getRecentFiles,
  formatRelativeTime,
} from "../utils/recentFiles";
import { SvgFileIcon } from "./SvgFileIcon";
import { MarkdownFileIcon } from "./MarkdownFileIcon";
import GlideSelect from "./GlideSelect";
import { listen } from "@tauri-apps/api/event";

interface HomeProps {
  workspacePath?: string;
  onNavigate: (page: string) => void;
  onOpenRecentFile: (path: string, filename: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onImport: () => void;
  onOpenProject: () => void;
  recentWorkspaces?: RecentWorkspace[];
  onSelectWorkspace?: (path: string) => void;
  onRemoveRecentWorkspace?: (path: string) => void;
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

function getFileCategoryGroup(filename: string): "images" | "docs" | "code" {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp", "gif", "ico", "svg", "bmp"].includes(ext)) return "images";
  if (["md", "markdown", "txt", "pdf", "doc", "docx", "rtf"].includes(ext)) return "docs";
  return "code";
}

function getShortParentLabel(filePath: string, workspacePath?: string): string {
  const normalizedFile = filePath.replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
  const normalizedWs = (workspacePath || "").replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalizedWs && normalizedFile.toLowerCase().startsWith(normalizedWs.toLowerCase() + "/")) {
    const rel = normalizedFile.slice(normalizedWs.length + 1);
    const idx = rel.lastIndexOf("/");
    return idx > 0 ? rel.slice(0, idx) : "Workspace Root";
  }
  const parts = normalizedFile.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "Local";
}

export const Home: React.FC<HomeProps> = ({
  workspacePath,
  onNavigate,
  onOpenRecentFile,
  onNewFile,
  onNewFolder,
  onOpenProject,
}) => {
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [recentFiles, setRecentFiles] = useState<Array<{ path: string; filename: string; lastOpened: number }>>([]);
  const [availablePaths, setAvailablePaths] = useState<Set<string>>(new Set());
  const [recentFilter, setRecentFilter] = useState<string>("all");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedDate = useMemo(() => {
    return currentDate.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }, [currentDate]);

  const formattedTime = useMemo(() => {
    return currentDate.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [currentDate]);

  // Load workspace statistics
  const fetchStats = useCallback(async () => {
    setIsLoadingStats(true);
    setStatsError(null);
    try {
      const s = await getWorkspaceStats();
      setStats(s);
    } catch (err: unknown) {
      setStatsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  // Load recent files
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

  // Refresh on mount and whenever workspacePath changes
  useEffect(() => {
    fetchStats();
    refreshRecent();
  }, [workspacePath, fetchStats, refreshRecent]);

  // Listen for config_updated events
  useEffect(() => {
    const unlisten = listen("config_updated", () => {
      fetchStats();
      refreshRecent();
    });
    return () => {
      unlisten.then(fn => fn());
    };
  }, [fetchStats, refreshRecent]);

  const copyPathToClipboard = () => {
    if (stats?.workspace_path) {
      navigator.clipboard.writeText(stats.workspace_path);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 1500);
    }
  };

  const handleOpenFileManager = async () => {
    try {
      await openInFileManager(stats?.workspace_path);
    } catch (e) {
      console.error("Open in file manager error:", e);
    }
  };

  const getFileIcon = (filename: string, isDir?: boolean) => {
    const iconProps = { size: 15, className: "shrink-0 text-[var(--text-muted)]" };
    if (isDir) return <Folder {...iconProps} className="text-[var(--accent)] shrink-0" />;
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "svg") return <SvgFileIcon size={15} />;
    if (ext === "md" || ext === "markdown")
      return <MarkdownFileIcon size={15} style={{ color: "var(--accent)" }} />;
    if (ext === "txt") return <FileText {...iconProps} />;
    if (["png", "jpg", "jpeg", "webp", "gif", "ico"].includes(ext || ""))
      return <ImageIcon {...iconProps} style={{ color: "var(--accent-text, var(--accent))" }} />;
    if (ext === "pdf") return <FileText {...iconProps} style={{ color: "#F87171" }} />;
    if (["csv", "json", "toml"].includes(ext || "")) return <TableIcon {...iconProps} />;
    if (["js", "ts", "jsx", "tsx", "html", "css", "rs", "py"].includes(ext || ""))
      return <FileCode {...iconProps} style={{ color: "var(--accent-rose, #00D4FF)" }} />;
    return <File {...iconProps} />;
  };

  const topFileTypes = useMemo(() => {
    if (!stats || !stats.file_types) return [];
    return Object.entries(stats.file_types)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [stats]);

  const filteredRecentFiles = useMemo(() => {
    if (recentFilter === "all") return recentFiles;
    return recentFiles.filter(f => getFileCategoryGroup(f.filename) === recentFilter);
  }, [recentFiles, recentFilter]);

  return (
    <div className="c2-home">
      <div className="c2-home-inner">

        {/* ── Minimal Header ────────────────────────────────────── */}
        <div className="c2-home-header">
          <div>
            <h1 className="c2-home-title">Overview</h1>
            <p className="c2-home-subtitle">
              Workspace summary and recent files for{" "}
              <span className="font-medium text-[var(--text-secondary)]">
                {stats?.workspace_name || "Composer"}
              </span>
            </p>
          </div>
          <div className="c2-home-clock-pill">
            <span className="font-medium">{formattedDate}</span>
            <span className="opacity-35">•</span>
            <span className="font-mono text-[var(--text-muted)]">{formattedTime}</span>
          </div>
        </div>

        {/* Missing Folder Warning */}
        {statsError && (
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" />
              <span>Workspace directory is unavailable or was moved: {statsError}</span>
            </div>
            <button
              onClick={onOpenProject}
              className="px-2.5 py-1 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-300 font-medium cursor-pointer"
            >
              Locate Folder
            </button>
          </div>
        )}

        {/* ── Unified Big Overview Bento Card ───────────────────── */}
        <div className="c2-bento-card c2-bento-hero p-5 sm:p-6 flex flex-col gap-5">
          {/* Top: Workspace Identity & Actions */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: "var(--accent-soft)",
                  color: "var(--accent-text, var(--accent))",
                  border: "1px solid var(--border-strong)",
                }}
              >
                <Folder size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)] truncate">
                    {stats?.workspace_name || "Active Workspace"}
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                    style={{
                      backgroundColor: "var(--accent-soft)",
                      color: "var(--accent-text, var(--accent))",
                    }}
                  >
                    Local-First
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className="text-[11px] text-[var(--text-muted)] font-mono truncate max-w-lg"
                    title={stats?.workspace_path || ""}
                  >
                    {stats?.workspace_path || "No folder selected"}
                  </span>
                  {stats?.workspace_path && (
                    <button
                      onClick={copyPathToClipboard}
                      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5 rounded cursor-pointer transition-colors shrink-0"
                      title="Copy path"
                    >
                      {copiedPath ? <Check size={11} className="text-[var(--accent-text,var(--accent))]" /> : <Copy size={11} />}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleOpenFileManager}
                className="c2-bento-action"
                title="Reveal in File Explorer"
              >
                <ExternalLink size={12} className="opacity-75" />
                <span>Reveal</span>
              </button>
              <button
                onClick={onOpenProject}
                className="px-3.5 py-1.5 rounded-[10px] text-xs font-semibold transition-all cursor-pointer shadow-sm hover:brightness-110"
                style={{
                  backgroundColor: "var(--accent)",
                  color: "#FFFFFF",
                }}
                title="Switch to another directory"
              >
                Switch
              </button>
            </div>
          </div>

          {/* Middle: Integrated 4-Column Workspace Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="c2-hero-stat">
              <div className="flex items-center justify-between text-[var(--text-muted)]">
                <span className="text-[11px] font-medium">Indexed Files</span>
                <Files size={14} style={{ color: "var(--accent-text, var(--accent))" }} />
              </div>
              <div className="mt-2.5">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">
                  {isLoadingStats ? "—" : stats?.file_count ?? 0}
                </span>
                <span className="block text-[10.5px] text-[var(--text-muted)] mt-0.5">
                  Tracked in project
                </span>
              </div>
            </div>

            <div className="c2-hero-stat">
              <div className="flex items-center justify-between text-[var(--text-muted)]">
                <span className="text-[11px] font-medium">Directories</span>
                <Folders size={14} style={{ color: "var(--accent-text, var(--accent))" }} />
              </div>
              <div className="mt-2.5">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">
                  {isLoadingStats ? "—" : stats?.folder_count ?? 0}
                </span>
                <span className="block text-[10.5px] text-[var(--text-muted)] mt-0.5">
                  Subdirectories
                </span>
              </div>
            </div>

            <div className="c2-hero-stat">
              <div className="flex items-center justify-between text-[var(--text-muted)]">
                <span className="text-[11px] font-medium">Storage Volume</span>
                <HardDrive size={14} style={{ color: "var(--accent-text, var(--accent))" }} />
              </div>
              <div className="mt-2.5">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">
                  {isLoadingStats ? "—" : formatFileSize(stats?.total_size_bytes)}
                </span>
                <span className="block text-[10.5px] text-[var(--text-muted)] mt-0.5">
                  Total size on disk
                </span>
              </div>
            </div>

            <div className="c2-hero-stat">
              <div className="flex items-center justify-between text-[var(--text-muted)]">
                <span className="text-[11px] font-medium">Composition</span>
                <PieChart size={14} style={{ color: "var(--accent-text, var(--accent))" }} />
              </div>
              <div className="mt-2.5">
                {topFileTypes.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {topFileTypes.map(([ext, count]) => (
                      <span key={ext} className="c2-format-chip">
                        .{ext}{" "}
                        <span
                          className="font-semibold"
                          style={{ color: "var(--accent-text, var(--accent))" }}
                        >
                          {count}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">No files indexed</span>
                )}
              </div>
            </div>
          </div>

          {/* Bottom: Integrated Lightweight Quick Actions Strip */}
          <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between flex-wrap gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={onNewFile} className="c2-bento-action">
                <span className="c2-bento-action-icon"><Plus size={13} /></span>
                <span>New File</span>
              </button>
              <button onClick={onNewFolder} className="c2-bento-action">
                <span className="c2-bento-action-icon"><FolderPlus size={13} /></span>
                <span>New Folder</span>
              </button>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("composer:create-worktree"))}
                className="c2-bento-action"
              >
                <span className="c2-bento-action-icon"><GitBranch size={13} /></span>
                <span>New Worktree</span>
              </button>
            </div>

            <button
              onClick={() => onNavigate("Explorer")}
              className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline cursor-pointer"
              style={{ color: "var(--accent-text, var(--accent))" }}
            >
              <span>Open Files</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </div>

        {/* ── Clean Single-Surface Recent Files Grid ────────────── */}
        <div className="flex flex-col gap-3.5 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Clock size={14} style={{ color: "var(--accent-text, var(--accent))" }} />
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)] tracking-tight">
                Recent Files
              </h2>
              <span className="text-[10.5px] px-2 py-0.5 rounded-full font-mono text-[var(--text-muted)] bg-[rgba(255,255,255,0.04)] border border-[var(--border-subtle)]">
                {filteredRecentFiles.length}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <GlideSelect
                size="sm"
                menuWidth={160}
                align="right"
                ariaLabel="Filter recent files"
                value={recentFilter}
                onChange={val => setRecentFilter(val)}
                options={[
                  { value: "all",    label: "All Files",    tag: String(recentFiles.length) },
                  { value: "images", label: "Images & SVG" },
                  { value: "docs",   label: "Docs & PDF" },
                  { value: "code",   label: "Code & Data" },
                ]}
              />

              <button
                onClick={() => onNavigate("Explorer")}
                className="text-xs font-medium hover:underline cursor-pointer"
                style={{ color: "var(--accent-text, var(--accent))" }}
              >
                View Files &rarr;
              </button>
            </div>
          </div>

          {filteredRecentFiles.length === 0 ? (
            <div className="c2-bento-card p-8 text-center text-xs text-[var(--text-muted)]">
              {recentFiles.length === 0
                ? "No recently opened files in this workspace yet."
                : "No recent files match this filter."}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {filteredRecentFiles.slice(0, 8).map((file) => {
                const isAvailable = availablePaths.has(file.path);
                const parentLabel = getShortParentLabel(file.path, workspacePath || stats?.workspace_path);
                return (
                  <div
                    key={file.path}
                    onClick={() => onOpenRecentFile(file.path, file.filename)}
                    className="c2-bento-card c2-bento-file group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: "var(--accent-soft)",
                          color: "var(--accent-text, var(--accent))",
                        }}
                      >
                        {getFileIcon(file.filename)}
                      </div>
                      {!isAvailable ? (
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-medium shrink-0">
                          Unavailable
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">
                          {formatRelativeTime(file.lastOpened)}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <span
                        className="text-[12.5px] font-semibold text-[var(--text-primary)] block truncate group-hover:text-[var(--accent-text,var(--accent))] transition-colors"
                        title={file.filename}
                      >
                        {file.filename}
                      </span>
                      <span
                        className="text-[10.5px] text-[var(--text-muted)] block truncate mt-0.5"
                        title={file.path}
                      >
                        {parentLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
