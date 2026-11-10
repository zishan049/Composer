import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  FileText, FileCode, Folder, Image as ImageIcon, Table as TableIcon,
  Search, Plus, FolderPlus, Upload, FolderOpen,
  X, Clock, File as FileIcon, HardDrive, Files, Folders,
  Sparkles, CheckCircle2, AlertCircle
} from "lucide-react";
import { FileEntry, RecentFile, WorkspaceStats, SearchResult } from "../types";
import {
  getWorkspaceStats,
  getCachedWorkspaceIndex,
  listAllWorkspaceFiles,
  searchWorkspace,
  inspectPaths
} from "../lib/api";
import {
  getRecentFiles,
  removeRecentFile,
  formatRelativeTime
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
}

// Format bytes into readable format
function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "0 B";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${val} ${sizes[i] || "B"}`;
}

// Isolated Clock leaf component
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
}) => {
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Good morning,";
    if (hour >= 12 && hour < 17) return "Good afternoon,";
    return "Good evening,";
  })();

  // ── Workspace stats and file index ─────────────────────────
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<FileEntry[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState<boolean>(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Tab selection: "recent" (opened files) vs "modified" (recently changed on disk)
  const [activeTab, setActiveTab] = useState<"recent" | "modified">("recent");

  // Load real workspace stats
  const loadWorkspaceData = useCallback(async () => {
    setIsLoadingStats(true);
    setStatsError(null);
    try {
      const realStats = await getWorkspaceStats();
      setStats(realStats);

      // Load files for modified list & quick searching
      try {
        const cached = await getCachedWorkspaceIndex();
        if (cached && cached.length > 0) {
          setWorkspaceFiles(cached);
        } else {
          const fresh = await listAllWorkspaceFiles();
          setWorkspaceFiles(fresh);
        }
      } catch {
        // Fallback or empty workspace
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

  // ── Recent Files (History) ─────────────────────────────────
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [availablePaths, setAvailablePaths] = useState<Set<string>>(new Set());

  const refreshRecent = useCallback(async () => {
    const list = getRecentFiles();
    setRecentFiles(list);

    if (list.length > 0) {
      try {
        const paths = list.map(item => item.path);
        const inspected: FileEntry[] = await inspectPaths(paths);
        const validSet = new Set(inspected.map(e => e.path));
        setAvailablePaths(validSet);
      } catch (err) {
        setAvailablePaths(new Set(list.map(i => i.path)));
      }
    }
  }, []);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  // Deterministic Recently Modified Files
  const recentlyModifiedFiles = useMemo(() => {
    return workspaceFiles
      .filter(f => !f.is_dir && f.modified_ms)
      .sort((a, b) => (b.modified_ms || 0) - (a.modified_ms || 0))
      .slice(0, 15);
  }, [workspaceFiles]);

  // ── Global Search State ─────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Unified Ranked Search with Rust backend
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
      } catch (err) {
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
        window.dispatchEvent(new CustomEvent("composer:open-file", { detail: { path: entry.path, is_dir: true } }));
      }, 50);
    } else {
      onOpenRecentFile(entry.path, filename);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1 < searchResults.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 >= 0 ? prev - 1 : searchResults.length - 1));
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

  // Icon helper
  const getFileIcon = (filename: string, isDir?: boolean) => {
    const iconProps = { size: 15, style: { color: "var(--text-muted)", flexShrink: 0 } };
    if (isDir) return <Folder {...iconProps} style={{ color: "var(--accent)", flexShrink: 0 }} />;
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "svg") return <SvgFileIcon {...iconProps} />;
    if (ext === "md" || ext === "markdown") return <MarkdownFileIcon {...iconProps} style={{ color: "var(--accent)" }} />;
    if (ext === "txt") return <FileText {...iconProps} />;
    if (["png", "jpg", "jpeg", "webp", "gif", "ico"].includes(ext || "")) return <ImageIcon {...iconProps} />;
    if (ext === "pdf") return <FileText {...iconProps} style={{ color: "#F87171", flexShrink: 0 }} />;
    if (["csv", "json", "toml"].includes(ext || "")) return <TableIcon {...iconProps} />;
    if (["js", "ts", "jsx", "tsx", "html", "css", "rs", "py"].includes(ext || "")) return <FileCode {...iconProps} />;
    return <FileIcon {...iconProps} />;
  };

  const isWorkspaceEmpty = stats && stats.file_count === 0 && stats.folder_count === 0;

  return (
    <div className="home-root">
      <div className="home-container">

        {/* ── Real-time Date and Time ───────────────────────────── */}
        <HomeClock />

        {/* ── Hero / Greeting ───────────────────────────────────── */}
        <div className="home-hero">
          <span className="home-greeting">
            <Sparkles size={14} />
            {greeting}
          </span>
          <h1 className="home-heading">Overview</h1>
          <p className="home-description">
            Your local workspace at a glance. Browse, search, and jump straight into work.
          </p>
        </div>

        {/* ── Active Workspace Identity Card ────────────────────── */}
        <div className="home-workspace-header">
          <div className="home-workspace-info">
            <span className="home-workspace-badge">Workspace</span>
            <span className="home-workspace-name">{stats?.workspace_name || "Active Project"}</span>
            <span className="home-workspace-path" title={stats?.workspace_path || ""}>
              {stats?.workspace_path || "Loading workspace..."}
            </span>
          </div>
          <button
            onClick={onOpenProject}
            className="home-workspace-change-btn"
            title="Choose a different workspace root"
          >
            Switch Workspace
          </button>
        </div>

        {/* Error notice if workspace failed to load */}
        {statsError && (
          <div
            className="flex items-center gap-2 px-3 py-2 mb-4 rounded text-xs"
            style={{ backgroundColor: "rgba(239, 68, 68, 0.12)", color: "#EF4444", border: "1px solid rgba(239, 68, 68, 0.25)" }}
          >
            <AlertCircle size={14} />
            <span>Workspace error: {statsError}</span>
          </div>
        )}

        {/* ── Summary Metrics (Nandi Style) ─────────────────────── */}
        <div className="home-stats-grid">
          {/* Card 1: Files */}
          <div className="home-stat-card">
            <div className="home-stat-top">
              <span className="home-stat-label">Files</span>
              <Files size={15} className="home-stat-icon" />
            </div>
            <span className="home-stat-value">
              {isLoadingStats ? "..." : (stats?.file_count ?? 0)}
            </span>
            <span className="home-stat-sub">Indexed in root</span>
          </div>

          {/* Card 2: Folders */}
          <div className="home-stat-card">
            <div className="home-stat-top">
              <span className="home-stat-label">Folders</span>
              <Folders size={15} className="home-stat-icon" />
            </div>
            <span className="home-stat-value">
              {isLoadingStats ? "..." : (stats?.folder_count ?? 0)}
            </span>
            <span className="home-stat-sub">Direct directories</span>
          </div>

          {/* Card 3: Size */}
          <div className="home-stat-card">
            <div className="home-stat-top">
              <span className="home-stat-label">Workspace Size</span>
              <HardDrive size={15} className="home-stat-icon" />
            </div>
            <span className="home-stat-value">
              {isLoadingStats ? "..." : formatFileSize(stats?.total_size_bytes)}
            </span>
            <span className="home-stat-sub">Shallow file volume</span>
          </div>

          {/* Card 4: Status */}
          <div className="home-stat-card">
            <div className="home-stat-top">
              <span className="home-stat-label">Local Isolation</span>
              <CheckCircle2 size={15} style={{ color: "var(--accent)" }} />
            </div>
            <span className="home-stat-value text-base font-semibold" style={{ color: "var(--accent)" }}>
              Active &amp; Sandboxed
            </span>
            <span className="home-stat-sub">Local-first filesystem</span>
          </div>
        </div>

        {/* ── Global Search / Action Field ──────────────────────── */}
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
              placeholder="Search filename, relative path, or file content..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
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
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Searching...</span>
            )}
            <kbd className="home-search-kbd">Ctrl K</kbd>
          </div>

          {/* Search Dropdown Results */}
          {isSearchFocused && searchQuery.trim().length > 0 && (
            <div ref={dropdownRef} className="home-search-dropdown">
              {searchResults.length > 0 ? (
                searchResults.map((item, idx) => (
                  <button
                    key={`${item.path}-${idx}`}
                    className={`home-search-item ${idx === selectedIndex ? "selected" : ""}`}
                    onMouseDown={e => {
                      e.preventDefault();
                      handleSelectSearchResult(item);
                    }}
                  >
                    {getFileIcon(item.name, item.is_dir)}
                    <div className="home-search-item-info">
                      <div className="flex items-center gap-2">
                        <span className="home-search-item-name">{item.name}</span>
                        <span
                          className="text-[9px] px-1.5 py-0.2 rounded font-medium"
                          style={{
                            backgroundColor: "var(--bg-surface)",
                            color: "var(--accent)",
                            border: "1px solid var(--border-subtle)",
                          }}
                        >
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
          {/* 1. New File */}
          <button onClick={onNewFile} className="home-action-card" title="Create a new file">
            <div className="home-action-icon-box">
              <Plus size={16} />
            </div>
            <span className="home-action-title">New File</span>
            <span className="home-action-subtitle">Create Markdown, text, or code</span>
          </button>

          {/* 2. New Folder */}
          <button onClick={onNewFolder} className="home-action-card" title="Create a new directory">
            <div className="home-action-icon-box">
              <FolderPlus size={16} />
            </div>
            <span className="home-action-title">New Folder</span>
            <span className="home-action-subtitle">Organize project structure</span>
          </button>

          {/* 3. Import */}
          <button onClick={onImport} className="home-action-card" title="Import external files">
            <div className="home-action-icon-box">
              <Upload size={16} />
            </div>
            <span className="home-action-title">Import</span>
            <span className="home-action-subtitle">Add external assets or notes</span>
          </button>

          {/* 4. Open Project */}
          <button onClick={onOpenProject} className="home-action-card" title="Select workspace directory">
            <div className="home-action-icon-box">
              <FolderOpen size={16} />
            </div>
            <span className="home-action-title">Open Project</span>
            <span className="home-action-subtitle">Switch workspace directory</span>
          </button>
        </div>

        {/* ── Worksurface List: Recent Files / Recently Modified ── */}
        <div className="home-recent-section">
          <div className="home-recent-header">
            <div className="home-section-tabs">
              <button
                className={`home-tab-pill ${activeTab === "recent" ? "active" : ""}`}
                onClick={() => setActiveTab("recent")}
              >
                Recent Files {recentFiles.length > 0 && `(${recentFiles.length})`}
              </button>
              <button
                className={`home-tab-pill ${activeTab === "modified" ? "active" : ""}`}
                onClick={() => setActiveTab("modified")}
              >
                Recently Modified {recentlyModifiedFiles.length > 0 && `(${recentlyModifiedFiles.length})`}
              </button>
            </div>
          </div>

          {/* Tab 1: Recent Files */}
          {activeTab === "recent" && (
            recentFiles.length > 0 ? (
              <div className="home-recent-list">
                {recentFiles.map(file => {
                  const isAvailable = availablePaths.has(file.path);
                  return (
                    <div
                      key={file.path}
                      className={`home-recent-row ${!isAvailable ? "unavailable" : ""}`}
                      onClick={() => {
                        if (!isAvailable) {
                          if (confirm(`"${file.filename}" is no longer available at this path. Remove it from recent files?`)) {
                            removeRecentFile(file.path);
                          }
                          return;
                        }
                        onOpenRecentFile(file.path, file.filename);
                      }}
                      title={isAvailable ? file.path : "File not found"}
                    >
                      <div className="home-recent-left">
                        <div className="home-recent-icon">
                          {getFileIcon(file.filename)}
                        </div>
                        <div className="home-recent-info">
                          <span className="home-recent-filename">{file.filename}</span>
                          <span className="home-recent-filepath">{file.path}</span>
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
                          onClick={e => {
                            e.stopPropagation();
                            removeRecentFile(file.path);
                          }}
                          className="home-recent-remove-btn"
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
                  Files you open and edit will appear here for fast one-click access.
                </p>
              </div>
            )
          )}

          {/* Tab 2: Recently Modified (Deterministic on-disk) */}
          {activeTab === "modified" && (
            recentlyModifiedFiles.length > 0 ? (
              <div className="home-recent-list">
                {recentlyModifiedFiles.map(file => {
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
                          <span className="home-recent-filepath">{file.path}</span>
                        </div>
                      </div>

                      <div className="home-recent-right">
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
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
                <AlertCircle size={24} className="home-recent-empty-icon" />
                <span className="home-recent-empty-title">No modified files indexed</span>
                <p className="home-recent-empty-desc">
                  Files in this workspace with timestamps will appear here in chronological order.
                </p>
              </div>
            )
          )}

          {/* Empty workspace state */}
          {isWorkspaceEmpty && (
            <div className="home-recent-empty mt-4 p-8 rounded-xl border border-dashed border-[var(--border-subtle)]">
              <FolderOpen size={32} style={{ color: "var(--accent)" }} />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Workspace is empty</span>
              <p className="text-xs text-[var(--text-muted)] max-w-sm">
                Get started by creating a new document or folder, or import files from your computer.
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={onNewFile}
                  className="px-3 py-1.5 rounded text-xs font-medium"
                  style={{ backgroundColor: "var(--accent)", color: "#0B0D0F" }}
                >
                  Create File
                </button>
                <button
                  onClick={onImport}
                  className="px-3 py-1.5 rounded text-xs font-medium"
                  style={{ backgroundColor: "var(--bg-surface-elevated)", color: "var(--text-primary)" }}
                >
                  Import
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
