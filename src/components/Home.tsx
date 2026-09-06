import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  FileText, FileCode, Folder, Image as ImageIcon, Table as TableIcon,
  Search, Plus, FolderPlus, Upload, FolderOpen,
  X, Clock, File as FileIcon
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { FileEntry, RecentFile } from "../types";
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

export const Home: React.FC<HomeProps> = ({
  onNavigate,
  onOpenRecentFile,
  onNewFile,
  onNewFolder,
  onImport,
  onOpenProject,
}) => {
  // ── Date and Time ──────────────────────────────────────────
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

  // Dynamic greeting based on user's system time
  const greeting = useMemo(() => {
    const hour = currentDate.getHours();
    if (hour >= 5 && hour < 12) return "Good Morning,";
    if (hour >= 12 && hour < 17) return "Good Afternoon,";
    return "Good Evening,";
  }, [currentDate]);

  // ── Recent Files ───────────────────────────────────────────
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [availablePaths, setAvailablePaths] = useState<Set<string>>(new Set());

  const refreshRecent = React.useCallback(async () => {
    const list = getRecentFiles();
    setRecentFiles(list);

    if (list.length > 0) {
      try {
        const paths = list.map(item => item.path);
        const inspected: FileEntry[] = await invoke("inspect_paths", { paths });
        const validSet = new Set(inspected.map(e => e.path));
        setAvailablePaths(validSet);
      } catch (err) {
        console.warn("inspect_paths check failed:", err);
        // Fallback: assume available to not block user
        setAvailablePaths(new Set(list.map(i => i.path)));
      }
    }
  }, []);

  useEffect(() => {
    refreshRecent();
    const handleUpdate = () => refreshRecent();
    window.addEventListener("composer:recent-files-updated", handleUpdate);
    return () => window.removeEventListener("composer:recent-files-updated", handleUpdate);
  }, [refreshRecent]);

  // ── Global Search State ─────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load workspace files for fast instant searching
  useEffect(() => {
    let isCancelled = false;
    const loadFiles = async () => {
      try {
        const all: FileEntry[] = await invoke("list_all_workspace_files");
        if (!isCancelled) setWorkspaceFiles(all);
      } catch {
        try {
          const root: FileEntry[] = await invoke("list_directory_contents", { dirPath: "" });
          if (!isCancelled) setWorkspaceFiles(root);
        } catch {
          // Ignore if empty
        }
      }
    };
    loadFiles();
    return () => { isCancelled = true; };
  }, []);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return workspaceFiles
      .filter(item => item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q))
      .slice(0, 10);
  }, [searchQuery, workspaceFiles]);

  const handleSelectSearchResult = (entry: FileEntry) => {
    setSearchQuery("");
    setIsSearchFocused(false);
    if (entry.is_dir) {
      onNavigate("Explorer");
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("composer:open-file", { detail: { path: entry.path, is_dir: true } }));
      }, 50);
    } else {
      onOpenRecentFile(entry.path, entry.name.split(/[\\\/]/).pop() || entry.name);
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
    if (ext === "md" || ext === "markdown") return <MarkdownFileIcon {...iconProps} />;
    if (ext === "txt") return <FileText {...iconProps} />;
    if (["png", "jpg", "jpeg", "webp", "gif", "ico"].includes(ext || "")) return <ImageIcon {...iconProps} />;
    if (ext === "pdf") return <FileText {...iconProps} style={{ color: "#F87171", flexShrink: 0 }} />;
    if (["csv", "json", "toml"].includes(ext || "")) return <TableIcon {...iconProps} />;
    if (["js", "ts", "jsx", "tsx", "html", "css", "rs", "py"].includes(ext || "")) return <FileCode {...iconProps} />;
    return <FileIcon {...iconProps} />;
  };

  return (
    <div className="home-root">
      <div className="home-container">

        {/* ── Date and Time in Upper-Right ──────────────────────── */}
        <div className="home-datetime" aria-label="Current date and time">
          <span className="home-datetime-date">{formattedDate}</span>
          <span className="home-datetime-time">{formattedTime}</span>
        </div>

        {/* ── Hero / Greeting ───────────────────────────────────── */}
        <div className="home-hero">
          <span className="home-greeting">{greeting}</span>
          <h1 className="home-heading">Let's create something.</h1>
          <p className="home-description">
            Manage your files and workspace — all in one place.
          </p>
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
              placeholder="Search files, folders or type a command..."
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setSelectedIndex(-1);
              }}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => {
                // Short delay to permit clicking dropdown items
                setTimeout(() => setIsSearchFocused(false), 200);
              }}
              onKeyDown={handleSearchKeyDown}
              className="home-search-input"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="home-search-kbd">Ctrl K</kbd>
          </div>

          {/* Search Dropdown Results */}
          {isSearchFocused && searchQuery.trim().length > 0 && (
            <div ref={dropdownRef} className="home-search-dropdown">
              {searchResults.length > 0 ? (
                searchResults.map((item, idx) => (
                  <button
                    key={item.path}
                    className={`home-search-item ${idx === selectedIndex ? "selected" : ""}`}
                    onMouseDown={e => {
                      e.preventDefault();
                      handleSelectSearchResult(item);
                    }}
                  >
                    {getFileIcon(item.name, item.is_dir)}
                    <div className="home-search-item-info">
                      <span className="home-search-item-name">{item.name}</span>
                      <span className="home-search-item-path">{item.path}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="home-search-empty">
                  No files or folders matching "{searchQuery}"
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Quick Action Cards ────────────────────────────────── */}
        <div className="home-actions-grid">
          {/* 1. New File */}
          <button
            onClick={onNewFile}
            className="home-action-card"
            title="Create a new file"
          >
            <div className="home-action-icon-box">
              <Plus size={16} />
            </div>
            <span className="home-action-title">New File</span>
            <span className="home-action-subtitle">Create text or markdown</span>
          </button>

          {/* 2. New Folder */}
          <button
            onClick={onNewFolder}
            className="home-action-card"
            title="Create a new folder"
          >
            <div className="home-action-icon-box">
              <FolderPlus size={16} />
            </div>
            <span className="home-action-title">New Folder</span>
            <span className="home-action-subtitle">Organize your directory</span>
          </button>

          {/* 3. Import */}
          <button
            onClick={onImport}
            className="home-action-card"
            title="Import files or folders"
          >
            <div className="home-action-icon-box">
              <Upload size={16} />
            </div>
            <span className="home-action-title">Import</span>
            <span className="home-action-subtitle">Add external assets</span>
          </button>

          {/* 4. Open Project */}
          <button
            onClick={onOpenProject}
            className="home-action-card"
            title="Choose a new workspace root"
          >
            <div className="home-action-icon-box">
              <FolderOpen size={16} />
            </div>
            <span className="home-action-title">Open Project</span>
            <span className="home-action-subtitle">Select workspace root</span>
          </button>
        </div>

        {/* ── Recent Files Section ──────────────────────────────── */}
        <div className="home-recent-section">
          <div className="home-recent-header">
            <span className="home-recent-title">Recent Files</span>
            {recentFiles.length > 0 && (
              <span className="home-recent-count">
                {recentFiles.length} {recentFiles.length === 1 ? "file" : "files"}
              </span>
            )}
          </div>

          {recentFiles.length > 0 ? (
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
                Files you open and edit in Explorer will appear here for quick access.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
