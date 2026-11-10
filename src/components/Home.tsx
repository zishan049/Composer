import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  FileText,
  FileCode,
  Folder,
  Image as ImageIcon,
  Table as TableIcon,
  Search,
  Plus,
  FolderPlus,
  Upload,
  FolderOpen,
  X,
  Clock,
  File as FileIcon,
  HardDrive,
  Files,
  Folders,
  Copy,
  Check,
  ExternalLink,
  PieChart,
  AlertTriangle,
} from "lucide-react";
import { FileEntry, RecentFile, RecentWorkspace, WorkspaceStats, SearchResult } from "../types";
import {
  getWorkspaceStats,
  getCachedWorkspaceIndex,
  listAllWorkspaceFiles,
  searchWorkspace,
  inspectPaths,
  openInFileManager,
} from "../lib/api";
import {
  getRecentFiles,
  removeRecentFile,
  formatRelativeTime,
} from "../utils/recentFiles";
import { SvgFileIcon } from "./SvgFileIcon";
import { MarkdownFileIcon } from "./MarkdownFileIcon";

interface HomeProps {
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

const HomeClock: React.FC = () => {
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
      hour12: true,
    });
  }, [currentDate]);

  return (
    <div className="home-datetime" aria-label="Current date and time">
      <span className="home-datetime-date">{formattedDate}</span>
      <span className="home-datetime-time">{formattedTime}</span>
    </div>
  );
};

const HomeComponent: React.FC<HomeProps> = ({
  onNavigate,
  onOpenRecentFile,
  onNewFile,
  onNewFolder,
  onImport,
  onOpenProject,
  recentWorkspaces = [],
  onSelectWorkspace,
  onRemoveRecentWorkspace,
}) => {
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<FileEntry[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState<boolean>(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<boolean>(false);

  // Tab selection: "recent" (opened files) vs "modified" (on disk) vs "workspaces"
  const [activeTab, setActiveTab] = useState<"recent" | "modified" | "workspaces">("recent");

  // Load real workspace stats and files
  const loadWorkspaceData = useCallback(async () => {
    setIsLoadingStats(true);
    setStatsError(null);
    try {
      const realStats = await getWorkspaceStats();
      setStats(realStats);

      try {
        const cached = await getCachedWorkspaceIndex();
        if (cached && cached.length > 0) {
          setWorkspaceFiles(cached);
        } else {
          const fresh = await listAllWorkspaceFiles();
          setWorkspaceFiles(fresh);
        }
      } catch {
        // Fallback for empty workspace
      }
    } catch (err: any) {
      console.warn("Failed to load workspace data:", err);
      setStatsError(err?.toString() || "Could not read workspace");
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaceData();
    const handleConfigUpdate = () => loadWorkspaceData();
    window.addEventListener("composer:recent-files-updated", handleConfigUpdate);
    return () => window.removeEventListener("composer:recent-files-updated", handleConfigUpdate);
  }, [loadWorkspaceData]);

  // Recent Files
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [availablePaths, setAvailablePaths] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  // Recently modified on disk
  const recentlyModifiedFiles = useMemo(() => {
    return workspaceFiles
      .filter((f) => !f.is_dir && f.modified_ms)
      .sort((a, b) => (b.modified_ms || 0) - (a.modified_ms || 0))
      .slice(0, 15);
  }, [workspaceFiles]);

  // Top file types breakdown from real stats
  const topFileTypes = useMemo(() => {
    if (!stats?.file_types) return [];
    return Object.entries(stats.file_types)
      .filter(([ext]) => ext && ext !== "other")
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4);
  }, [stats]);

  // Quick Search State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchWorkspace(q);
        if (!isCancelled) {
          setSearchResults(results);
          setSelectedIndex(-1);
        }
      } catch {
        if (!isCancelled) setSearchResults([]);
      } finally {
        if (!isCancelled) setIsSearching(false);
      }
    }, 70);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const handleSelectSearchResult = (entry: SearchResult) => {
    setSearchQuery("");
    setIsSearchFocused(false);
    const filename = entry.name.split(/[\\\/]/).pop() || entry.name;
    if (entry.is_dir) {
      onNavigate("Explorer");
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("composer:open-file", {
            detail: { path: entry.path, is_dir: true },
          })
        );
      }, 50);
    } else {
      onOpenRecentFile(entry.path, filename);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < searchResults.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
        handleSelectSearchResult(searchResults[selectedIndex]);
      } else if (searchResults.length > 0) {
        handleSelectSearchResult(searchResults[0]);
      }
    } else if (e.key === "Escape") {
      setIsSearchFocused(false);
      searchInputRef.current?.blur();
    }
  };

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
    const iconProps = { size: 14, style: { color: "var(--text-muted)", flexShrink: 0 } };
    if (isDir) return <Folder {...iconProps} style={{ color: "var(--accent)" }} />;
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "svg") return <SvgFileIcon {...iconProps} />;
    if (ext === "md" || ext === "markdown")
      return <MarkdownFileIcon {...iconProps} style={{ color: "var(--accent)" }} />;
    if (ext === "txt") return <FileText {...iconProps} />;
    if (["png", "jpg", "jpeg", "webp", "gif", "ico"].includes(ext || ""))
      return <ImageIcon {...iconProps} />;
    if (ext === "pdf") return <FileText {...iconProps} style={{ color: "#F87171" }} />;
    if (["csv", "json", "toml"].includes(ext || "")) return <TableIcon {...iconProps} />;
    if (["js", "ts", "jsx", "tsx", "html", "css", "rs", "py"].includes(ext || ""))
      return <FileCode {...iconProps} />;
    return <FileIcon {...iconProps} />;
  };

  const isWorkspaceEmpty = stats && stats.file_count === 0 && stats.folder_count === 0;

  return (
    <div className="home-root">
      <div className="home-container">
        {/* Real-time Date and Time */}
        <HomeClock />

        {/* ── Active Workspace Header ───────────────────────────── */}
        <div className="home-workspace-header">
          <div className="home-workspace-info min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="home-workspace-badge">Active Workspace</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] text-[var(--accent)]">
                Local-First
              </span>
            </div>
            <h1 className="home-workspace-name truncate">
              {stats?.workspace_name || "Active Project"}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="home-workspace-path font-mono text-[11px] truncate max-w-md" title={stats?.workspace_path || ""}>
                {stats?.workspace_path || "Loading workspace path..."}
              </span>
              <button
                onClick={copyPathToClipboard}
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-nav-hover-bg)] cursor-pointer transition-colors"
                title="Copy directory path"
              >
                {copiedPath ? <Check size={12} className="text-[var(--accent)]" /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleOpenFileManager}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-surface-elevated)] hover:bg-[var(--sidebar-nav-hover-bg)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              title="Open folder in File Explorer / Finder"
            >
              <ExternalLink size={13} />
              <span>Reveal in File Manager</span>
            </button>
            <button
              onClick={onOpenProject}
              className="home-workspace-change-btn cursor-pointer"
              title="Switch or manage project workspaces"
            >
              Switch Workspace
            </button>
          </div>
        </div>

        {/* Error notification if directory missing/moved */}
        {statsError && (
          <div className="flex items-center justify-between gap-3 p-3 mb-5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0" />
              <span>Workspace directory is unavailable or was moved: {statsError}</span>
            </div>
            <button
              onClick={onOpenProject}
              className="px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 font-medium cursor-pointer"
            >
              Locate Folder
            </button>
          </div>
        )}

        {/* ── Real Metric Summary Cards ─────────────────────────── */}
        <div className="home-stats-grid">
          {/* Card 1: Files */}
          <div className="home-stat-card">
            <div className="home-stat-top">
              <span className="home-stat-label">Files</span>
              <Files size={15} className="home-stat-icon" />
            </div>
            <span className="home-stat-value">
              {isLoadingStats ? "..." : stats?.file_count ?? 0}
            </span>
            <span className="home-stat-sub">Indexed files</span>
          </div>

          {/* Card 2: Folders */}
          <div className="home-stat-card">
            <div className="home-stat-top">
              <span className="home-stat-label">Folders</span>
              <Folders size={15} className="home-stat-icon" />
            </div>
            <span className="home-stat-value">
              {isLoadingStats ? "..." : stats?.folder_count ?? 0}
            </span>
            <span className="home-stat-sub">Directories</span>
          </div>

          {/* Card 3: Size */}
          <div className="home-stat-card">
            <div className="home-stat-top">
              <span className="home-stat-label">Workspace Volume</span>
              <HardDrive size={15} className="home-stat-icon" />
            </div>
            <span className="home-stat-value">
              {isLoadingStats ? "..." : formatFileSize(stats?.total_size_bytes)}
            </span>
            <span className="home-stat-sub">Total size on disk</span>
          </div>

          {/* Card 4: File Types Breakdown */}
          <div className="home-stat-card">
            <div className="home-stat-top">
              <span className="home-stat-label">Composition</span>
              <PieChart size={15} className="home-stat-icon" />
            </div>
            {topFileTypes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {topFileTypes.map(([ext, count]) => (
                  <span
                    key={ext}
                    className="text-[10.5px] px-2 py-0.5 rounded font-mono font-medium bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                  >
                    .{ext} <span className="text-[var(--accent)] font-bold">{count}</span>
                  </span>
                ))}
              </div>
            ) : (
              <span className="home-stat-value text-sm font-medium text-[var(--text-muted)]">
                {isLoadingStats ? "Analyzing..." : "No files indexed"}
              </span>
            )}
            <span className="home-stat-sub">Dominant extensions</span>
          </div>
        </div>

        {/* ── Global Search Bar ─────────────────────────────────── */}
        <div className="home-search-wrapper">
          <div
            className={`home-search-bar ${isSearchFocused ? "focused" : ""}`}
            onClick={() => searchInputRef.current?.focus()}
          >
            <Search size={16} className="home-search-icon" />
            <input
              id="home-search-input"
              ref={searchInputRef}
              type="text"
              placeholder="Search filename, relative path, or text content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => {
                setTimeout(() => setIsSearchFocused(false), 200);
              }}
              onKeyDown={handleSearchKeyDown}
              className="home-search-input"
              autoComplete="off"
              spellCheck={false}
            />
            {isSearching && (
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                Searching...
              </span>
            )}
            <kbd className="home-search-kbd">Ctrl K</kbd>
          </div>

          {/* Search Dropdown */}
          {isSearchFocused && searchQuery.trim().length > 0 && (
            <div ref={dropdownRef} className="home-search-dropdown">
              {searchResults.length > 0 ? (
                searchResults.map((item, idx) => (
                  <button
                    key={`${item.path}-${idx}`}
                    className={`home-search-item ${idx === selectedIndex ? "selected" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectSearchResult(item);
                    }}
                  >
                    {getFileIcon(item.name, item.is_dir)}
                    <div className="home-search-item-info">
                      <div className="flex items-center gap-2">
                        <span className="home-search-item-name">{item.name}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded font-medium bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--accent)]">
                          {item.match_type.replace("_", " ")}
                        </span>
                      </div>
                      {item.snippet ? (
                        <span className="home-search-item-path italic" style={{ color: "var(--text-secondary)" }}>
                          Line {item.line_number}: "{item.snippet}"
                        </span>
                      ) : (
                        <span className="home-search-item-path">{item.path}</span>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="home-search-empty">
                  {isSearching ? "Searching..." : `No files matching "${searchQuery}"`}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Quick Action Cards ────────────────────────────────── */}
        <div className="home-actions-grid">
          <button onClick={onNewFile} className="home-action-card" title="Create a new file">
            <div className="home-action-icon-box">
              <Plus size={16} />
            </div>
            <span className="home-action-title">New File</span>
            <span className="home-action-subtitle">Create Markdown, text, or code</span>
          </button>

          <button onClick={onNewFolder} className="home-action-card" title="Create a new folder">
            <div className="home-action-icon-box">
              <FolderPlus size={16} />
            </div>
            <span className="home-action-title">New Folder</span>
            <span className="home-action-subtitle">Organize project structure</span>
          </button>

          <button onClick={onImport} className="home-action-card" title="Import external files">
            <div className="home-action-icon-box">
              <Upload size={16} />
            </div>
            <span className="home-action-title">Import</span>
            <span className="home-action-subtitle">Add external documents or media</span>
          </button>

          <button onClick={() => onNavigate("Search")} className="home-action-card" title="Search workspace">
            <div className="home-action-icon-box">
              <Search size={16} />
            </div>
            <span className="home-action-title">Deep Search</span>
            <span className="home-action-subtitle">Find across paths and content</span>
          </button>
        </div>

        {/* ── Activity Sections (Recent Files / Modified / Recent Workspaces) ── */}
        <div className="home-recent-section">
          <div className="home-recent-header">
            <div className="home-section-tabs">
              <button
                className={`home-tab-pill ${activeTab === "recent" ? "active" : ""}`}
                onClick={() => setActiveTab("recent")}
              >
                Recently Opened {recentFiles.length > 0 && `(${recentFiles.length})`}
              </button>
              <button
                className={`home-tab-pill ${activeTab === "modified" ? "active" : ""}`}
                onClick={() => setActiveTab("modified")}
              >
                Recently Modified {recentlyModifiedFiles.length > 0 && `(${recentlyModifiedFiles.length})`}
              </button>
              {recentWorkspaces.length > 0 && (
                <button
                  className={`home-tab-pill ${activeTab === "workspaces" ? "active" : ""}`}
                  onClick={() => setActiveTab("workspaces")}
                >
                  Known Workspaces ({recentWorkspaces.length})
                </button>
              )}
            </div>
          </div>

          {/* Tab 1: Recently Opened Files */}
          {activeTab === "recent" && (
            recentFiles.length > 0 ? (
              <div className="home-recent-list">
                {recentFiles.map((file) => {
                  const isAvailable = availablePaths.has(file.path);
                  return (
                    <div
                      key={file.path}
                      className={`home-recent-row ${!isAvailable ? "unavailable" : ""}`}
                      onClick={() => {
                        if (!isAvailable) {
                          if (confirm(`"${file.filename}" is unavailable. Remove from recents?`)) {
                            removeRecentFile(file.path);
                          }
                          return;
                        }
                        onOpenRecentFile(file.path, file.filename);
                      }}
                      title={isAvailable ? file.path : "File not found on disk"}
                    >
                      <div className="home-recent-left">
                        <div className="home-recent-icon">{getFileIcon(file.filename)}</div>
                        <div className="home-recent-info">
                          <span className="home-recent-filename">{file.filename}</span>
                          <span className="home-recent-filepath font-mono">{file.path}</span>
                        </div>
                      </div>

                      <div className="home-recent-right">
                        {!isAvailable && (
                          <span className="home-recent-unavailable-badge">Unavailable</span>
                        )}
                        <span className="home-recent-time">
                          {formatRelativeTime(file.lastOpened)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecentFile(file.path);
                          }}
                          className="home-recent-remove-btn cursor-pointer"
                          title="Remove from recents"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="home-recent-empty">
                <Clock size={24} className="home-recent-empty-icon" />
                <span className="home-recent-empty-title">No recent files yet</span>
                <p className="home-recent-empty-desc">
                  Files you open and edit in Composer will appear here for fast one-click access.
                </p>
              </div>
            )
          )}

          {/* Tab 2: Recently Modified on Disk */}
          {activeTab === "modified" && (
            recentlyModifiedFiles.length > 0 ? (
              <div className="home-recent-list">
                {recentlyModifiedFiles.map((file) => {
                  const filename = file.name.split(/[\\\/]/).pop() || file.name;
                  return (
                    <div
                      key={file.path}
                      className="home-recent-row"
                      onClick={() => onOpenRecentFile(file.path, filename)}
                      title={file.path}
                    >
                      <div className="home-recent-left">
                        <div className="home-recent-icon">
                          {getFileIcon(filename, file.is_dir)}
                        </div>
                        <div className="home-recent-info">
                          <span className="home-recent-filename">{file.name}</span>
                          <span className="home-recent-filepath font-mono">{file.path}</span>
                        </div>
                      </div>

                      <div className="home-recent-right">
                        <span className="text-[11px] font-mono text-[var(--text-muted)]">
                          {formatFileSize(file.size)}
                        </span>
                        {file.modified_ms && (
                          <span className="home-recent-time">
                            {formatRelativeTime(file.modified_ms)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="home-recent-empty">
                <Clock size={24} className="home-recent-empty-icon" />
                <span className="home-recent-empty-title">No modified files indexed</span>
                <p className="home-recent-empty-desc">
                  Files in this workspace with timestamps will appear here in chronological order.
                </p>
              </div>
            )
          )}

          {/* Tab 3: Recent Workspaces */}
          {activeTab === "workspaces" && (
            <div className="home-recent-list">
              {recentWorkspaces.map((ws) => {
                const isActive =
                  ws.path.toLowerCase() === (stats?.workspace_path || "").toLowerCase();
                return (
                  <div
                    key={ws.path}
                    className={`home-recent-row ${isActive ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]" : ""}`}
                    onClick={() => onSelectWorkspace && onSelectWorkspace(ws.path)}
                    title={ws.path}
                  >
                    <div className="home-recent-left">
                      <div className="home-recent-icon">
                        <FolderOpen size={14} className={isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                      </div>
                      <div className="home-recent-info">
                        <div className="flex items-center gap-2">
                          <span className="home-recent-filename">{ws.name}</span>
                          {isActive && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase bg-[var(--accent)] text-[#0B0D0F]">
                              Active
                            </span>
                          )}
                        </div>
                        <span className="home-recent-filepath font-mono">{ws.path}</span>
                      </div>
                    </div>

                    <div className="home-recent-right">
                      {ws.last_opened > 0 && (
                        <span className="home-recent-time">
                          {formatRelativeTime(ws.last_opened)}
                        </span>
                      )}
                      {onRemoveRecentWorkspace && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveRecentWorkspace(ws.path);
                          }}
                          className="home-recent-remove-btn cursor-pointer"
                          title="Remove from recents (does not delete directory)"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty workspace state */}
          {isWorkspaceEmpty && (
            <div className="home-recent-empty mt-4 p-8 rounded-xl border border-dashed border-[var(--border-subtle)]">
              <FolderOpen size={32} style={{ color: "var(--accent)" }} />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                Workspace is empty
              </span>
              <p className="text-xs text-[var(--text-muted)] max-w-sm">
                Get started by creating a new document or folder, or import project files from your computer.
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={onNewFile}
                  className="px-3 py-1.5 rounded text-xs font-semibold bg-[var(--accent)] text-[#0B0D0F] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
                >
                  Create First File
                </button>
                <button
                  onClick={onImport}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-[var(--bg-surface-elevated)] text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--sidebar-nav-hover-bg)] transition-colors cursor-pointer"
                >
                  Import Files
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const Home = React.memo(HomeComponent);
