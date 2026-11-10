import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search, File, Folder, Sun, Moon, Plus, FolderPlus,
  Upload, FolderOpen, RefreshCw, Settings, House
} from "lucide-react";
import { SearchResult } from "../types";
import { searchWorkspace } from "../lib/api";
import { SvgFileIcon } from "./SvgFileIcon";
import { MarkdownFileIcon } from "./MarkdownFileIcon";

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: string) => void;
  onOpenFile: (path: string, filename: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onImport: () => void;
  onOpenProject: () => void;
  onToggleTheme: () => void;
  onRefreshIndex: () => void;
  isDarkMode: boolean;
}

interface PaletteAction {
  id: string;
  category: "Navigation" | "Workspace" | "Appearance";
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  perform: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onOpenFile,
  onNewFile,
  onNewFolder,
  onImport,
  onOpenProject,
  onToggleTheme,
  onRefreshIndex,
  isDarkMode,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileResults, setFileResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setFileResults([]);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [isOpen]);

  // Static commands list
  const baseActions: PaletteAction[] = useMemo(() => [
    {
      id: "nav-overview",
      category: "Navigation",
      title: "Go to Overview",
      subtitle: "Workspace dashboard & activity",
      icon: <House size={14} />,
      perform: () => { onNavigate("Home"); onClose(); },
    },
    {
      id: "nav-explorer",
      category: "Navigation",
      title: "Go to Files (Explorer)",
      subtitle: "Browse project file tree",
      icon: <Folder size={14} />,
      perform: () => { onNavigate("Explorer"); onClose(); },
    },
    {
      id: "nav-search",
      category: "Navigation",
      title: "Go to Search",
      subtitle: "Deterministic workspace search",
      icon: <Search size={14} />,
      perform: () => { onNavigate("Search"); onClose(); },
    },
    {
      id: "nav-recent",
      category: "Navigation",
      title: "Go to Recent Activity",
      subtitle: "Recent files and workspaces",
      icon: <House size={14} />,
      perform: () => { onNavigate("Recent"); onClose(); },
    },
    {
      id: "nav-settings",
      category: "Navigation",
      title: "Go to Settings",
      subtitle: "Preferences, typography, and storage",
      icon: <Settings size={14} />,
      perform: () => { onNavigate("Settings"); onClose(); },
    },
    {
      id: "action-new-file",
      category: "Workspace",
      title: "New File",
      subtitle: "Create a new text or markdown file",
      icon: <Plus size={14} />,
      perform: () => { onNewFile(); onClose(); },
    },
    {
      id: "action-new-folder",
      category: "Workspace",
      title: "New Folder",
      subtitle: "Create a directory in the workspace",
      icon: <FolderPlus size={14} />,
      perform: () => { onNewFolder(); onClose(); },
    },
    {
      id: "action-import",
      category: "Workspace",
      title: "Import Files",
      subtitle: "Copy external files into current directory",
      icon: <Upload size={14} />,
      perform: () => { onImport(); onClose(); },
    },
    {
      id: "action-open-project",
      category: "Workspace",
      title: "Open Workspace Root",
      subtitle: "Select a different directory on disk",
      icon: <FolderOpen size={14} />,
      perform: () => { onOpenProject(); onClose(); },
    },
    {
      id: "action-refresh-index",
      category: "Workspace",
      title: "Refresh Workspace Index",
      subtitle: "Force a fresh scan of project files",
      icon: <RefreshCw size={14} />,
      perform: () => { onRefreshIndex(); onClose(); },
    },
    {
      id: "action-theme",
      category: "Appearance",
      title: isDarkMode ? "Switch to Light Theme" : "Switch to Dark Theme",
      subtitle: "Toggle application appearance",
      icon: isDarkMode ? <Sun size={14} /> : <Moon size={14} />,
      perform: () => { onToggleTheme(); onClose(); },
    },
  ], [onNavigate, onClose, onNewFile, onNewFolder, onImport, onOpenProject, onRefreshIndex, onToggleTheme, isDarkMode]);

  // Search files dynamically when query changes
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setFileResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchWorkspace(trimmed);
        if (!cancelled) {
          setFileResults(results);
          setSelectedIndex(0);
        }
      } catch (err) {
        if (!cancelled) setFileResults([]);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Filtered actions based on query
  const matchedActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return baseActions;
    return baseActions.filter(a =>
      a.title.toLowerCase().includes(q) || (a.subtitle && a.subtitle.toLowerCase().includes(q))
    );
  }, [baseActions, query]);

  // Combined item list for keyboard navigation
  type CombinedItem =
    | { kind: "action"; action: PaletteAction }
    | { kind: "file"; result: SearchResult };

  const combinedItems: CombinedItem[] = useMemo(() => {
    const items: CombinedItem[] = [];
    matchedActions.forEach(a => items.push({ kind: "action", action: a }));
    fileResults.forEach(r => items.push({ kind: "file", result: r }));
    return items;
  }, [matchedActions, fileResults]);

  // Clamp selectedIndex
  useEffect(() => {
    if (selectedIndex >= combinedItems.length) {
      setSelectedIndex(Math.max(0, combinedItems.length - 1));
    }
  }, [combinedItems.length, selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1 < combinedItems.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 >= 0 ? prev - 1 : combinedItems.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = combinedItems[selectedIndex];
      if (!current) return;
      if (current.kind === "action") {
        current.action.perform();
      } else {
        const filename = current.result.name.split(/[\\\/]/).pop() || current.result.name;
        onOpenFile(current.result.path, filename);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const getFileIcon = (filename: string, isDir: boolean) => {
    if (isDir) return <Folder size={14} style={{ color: "var(--accent)" }} />;
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "md" || ext === "markdown") return <MarkdownFileIcon size={14} style={{ color: "var(--accent)" }} />;
    if (ext === "svg") return <SvgFileIcon size={14} style={{ color: "var(--text-muted)" }} />;
    return <File size={14} style={{ color: "var(--text-muted)" }} />;
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      style={{ backgroundColor: "var(--surface-overlay)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl flex flex-col rounded-xl overflow-hidden shadow-2xl"
        style={{
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-dialog)",
        }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
      >
        {/* Search Input Bar */}
        <div
          className="flex items-center px-4 py-3 gap-3"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <Search size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--text-primary)", fontFamily: "var(--font-ui)" }}
            placeholder="Type a command or search files..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {isSearching && (
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Searching...</span>
          )}
          <kbd
            className="text-xs px-1.5 py-0.5 rounded border"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
              backgroundColor: "var(--bg-surface-elevated)",
            }}
          >
            Esc
          </kbd>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-80 overflow-y-auto p-2 flex flex-col gap-1"
          style={{ fontFamily: "var(--font-ui)" }}
        >
          {combinedItems.length === 0 ? (
            <div
              className="py-8 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              No matching commands or files found
            </div>
          ) : (
            combinedItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              if (item.kind === "action") {
                return (
                  <button
                    key={item.action.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors text-xs"
                    style={{
                      backgroundColor: isSelected ? "var(--sidebar-nav-active-bg)" : "transparent",
                      color: isSelected ? "var(--accent)" : "var(--text-primary)",
                      border: isSelected ? "1px solid var(--border-subtle)" : "1px solid transparent",
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => item.action.perform()}
                  >
                    <div
                      className="p-1 rounded flex items-center justify-center"
                      style={{
                        backgroundColor: isSelected ? "var(--accent-soft)" : "var(--bg-surface-elevated)",
                        color: isSelected ? "var(--accent)" : "var(--text-secondary)",
                      }}
                    >
                      {item.action.icon}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="font-medium truncate">{item.action.title}</span>
                      {item.action.subtitle && (
                        <span className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                          {item.action.subtitle}
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold tracking-wider"
                      style={{
                        backgroundColor: "var(--bg-surface-elevated)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {item.action.category}
                    </span>
                  </button>
                );
              }

              // File Result
              const isDir = item.result.is_dir;
              const matchType = item.result.match_type;
              return (
                <button
                  key={`${item.result.path}-${idx}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors text-xs"
                  style={{
                    backgroundColor: isSelected ? "var(--sidebar-nav-active-bg)" : "transparent",
                    color: isSelected ? "var(--accent)" : "var(--text-primary)",
                    border: isSelected ? "1px solid var(--border-subtle)" : "1px solid transparent",
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    const filename = item.result.name.split(/[\\\/]/).pop() || item.result.name;
                    onOpenFile(item.result.path, filename);
                    onClose();
                  }}
                >
                  <div
                    className="p-1 rounded flex items-center justify-center"
                    style={{
                      backgroundColor: isSelected ? "var(--accent-soft)" : "var(--bg-surface-elevated)",
                    }}
                  >
                    {getFileIcon(item.result.name, isDir)}
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{item.result.name}</span>
                      <span
                        className="text-[9px] px-1 py-0.2 rounded"
                        style={{
                          backgroundColor: "var(--bg-surface-elevated)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {matchType.replace("_", " ")}
                      </span>
                    </div>
                    {item.result.snippet ? (
                      <span className="text-[11px] truncate italic" style={{ color: "var(--text-muted)" }}>
                        Line {item.result.line_number}: "{item.result.snippet}"
                      </span>
                    ) : (
                      <span className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                        {item.result.path}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts helper */}
        <div
          className="flex items-center justify-between px-3 py-2 text-[11px]"
          style={{
            borderTop: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface-elevated)",
            color: "var(--text-muted)",
          }}
        >
          <div className="flex items-center gap-3">
            <span><kbd className="font-semibold">↑↓</kbd> Navigate</span>
            <span><kbd className="font-semibold">↵</kbd> Select</span>
            <span><kbd className="font-semibold">esc</kbd> Dismiss</span>
          </div>
          <span>Composer v0.2</span>
        </div>
      </div>
    </div>
  );
};
