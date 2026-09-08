// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from "react";
import {
  Folder, File, FileText, Image as ImageIcon, Table as TableIcon, 
  Search, Plus, Save, BookOpen,
  RotateCw, Columns, Code, FileCode, History, X, ChevronRight, ChevronDown,
  Grid3x3, List, Upload, FolderPlus
} from "lucide-react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileEntry, AppConfig } from "../types";
import { useCustomContextMenu } from "./ContextMenu";
import { trackRecentFile } from "../utils/recentFiles";
import { SvgFileIcon } from "./SvgFileIcon";
import { MarkdownFileIcon } from "./MarkdownFileIcon";

// Lazy-loaded heavy media & preview engines
const PdfEditor    = React.lazy(() => import("./PdfEditor"));
const SvgPreview   = React.lazy(() => import("./SvgPreview"));
const ImagePreview = React.lazy(() => import("./ImagePreview"));
const MarkdownPreview = React.lazy(() => import("./MarkdownPreview").then(m => ({ default: m.MarkdownPreview })));

// PERF-2 + PERF-3: Monaco and its self-hosted setup module (loader.config +
// MonacoEnvironment workers — see src/lib/monacoSetup.ts) only load when an
// editable tab is first opened, so the monaco vendor chunk is never fetched
// at startup. The setup module's side effects run before the editor mounts.
const Editor = React.lazy(() =>
  import("../lib/monacoSetup").then(() => import("@monaco-editor/react"))
);

interface OpenTab {
  path: string;
  name: string;
  content: string;         // asset URL for images/pdfs, plain text otherwise
  originalContent: string;
  isModified: boolean;
  fileType: string;
  fileSize?: number;
  tooLarge?: boolean;      // PERF-13: oversized file opened read-only (metadata only)
  svgViewMode?: "preview" | "split" | "code";
  mdViewMode?: "preview" | "split" | "code";
}

// PERF-13: files larger than this open in a read-only metadata view instead of
// being read into React state.
const MAX_EDITABLE_FILE_SIZE = 10 * 1024 * 1024;

// PERF-16: version-history cap fallback — replaced by the configured
// `max_versions_per_file` once the app config is loaded.
const DEFAULT_MAX_VERSIONS = 20;

// PERF-12: number of CSV rows rendered per page in grid view.
const CSV_PAGE_SIZE = 500;

// Debounce helper — keeps rapid updates from thrashing expensive sinks (iframes, grids)
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const getFileType = (name: string): string => {
  const ext = name.split(".").pop()?.toLowerCase();
  if (!ext) return "code";
  if (["txt", "md"].includes(ext)) return ext;
  if (["html", "css", "js"].includes(ext)) return "html";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico", "avif", "tiff"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "svg") return "svg";
  if (["csv", "json", "toml"].includes(ext)) return ext;
  return "code";
};

const isSvgFile = (tab?: OpenTab | null): boolean => {
  if (!tab) return false;
  return tab.fileType === "svg" || tab.name.toLowerCase().endsWith(".svg");
};

const isMdFile = (tab?: OpenTab | null): boolean => {
  if (!tab) return false;
  return tab.fileType === "md" || tab.name.toLowerCase().endsWith(".md");
};

// ── File type icon helper ──────────────────────────────────────
const getFileIcon = (file: FileEntry, isSelected: boolean) => {
  const iconColor = isSelected ? "var(--accent)" : "var(--text-muted)";
  const iconProps = { size: 13, style: { color: iconColor, flexShrink: 0 } };
  if (file.is_dir)                                                      return <Folder           {...iconProps} />;
  if (file.name.toLowerCase().endsWith(".svg"))                         return <SvgFileIcon      {...iconProps} />;
  if (file.name.toLowerCase().endsWith(".md") || file.name.toLowerCase().endsWith(".markdown")) return <MarkdownFileIcon {...iconProps} />;
  if (file.name.toLowerCase().endsWith(".txt"))                        return <FileText         {...iconProps} />;
  if (file.name.match(/\.(png|jpg|jpeg|webp|gif)$/i))                   return <ImageIcon        {...iconProps} />;
  if (file.name.endsWith(".pdf"))                                       return <FileText         {...{ ...iconProps, style: { color: "#F87171", flexShrink: 0 } }} />;
  if (file.name.match(/\.(csv|json|toml)$/i))                          return <TableIcon        {...iconProps} />;
  return <FileCode {...iconProps} />;
};

interface FileRowProps {
  file: FileEntry;
  isSelected: boolean;
  onOpen: (file: FileEntry) => void;
  onToggleSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
}

// PERF-1: memoized row — keystrokes and unrelated state changes no longer
// re-render every file in the list. Handlers are stable (see Explorer).
const FileRow = React.memo(function FileRow({ file, isSelected, onOpen, onToggleSelect, onContextMenu }: FileRowProps) {
  return (
    <div
      onClick={e => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          onToggleSelect(file.path);
        } else {
          onOpen(file);
        }
      }}
      onContextMenu={e => onContextMenu(e, file)}
      className={`exp-tree-item ${isSelected ? "selected" : ""}`}
    >
      <span className="exp-tree-icon">{getFileIcon(file, isSelected)}</span>
      <span className="exp-tree-name">{file.name}</span>
    </div>
  );
});

// PERF-1: Monaco keystrokes stay inside this leaf component. Draft text is held
// in local state and committed up to Explorer on the 800ms autosave cadence
// (immediately when the dirty flag flips), so typing never re-renders the whole
// Explorer tree. Drafts are flushed on unmount, and external content changes
// (version restore) are adopted automatically.
const MonacoTabEditor = React.memo(function MonacoTabEditor({
  tab,
  monacoTheme,
  onCommit,
}: {
  tab: OpenTab;
  monacoTheme: string;
  onCommit: (path: string, content: string) => void;
}) {
  const [draft, setDraft] = useState<string>(tab.content);
  const draftRef = useRef<string>(tab.content);
  const committedRef = useRef<string>(tab.content);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt external content changes (version-history restore, PDF re-save)
  useEffect(() => {
    if (tab.content !== committedRef.current) {
      committedRef.current = tab.content;
      draftRef.current = tab.content;
      if (commitTimerRef.current !== null) {
        clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      setDraft(tab.content);
    }
  }, [tab.content]);

  const flushCommit = useCallback(() => {
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    if (draftRef.current !== committedRef.current) {
      committedRef.current = draftRef.current;
      onCommit(tab.path, draftRef.current);
    }
  }, [onCommit, tab.path]);

  // Flush pending edits when this pane unmounts (tab switch)
  useEffect(() => flushCommit, [flushCommit]);

  const language =
    tab.fileType === "html" ? "html" :
    tab.fileType === "md"   ? "markdown" :
    tab.fileType === "json" ? "json" :
    tab.fileType === "toml" ? "ini" :
    isSvgFile(tab)          ? "xml" : "typescript";

  const handleChange = (val: string | undefined) => {
    if (val === undefined) return;
    draftRef.current = val;
    setDraft(val);

    if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      flushCommit();
    }, 800);

    // The dirty indicator must flip immediately, not on the debounce cadence
    if ((val !== tab.originalContent) !== tab.isModified) {
      flushCommit();
    }
  };

  return (
    <Editor
      height="100%"
      defaultLanguage={language}
      language={language}
      theme={monacoTheme}
      value={draft}
      onChange={handleChange}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
        lineHeight: 1.6,
        tabSize: 2,
        wordWrap: "on",
        scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
        padding: { top: 12, bottom: 12 },
      }}
    />
  );
});

// PERF-12: parse the CSV once per content change (memoized) and render in
// pages instead of materializing every row of a potentially huge file.
const CsvGridView = React.memo(function CsvGridView({ content }: { content: string }) {
  const [visibleRows, setVisibleRows] = useState<number>(CSV_PAGE_SIZE);

  const lines = useMemo(() => content.split("\n"), [content]);
  const headerCells = useMemo(() => lines[0]?.split(",") ?? [], [lines]);
  const bodyRows = useMemo(() => lines.slice(1).filter(row => row.trim()), [lines]);
  const shownRows = bodyRows.slice(0, visibleRows);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <table className="exp-grid-table">
        <thead>
          <tr>
            {headerCells.map((col, idx) => (
              <th key={idx}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shownRows.map((row, rIdx) => (
            <tr key={rIdx}>
              {row.split(",").map((cell, cIdx) => <td key={cIdx}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {bodyRows.length > shownRows.length && (
        <button
          onClick={() => setVisibleRows(prev => prev + CSV_PAGE_SIZE)}
          style={{
            alignSelf: "center",
            background: "none",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "11px",
            padding: "4px 12px",
          }}
        >
          Show more rows ({shownRows.length} of {bodyRows.length})
        </button>
      )}
    </div>
  );
});

const ExplorerComponent: React.FC = () => {
  const [currentDirPath, setCurrentDirPath] = useState<string>("");
  const [sidebarWidth, setSidebarWidth] = useState<number>(240);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  // Dynamic theme resolution for Monaco Editor (memoized to avoid DOM style thrashing)
  const monacoTheme = useMemo(() => {
    if (typeof document === "undefined") return "vs-dark";
    const themeInk = document.documentElement.style.getPropertyValue("--theme-ink") || "#F3EFE8";
    const isDark = !(themeInk.trim().toLowerCase().startsWith("#1") || themeInk.trim().toLowerCase().startsWith("#2") || themeInk.trim().toLowerCase().startsWith("#3"));
    return isDark ? "vs-dark" : "vs-light";
  }, []);

  const startResizing = React.useCallback((mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const parent = document.getElementById("explorer-parent-container");
      if (parent) {
        const rect = parent.getBoundingClientRect();
        const newWidth = e.clientX - rect.left;
        setSidebarWidth(Math.max(160, Math.min(600, newWidth)));
      }
    };

    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string>("");

  // Editor & Tabs State
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);

  // Secondary views inside active tab
  const [showPreview, setShowPreview] = useState<boolean>(true);
  const [svgViewMode, setSvgViewMode] = useState<"preview" | "split" | "code">("preview");
  const [mdViewMode, setMdViewMode] = useState<"preview" | "split" | "code">("split");
  const [isGridView, setIsGridView] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [fileVersions, setFileVersions] = useState<{version: number, timestamp: string, content: string}[]>([]);
  // PERF-16: cap for the in-memory version history (config max_versions_per_file)
  const [maxVersionsPerFile, setMaxVersionsPerFile] = useState<number>(DEFAULT_MAX_VERSIONS);

  const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [isPdfEditMode, setIsPdfEditMode] = useState<boolean>(false);

  const formatFileSize = (bytes?: number): string => {
    if (bytes === undefined || bytes === null) return "Unknown size";
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Modals
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newItemType, setNewItemType] = useState<"file" | "folder" | "import-file" | "import-folder">("file");
  const [newItemName, setNewItemName] = useState<string>("");
  const [importQueue, setImportQueue] = useState<{ path: string; type: "file" | "folder" }[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  const [showRenameModal, setShowRenameModal] = useState<boolean>(false);
  const [renameTargetPath, setRenameTargetPath] = useState<string>("");
  const [renameCurrentName, setRenameCurrentName] = useState<string>("");
  const [renameValue, setRenameValue] = useState<string>("");
  const [renameError, setRenameError] = useState<string>("");

  const openRenameModal = (targetPath: string) => {
    const name = targetPath.split(/[\\\/]/).pop() || "";
    setRenameTargetPath(targetPath);
    setRenameCurrentName(name);
    setRenameValue(name);
    setRenameError("");
    setShowRenameModal(true);
  };

  const handleRenameConfirm = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenameError("Name cannot be empty."); return; }
    if (trimmed === renameCurrentName) { setShowRenameModal(false); return; }
    try {
      await invoke("rename_file_or_dir", { oldPath: renameTargetPath, newName: trimmed });
      setShowRenameModal(false);
      loadDirectory(currentDirPath);
    } catch (err) {
      setRenameError(String(err));
    }
  };

  const openNewItemModal = (defaultType: "file" | "folder" | "import-file" | "import-folder" = "file") => {
    setNewItemType(defaultType);
    setNewItemName("");
    setImportQueue([]);
    setImportError(null);
    setShowAddModal(true);
    if (defaultType === "import-file") {
      handlePickSystemFile();
    } else if (defaultType === "import-folder") {
      handlePickSystemFolder();
    }
  };

  const handleProcessDroppedPaths = async (droppedPaths: string[]) => {
    try {
      setImportError(null);
      let itemsToAdd: { path: string; type: "file" | "folder" }[] = [];
      try {
        const entries: FileEntry[] = await invoke("inspect_paths", { paths: droppedPaths });
        if (entries && entries.length > 0) {
          itemsToAdd = entries.map(e => ({
            path: e.path,
            type: e.is_dir ? ("folder" as const) : ("file" as const)
          }));
        }
      } catch {
        // Fallback heuristic if inspect_paths unavailable
        itemsToAdd = droppedPaths.map(p => ({
          path: p,
          type: (!p.split(/[\\\/]/).pop()?.includes(".") ? "folder" : "file") as "file" | "folder"
        }));
      }

      if (itemsToAdd.length > 0) {
        setImportQueue(prev => {
          const existing = new Set(prev.map(i => i.path));
          const additions = itemsToAdd.filter(i => !existing.has(i.path));
          return [...prev, ...additions];
        });

        setShowAddModal(true);
        const hasFiles = itemsToAdd.some(i => i.type === "file");
        const hasFolders = itemsToAdd.some(i => i.type === "folder");
        if (hasFolders && !hasFiles) {
          setNewItemType("import-folder");
        } else {
          setNewItemType("import-file");
        }
      }
    } catch (err: any) {
      setImportError(err.toString());
    }
  };

  const handlePickSystemFile = async () => {
    try {
      setImportError(null);
      const paths = await invoke<string[] | null>("pick_files");
      if (paths && paths.length > 0) {
        setImportQueue(prev => {
          const existing = new Set(prev.map(i => i.path));
          const additions = paths
            .filter(p => !existing.has(p))
            .map(p => ({ path: p, type: "file" as const }));
          return [...prev, ...additions];
        });
        setNewItemType("import-file");
      }
    } catch (err: any) {
      setImportError(err.toString());
    }
  };

  const handlePickSystemFolder = async () => {
    try {
      setImportError(null);
      const paths = await invoke<string[] | null>("pick_directories");
      if (paths && paths.length > 0) {
        setImportQueue(prev => {
          const existing = new Set(prev.map(i => i.path));
          const additions = paths
            .filter(p => !existing.has(p))
            .map(p => ({ path: p, type: "folder" as const }));
          return [...prev, ...additions];
        });
        setNewItemType("import-folder");
      }
    } catch (err: any) {
      setImportError(err.toString());
    }
  };

  const handleCreateOrImport = async () => {
    const isImport = newItemType === "import-file" || newItemType === "import-folder";
    if (!isImport) {
      if (!newItemName.trim()) { setImportError("Please enter a name"); return; }
      try {
        if (newItemType === "file") {
          await invoke("create_new_file", { parentDir: currentDirPath, name: newItemName.trim() });
        } else {
          await invoke("create_new_folder", { parentDir: currentDirPath, name: newItemName.trim() });
        }
        setShowAddModal(false);
        loadDirectory(currentDirPath);
      } catch (err: any) {
        setImportError(err.toString());
      }
    } else {
      if (importQueue.length === 0) { setImportError("Please select at least one file or folder to import"); return; }
      try {
        const results = await Promise.allSettled(
          importQueue.map(item =>
            invoke<string>("import_to_directory", { sourcePath: item.path, destDir: currentDirPath })
          )
        );

        const succeededIndices: number[] = [];
        const failureMessages: string[] = [];

        results.forEach((res, idx) => {
          if (res.status === "fulfilled") {
            succeededIndices.push(idx);
          } else {
            failureMessages.push(res.reason?.toString() || "Unknown import error");
          }
        });

        if (succeededIndices.length > 0) {
          loadDirectory(currentDirPath);
        }

        if (failureMessages.length === 0) {
          setShowAddModal(false);
        } else {
          const failedItems = importQueue.filter((_, idx) => !succeededIndices.includes(idx));
          setImportQueue(failedItems);
          setImportError(
            failureMessages.length === 1
              ? failureMessages[0]
              : `${failureMessages.length} item(s) failed: ${failureMessages.join("; ")}`
          );
        }
      } catch (err: any) {
        setImportError(err.toString());
      }
    }
  };

  const { showContextMenu, ContextMenuComponent } = useCustomContextMenu();

  // PERF-14: window/keyboard listeners and memoized file rows read the latest
  // state & handlers through this ref (assigned every render below), so the
  // listeners register once and row handlers keep a stable identity.
  const latestRef = useRef<any>(null);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    try {
      const result: FileEntry[] = await invoke("list_directory_contents", { dirPath: path });
      // Hide the system Cache folder from the Explorer sidebar
      const filtered = result.filter(e => e.name !== "Cache");
      setFiles(filtered);
      if (path === "") {
        const wsPath: string = await invoke("get_workspace_path");
        setWorkspaceRootPath(wsPath);
        setCurrentDirPath(wsPath);
      } else {
        setCurrentDirPath(path);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadDirectory("");
    const unsub = listen("config_updated", () => loadDirectory(""));

    // PERF-16: read the configured version-history cap
    invoke<AppConfig>("get_app_config")
      .then(cfg => {
        const max = cfg?.editor?.max_versions_per_file;
        if (typeof max === "number" && max > 0) setMaxVersionsPerFile(max);
      })
      .catch(() => {});

    return () => { unsub.then(fn => fn()); };
  }, []);

  // Native Tauri drag-and-drop listener for external files & folders
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let isCancelled = false;

    try {
      getCurrentWebview().onDragDropEvent((event) => {
        if (isCancelled) return;
        if (event.payload.type === "over" || event.payload.type === "enter") {
          setIsDraggingOver(true);
        } else if (event.payload.type === "leave") {
          setIsDraggingOver(false);
        } else if (event.payload.type === "drop") {
          setIsDraggingOver(false);
          const droppedPaths: string[] = event.payload.paths || [];
          if (droppedPaths.length > 0) {
            handleProcessDroppedPaths(droppedPaths);
          }
        }
      }).then(unlisten => {
        if (isCancelled) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      }).catch(err => {
        console.warn("onDragDropEvent attachment warning:", err);
      });
    } catch (err) {
      console.warn("getCurrentWebview error:", err);
    }

    return () => {
      isCancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Keyboard shortcuts (PERF-14: registered once — the handler reads the
  // latest state and handlers through latestRef)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target?.closest(".monaco-editor") ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) return;

      const s = latestRef.current;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); s.saveActiveTab(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (s.activeTabPath) {
          const filtered = s.openTabs.filter(t => t.path !== s.activeTabPath);
          setOpenTabs(filtered);
          setActiveTabPath(filtered.length > 0 ? filtered[filtered.length - 1].path : null);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); s.openNewItemModal("file"); }
      if (e.key === "F2") {
        e.preventDefault();
        const targetPath = s.selectedPaths.length === 1 ? s.selectedPaths[0] : s.activeTabPath;
        if (targetPath) s.openRenameModal(targetPath);
      }
      if (e.key === "Delete" || e.key === "Del") {
        e.preventDefault();
        const targets = s.selectedPaths.length > 0 ? s.selectedPaths : (s.activeTabPath ? [s.activeTabPath] : []);
        const toDelete = targets.filter(p => !p.includes("composer.toml"));
        if (toDelete.length > 0) {
          if (confirm(`Are you sure you want to delete ${toDelete.length} selected item(s)?`)) {
            Promise.all(toDelete.map(path => invoke("delete_file_or_dir", { path })))
              .then(() => {
                setSelectedPaths([]);
                s.loadDirectory(s.currentDirPath);
                const remainingTabs = s.openTabs.filter(t => !toDelete.includes(t.path));
                setOpenTabs(remainingTabs);
                if (s.activeTabPath && toDelete.includes(s.activeTabPath)) {
                  setActiveTabPath(remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].path : null);
                }
              })
              .catch(err => alert(err));
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); setSelectedPaths(s.files.map(f => f.path)); }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const openFile = useCallback(async (entry: FileEntry) => {
    trackRecentFile(entry.path, entry.name);
    if (latestRef.current && latestRef.current.openTabs.some(t => t.path === entry.path)) {
      setActiveTabPath(entry.path);
      return;
    }

    const type = getFileType(entry.name);
    let content = "";
    let tooLarge = false;
    let fileSize = entry.size;

    if (type === "pdf" || type === "image") {
      try { content = convertFileSrc(entry.path); }
      catch (e) { content = `[Failed to resolve asset path: ${e}]`; }
    } else if (entry.size > MAX_EDITABLE_FILE_SIZE) {
      // PERF-13: don't read multi-megabyte files into memory — open a
      // read-only metadata view instead.
      tooLarge = true;
    } else {
      try {
        content = await invoke("read_text_file", { filePath: entry.path });
        // PERF-13: the size may be unknown (e.g. opened via Home search) —
        // guard again after reading and drop the content if it's huge.
        if (content.length > MAX_EDITABLE_FILE_SIZE) {
          tooLarge = true;
          if (!fileSize) fileSize = content.length;
          content = "";
        }
      } catch (e) { content = `[Binary content or could not read file: ${e}]`; }
    }

    const newTab: OpenTab = {
      path: entry.path, name: entry.name, content, originalContent: content,
      isModified: false, fileType: type, fileSize, tooLarge,
      svgViewMode: type === "svg" ? "preview" : undefined,
      mdViewMode:  type === "md"  ? "split"   : undefined,
    };
    setOpenTabs(prev => [...prev, newTab]);
    setActiveTabPath(entry.path);
  }, []);

  // Listen for file-open and quick-action events dispatched from Home or elsewhere
  // (PERF-14: registered once — handlers read the latest state via latestRef)
  useEffect(() => {
    const handleOpenFile = async (e: any) => {
      const { path, name, is_dir } = e.detail || {};
      if (!path) return;
      if (is_dir) {
        latestRef.current.loadDirectory(path);
      } else {
        const fileName = name || path.split(/[\\\/]/).pop() || "file";
        await latestRef.current.openFile({ name: fileName, path, is_dir: false, size: 0 });
      }
    };

    const handleHomeAction = (e: any) => {
      const action = e.detail;
      if (action === "file" || action === "folder" || action === "import-file" || action === "import-folder") {
        latestRef.current.openNewItemModal(action);
      }
    };

    window.addEventListener("composer:open-file", handleOpenFile);
    window.addEventListener("composer:home-action", handleHomeAction);
    return () => {
      window.removeEventListener("composer:open-file", handleOpenFile);
      window.removeEventListener("composer:home-action", handleHomeAction);
    };
  }, []);

  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = openTabs.filter(t => t.path !== path);
    setOpenTabs(filtered);
    if (activeTabPath === path) {
      setActiveTabPath(filtered.length > 0 ? filtered[filtered.length - 1].path : null);
    }
  };

  const saveActiveTab = async () => {
    const tab = openTabs.find(t => t.path === activeTabPath);
    if (tab && tab.isModified && tab.fileType !== "pdf") {
      try {
        await invoke("write_text_file", { filePath: tab.path, content: tab.content });
        setOpenTabs(openTabs.map(t => t.path === tab.path ? { ...t, isModified: false, originalContent: t.content } : t));
        // PERF-16: cap the in-memory version history at the configured limit
        const newVersion = {
          version: (fileVersions[0]?.version ?? 0) + 1,
          timestamp: new Date().toLocaleTimeString(),
          content: tab.content,
        };
        setFileVersions([newVersion, ...fileVersions].slice(0, maxVersionsPerFile));
      } catch (e) { alert("Failed to save: " + e); }
    }
  };

  // PERF-1: the single commit path from the editor pane into tab state (also
  // used by version-history restore). Returns the same tab object when nothing
  // actually changed so no-op flushes don't cause a re-render.
  const commitTabContent = useCallback((path: string, val: string) => {
    setOpenTabs(prev => prev.map(t => {
      if (t.path !== path) return t;
      const isModified = val !== t.originalContent;
      if (t.content === val && t.isModified === isModified) return t;
      return { ...t, content: val, isModified };
    }));
  }, []);

  // PERF-14: keep the ref pointing at the latest state & handlers
  latestRef.current = {
    selectedPaths, activeTabPath, openTabs, currentDirPath, files,
    loadDirectory, openFile, saveActiveTab, openRenameModal, openNewItemModal,
  };

  const activeTab = openTabs.find(t => t.path === activeTabPath);

  // SEC-8 + PERF-5: script-free preview (sandbox=""), debounced so typing
  // doesn't tear down and rebuild the iframe on every keystroke
  const debouncedHtmlContent = useDebouncedValue(
    activeTab?.fileType === "html" ? activeTab.content : "",
    250
  );

  // PERF-1: filter the file list once per query change (lowercase computed
  // once), not per file per render
  const visibleFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter(f => f.name.toLowerCase().includes(q));
  }, [files, searchQuery]);

  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const activeSvgMode = activeTab?.svgViewMode || svgViewMode;
  const setSvgMode = (mode: "preview" | "split" | "code") => {
    setSvgViewMode(mode);
    if (activeTabPath) setOpenTabs(prev => prev.map(t => t.path === activeTabPath ? { ...t, svgViewMode: mode } : t));
  };

  const activeMdMode = activeTab?.mdViewMode || mdViewMode;
  const setMdMode = (mode: "preview" | "split" | "code") => {
    setMdViewMode(mode);
    if (activeTabPath) setOpenTabs(prev => prev.map(t => t.path === activeTabPath ? { ...t, mdViewMode: mode } : t));
  };

  // Debounced auto-save
  useEffect(() => {
    if (!activeTab || !activeTab.isModified || activeTab.fileType === "pdf") return;
    const timer = setTimeout(async () => {
      try {
        await invoke("write_text_file", { filePath: activeTab.path, content: activeTab.content });
        setOpenTabs(prev => prev.map(t =>
          t.path === activeTab.path ? { ...t, isModified: false, originalContent: activeTab.content } : t
        ));
      } catch (e) { console.error("Auto-save failed:", e); }
    }, 800);
    return () => clearTimeout(timer);
  }, [activeTab?.content, activeTab?.path, activeTab?.isModified]);

  // Context menus (PERF-1: stable identity for the memoized file rows; reads
  // the latest state via latestRef. showContextMenu only calls a stable
  // setter, so the first-render instance is safe to keep.)
  const handleFileRightClick = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    let currentSelection = latestRef.current.selectedPaths;
    if (!currentSelection.includes(entry.path)) {
      currentSelection = [entry.path];
      setSelectedPaths([entry.path]);
    }
    showContextMenu(e, [
      {
        label: currentSelection.length > 1 ? `Open Selected (${currentSelection.length})` : `Open ${entry.name}`,
        icon: <File size={13} />,
        onClick: () => {
          const s = latestRef.current;
          if (entry.is_dir && currentSelection.length === 1) {
            s.loadDirectory(entry.path);
          } else {
            currentSelection.forEach(async (path) => {
              const fileObj = s.files.find(f => f.path === path);
              if (fileObj && !fileObj.is_dir) s.openFile(fileObj);
            });
          }
        }
      },
      { label: "", isSeparator: true },
      { label: "Rename", shortcut: "F2", disabled: currentSelection.length > 1, onClick: () => latestRef.current.openRenameModal(entry.path) },
      {
        label: "Delete", shortcut: "Del",
        disabled: currentSelection.some(p => p.includes("composer.toml")),
        onClick: () => {
          if (confirm(`Are you sure you want to delete ${currentSelection.length} selected item(s)?`)) {
            Promise.all(currentSelection.map(path => invoke("delete_file_or_dir", { path })))
              .then(() => {
                setSelectedPaths([]);
                const s = latestRef.current;
                s.loadDirectory(s.currentDirPath);
                const remainingTabs = s.openTabs.filter(t => !currentSelection.includes(t.path));
                setOpenTabs(remainingTabs);
                if (s.activeTabPath && currentSelection.includes(s.activeTabPath)) {
                  setActiveTabPath(remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].path : null);
                }
              })
              .catch(err => alert(err));
          }
        }
      }
    ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSidebarBlankRightClick = (e: React.MouseEvent) => {
    showContextMenu(e, [
      { label: "New File",         icon: <Plus size={13} />,       shortcut: "Ctrl+N", onClick: () => openNewItemModal("file") },
      { label: "New Folder",       icon: <Folder size={13} />,                          onClick: () => openNewItemModal("folder") },
      { label: "Import Files...",  icon: <Upload size={13} />,                          onClick: () => openNewItemModal("import-file") },
      { label: "Import Folders...",icon: <FolderPlus size={13} />,                      onClick: () => openNewItemModal("import-folder") },
      { label: "", isSeparator: true },
      { label: "Refresh List",     icon: <RotateCw size={13} />,                        onClick: () => loadDirectory(currentDirPath) }
    ]);
  };

  // PERF-1: stable row handlers so memoized FileRows don't re-render
  const handleRowToggleSelect = useCallback((path: string) => {
    setSelectedPaths(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    );
  }, []);

  const handleRowOpen = useCallback((file: FileEntry) => {
    setSelectedPaths([file.path]);
    if (file.is_dir) loadDirectory(file.path);
    else openFile(file);
  }, [loadDirectory, openFile]);

  // ─────────────────────────────────────────────────────────────
  return (
    <div id="explorer-parent-container" className="exp-root">

      {/* ── File Tree Left Sidebar ──────────────────────────── */}
      <div
        id="explorer-sidebar-container"
        className="exp-tree"
        style={{ width: `${sidebarWidth}px` }}
        onContextMenu={handleSidebarBlankRightClick}
      >
        {/* Header */}
        <div className="exp-tree-header">
          <span className="exp-tree-title">Files</span>
          <button
            onClick={() => openNewItemModal("file")}
            className="exp-tree-add-btn"
            title="New File (Ctrl+N)"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Path / Breadcrumb */}
        <div className="exp-tree-path" title={currentDirPath}>
          <span
            className="exp-tree-path-root"
            onClick={() => loadDirectory("")}
            title="Return to workspace root"
          >
            Workspace
          </span>
          {currentDirPath && currentDirPath !== workspaceRootPath && (
            <>
              <ChevronRight size={9} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
              <span className="exp-tree-path-current">
                {currentDirPath.split(/[\\\/]/).pop() || "Root"}
              </span>
            </>
          )}
        </div>

        {/* Search */}
        <div className="exp-tree-search">
          <Search size={11} className="exp-search-icon" />
          <input
            id="explorer-search-input"
            type="text"
            placeholder="Filter files..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="exp-search-input"
          />
        </div>

        {/* File List */}
        <div
          id="explorer-sidebar-scroll-container"
          className="exp-tree-list"
          onClick={e => {
            if (e.target === e.currentTarget) setSelectedPaths([]);
          }}
        >
          {/* Up directory */}
          {currentDirPath !== workspaceRootPath && currentDirPath !== "" && currentDirPath !== "/" && (
            <div
              className="exp-tree-up"
              onClick={() => {
                const lastSep = Math.max(currentDirPath.lastIndexOf("\\"), currentDirPath.lastIndexOf("/"));
                const parent = lastSep !== -1 ? currentDirPath.substring(0, lastSep) : "";
                if (!parent || parent.length < workspaceRootPath.length) loadDirectory("");
                else loadDirectory(parent);
              }}
            >
              <ChevronDown size={11} style={{ transform: "rotate(90deg)", color: "var(--text-muted)" }} />
              <span style={{ fontSize: "11px" }}>.. [Up Directory]</span>
            </div>
          )}

          {/* File entries */}
          {visibleFiles.map(file => (
            <FileRow
              key={file.path}
              file={file}
              isSelected={selectedPathSet.has(file.path)}
              onOpen={handleRowOpen}
              onToggleSelect={handleRowToggleSelect}
              onContextMenu={handleFileRightClick}
            />
          ))}
        </div>
      </div>

      {/* ── Resize Handle ──────────────────────────────────────── */}
      <div
        onMouseDown={startResizing}
        className={`exp-resizer ${isResizing ? "active" : ""}`}
        style={{ marginLeft: "-1px", marginRight: "-1px" }}
      />

      {/* ── Editor Panel ─────────────────────────────────────── */}
      <div
        className="exp-panel"
        onContextMenu={e => { if (openTabs.length === 0) handleSidebarBlankRightClick(e); }}
      >

        {/* Tabs Bar */}
        {openTabs.length > 0 ? (
          <div className="exp-tabs">
            {openTabs.map(tab => (
              <div
                key={tab.path}
                onClick={() => setActiveTabPath(tab.path)}
                className={`exp-tab ${activeTabPath === tab.path ? "active" : ""}`}
              >
                <span style={{ fontSize: "12px" }}>{tab.name}</span>
                {tab.isModified && <span className="exp-tab-modified-dot" title="Unsaved changes" />}
                <button
                  className="exp-tab-close"
                  onClick={e => closeTab(tab.path, e)}
                  title="Close tab"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* Empty state */
          <div className="exp-empty">
            <div className="exp-empty-brand">Composer</div>
            <p className="exp-empty-hint">
              Select a file from the tree to open it in the editor.
            </p>
          </div>
        )}

        {/* Tab Content */}
        {activeTab && (activeTab.tooLarge ? (
          /* PERF-13: oversized file — read-only metadata view (matches empty state) */
          <div className="exp-empty">
            <div className="exp-empty-brand" style={{ fontSize: "22px", opacity: 0.5 }}>{activeTab.name}</div>
            <p className="exp-empty-hint">
              This file is {formatFileSize(activeTab.fileSize)} — too large to open in the editor
              (limit {formatFileSize(MAX_EDITABLE_FILE_SIZE)}).
            </p>
            <p className="exp-empty-hint" style={{ fontSize: "11px", opacity: 0.7 }}>{activeTab.path}</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* Editor Workspace Column */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

              {/* Toolstrip */}
              <div className="exp-toolstrip">
                <div className="exp-toolstrip-left">
                  <span className="exp-mode-label">
                    {isSvgFile(activeTab)
                      ? `SVG · ${activeSvgMode}`
                      : isMdFile(activeTab)
                      ? `MD · ${activeMdMode}`
                      : activeTab.fileType}
                  </span>

                  {activeTab.isModified && (
                    <button onClick={saveActiveTab} className="exp-save-btn">
                      <Save size={10} />
                      <span>Save</span>
                    </button>
                  )}
                </div>

                <div className="exp-toolstrip-right">
                  {/* Versions button */}
                  <button
                    onClick={() => {
                      setShowHistory(!showHistory);
                      if (fileVersions.length === 0) {
                        setFileVersions([{ version: 1, timestamp: "Initial Open", content: activeTab.content }]);
                      }
                    }}
                    className={`exp-icon-btn ${showHistory ? "active" : ""}`}
                    title="Version History"
                  >
                    <History size={11} />
                    <span>Versions</span>
                  </button>

                  {/* SVG mode toggle */}
                  {isSvgFile(activeTab) && (
                    <div className="exp-mode-group">
                      {(["preview", "split", "code"] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setSvgMode(mode)}
                          className={`exp-mode-btn ${activeSvgMode === mode ? "active" : ""}`}
                          title={mode}
                        >
                          {mode === "preview" ? <SvgFileIcon size={10} /> : mode === "split" ? <Columns size={10} /> : <Code size={10} />}
                          <span style={{ textTransform: "capitalize" }}>{mode}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Markdown mode toggle */}
                  {isMdFile(activeTab) && (
                    <div className="exp-mode-group">
                      {(["preview", "split", "code"] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setMdMode(mode)}
                          className={`exp-mode-btn ${activeMdMode === mode ? "active" : ""}`}
                          title={mode}
                        >
                          {mode === "preview" ? <BookOpen size={10} /> : mode === "split" ? <Columns size={10} /> : <Code size={10} />}
                          <span style={{ textTransform: "capitalize" }}>{mode === "code" ? "Editor" : mode}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* HTML preview toggle */}
                  {activeTab.fileType === "html" && (
                    <button
                      onClick={() => setShowPreview(!showPreview)}
                      className={`exp-icon-btn ${showPreview ? "active" : ""}`}
                    >
                      <Columns size={11} />
                      <span>Split Preview</span>
                    </button>
                  )}

                  {/* PDF edit toggle */}
                  {activeTab.fileType === "pdf" && (
                    <button
                      onClick={() => setIsPdfEditMode(!isPdfEditMode)}
                      className={`exp-icon-btn ${isPdfEditMode ? "active" : ""}`}
                    >
                      <Code size={11} />
                      <span>{isPdfEditMode ? "View PDF" : "Edit Text"}</span>
                    </button>
                  )}

                  {/* CSV/JSON/TOML grid toggle */}
                  {["csv", "toml", "json"].includes(activeTab.fileType) && (
                    <button
                      onClick={() => setIsGridView(!isGridView)}
                      className={`exp-icon-btn ${isGridView ? "active" : ""}`}
                    >
                      {isGridView ? <Code size={11} /> : <Grid3x3 size={11} />}
                      <span>{isGridView ? "Raw Text" : "Grid Table"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Main Workspace Frame */}
              <Suspense fallback={
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                  <span style={{ opacity: 0.7 }}>Loading viewer...</span>
                </div>
              }>
                <div style={{ flex: 1, display: "flex", overflow: "hidden", borderLeft: "0", borderRight: "0" }}>

                  {/* Full-screen SVG preview */}
                  {isSvgFile(activeTab) && activeSvgMode === "preview" ? (
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <SvgPreview svgContent={activeTab.content} fileName={activeTab.name} fileSize={activeTab.fileSize} />
                    </div>
                  ) : activeTab.fileType === "image" ? (
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <ImagePreview src={activeTab.content} fileName={activeTab.name} filePath={activeTab.path} fileSize={activeTab.fileSize} />
                    </div>
                  ) : isMdFile(activeTab) && activeMdMode === "preview" ? (
                    <div style={{ flex: 1, overflow: "hidden", backgroundColor: "var(--bg-app)" }}>
                      <MarkdownPreview content={activeTab.content} fileName={activeTab.name} filePath={activeTab.path} workspaceRoot={workspaceRootPath} />
                    </div>
                  ) : (
                    <div className="exp-monaco-wrapper" style={{ flex: 1, height: "100%", position: "relative" }}>
                      {isGridView ? (
                        <div style={{ width: "100%", height: "100%", overflow: "auto", padding: "12px", backgroundColor: "var(--bg-app)" }}>
                          {activeTab.fileType === "csv" ? (
                            <CsvGridView key={activeTab.path} content={activeTab.content} />
                          ) : (
                            <div style={{ padding: "12px", backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                              {activeTab.content}
                            </div>
                          )}
                        </div>
                      ) : activeTab.fileType === "pdf" ? (
                        <PdfEditor
                          filePath={activeTab.path}
                          base64DataUrl={activeTab.content}
                          onSaved={newDataUrl => {
                            setOpenTabs(prev => prev.map(t =>
                              t.path === activeTab.path ? { ...t, content: newDataUrl, originalContent: newDataUrl, isModified: false } : t
                            ));
                          }}
                        />
                      ) : (
                        <MonacoTabEditor
                          key={activeTab.path}
                          tab={activeTab}
                          monacoTheme={monacoTheme}
                          onCommit={commitTabContent}
                        />
                      )}
                    </div>
                  )}

                  {/* SVG Split Preview Pane */}
                  {isSvgFile(activeTab) && activeSvgMode === "split" && (
                    <div style={{ width: "50%", height: "100%", overflow: "hidden", borderLeft: "1px solid var(--border-subtle)" }}>
                      <SvgPreview svgContent={activeTab.content} fileName={activeTab.name} fileSize={activeTab.fileSize} />
                    </div>
                  )}

                  {/* Markdown Split Preview Pane */}
                  {isMdFile(activeTab) && activeMdMode === "split" && (
                    <div style={{ width: "50%", height: "100%", overflow: "hidden", borderLeft: "1px solid var(--border-subtle)", backgroundColor: "var(--bg-app)" }}>
                      <MarkdownPreview content={activeTab.content} fileName={activeTab.name} filePath={activeTab.path} workspaceRoot={workspaceRootPath} />
                    </div>
                  )}

                  {/* HTML Preview Pane */}
                  {showPreview && activeTab.fileType === "html" && (
                    <div style={{ width: "50%", height: "100%", overflow: "hidden", borderLeft: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column" }}>
                      <div className="exp-preview-header">
                        <span>Live sandboxed preview</span>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: "10px", display: "flex", alignItems: "center", gap: "4px" }}>
                            <RotateCw size={10} /> Reload
                          </button>
                        </div>
                      </div>
                      {/* SEC-8: purely visual preview — no allow-scripts.
                          PERF-5: srcDoc is debounced (250ms) so typing
                          doesn't tear down and rebuild the iframe per keystroke. */}
                      <iframe sandbox="" style={{ flex: 1, border: "none" }} srcDoc={debouncedHtmlContent} />
                    </div>
                  )}

                  {/* Version History Panel */}
                  {showHistory && (
                    <div className="exp-history">
                      <div className="exp-history-header">
                        <span className="exp-history-title">Version History</span>
                        <button
                          onClick={() => setShowHistory(false)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <div className="exp-history-list">
                        {fileVersions.map(v => (
                          <div key={v.version} className="exp-history-item">
                            <div className="exp-history-meta">
                              <span className="exp-history-version">v{v.version}</span>
                              <span className="exp-history-time">{v.timestamp}</span>
                            </div>
                            <button
                              className="exp-history-restore-btn"
                              onClick={() => commitTabContent(activeTab.path, v.content)}
                            >
                              Restore
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              </Suspense>
            </div>
          </div>
          )
        )}
      </div>

      {/* ── Create / Import Modal ─────────────────────────────── */}
      {showAddModal && (
        <div className="dlg-overlay">
          <div
            className={`dlg-panel ${isDraggingOver ? "dragging" : ""}`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
          >
            <div className="dlg-header">
              <div className="dlg-title-group">
                <span className="dlg-title-icon"><Plus size={16} /></span>
                <span className="dlg-title">Create / Import Item</span>
              </div>
              <button className="dlg-close-btn" onClick={() => setShowAddModal(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="dlg-body">
              {/* Type selector */}
              <div className="dlg-field">
                <span className="dlg-label">Action &amp; Type</span>
                <div className="dlg-type-grid">
                  {([
                    { type: "file"          as const, label: "New File",       Icon: File       },
                    { type: "folder"        as const, label: "New Folder",     Icon: Folder     },
                    { type: "import-file"   as const, label: "Import Files",   Icon: Upload     },
                    { type: "import-folder" as const, label: "Import Folders", Icon: FolderPlus },
                  ]).map(({ type, label, Icon }) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setNewItemType(type);
                        setImportError(null);
                        if (!type.startsWith("import")) setImportQueue([]);
                        if (type === "import-file") handlePickSystemFile();
                        if (type === "import-folder") handlePickSystemFolder();
                      }}
                      className={`dlg-type-btn ${newItemType === type ? "active" : ""}`}
                    >
                      <Icon size={13} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Import browse zone when queue is empty */}
              {(newItemType === "import-file" || newItemType === "import-folder") && importQueue.length === 0 && (
                <div
                  className={`dlg-browse-zone ${isDraggingOver ? "dragging" : ""}`}
                  onClick={newItemType === "import-file" ? handlePickSystemFile : handlePickSystemFolder}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); }}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
                >
                  <Upload size={22} className={`dlg-browse-icon ${isDraggingOver ? "animate-bounce" : ""}`} />
                  <span className="dlg-browse-title">
                    {isDraggingOver
                      ? "Drop Files or Folders Here"
                      : (newItemType === "import-file" ? "Click to Browse or Drag & Drop Files" : "Click to Browse or Drag & Drop Folders")}
                  </span>
                  <span className="dlg-browse-sub">
                    {isDraggingOver
                      ? "Release to stage for workspace import"
                      : "Drag & drop multiple files or folders from Windows Explorer directly here"}
                  </span>
                </div>
              )}

              {/* Import queue */}
              {(newItemType === "import-file" || newItemType === "import-folder") && importQueue.length > 0 && (
                <div
                  className={`dlg-queue ${isDraggingOver ? "dragging" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); }}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
                >
                  <div className="dlg-queue-header">
                    <span className="dlg-label">
                      {isDraggingOver ? "Drop to Add More Items..." : `Import Queue — ${importQueue.length} item${importQueue.length !== 1 ? "s" : ""}`}
                    </span>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={newItemType === "import-file" ? handlePickSystemFile : handlePickSystemFolder}
                        className="dlg-queue-add-btn"
                        title="Select more items to add to queue"
                      >
                        <Plus size={11} />
                        Add More
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportQueue([])}
                        className="dlg-queue-clear-btn"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                  <div className="dlg-queue-list">
                    {importQueue.map((item, idx) => (
                      <div key={item.path} className="dlg-queue-item">
                        <span className="dlg-queue-icon">
                          {item.type === "folder" ? <Folder size={11} /> : <File size={11} />}
                        </span>
                        <span className="dlg-queue-name" title={item.path}>
                          {item.path.split(/[\\\/]/).pop()}
                        </span>
                        <button
                          type="button"
                          className="dlg-queue-remove-btn"
                          onClick={() => setImportQueue(prev => prev.filter((_, i) => i !== idx))}
                          title="Remove from queue"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Name input for new file/folder */}
              {!newItemType.startsWith("import") && (
                <div className="dlg-field">
                  <span className="dlg-label">{newItemType === "folder" ? "Folder Name" : "File Name"}</span>
                  <input
                    type="text"
                    value={newItemName}
                    onChange={e => { setNewItemName(e.target.value); setImportError(null); }}
                    placeholder={newItemType === "folder" ? "e.g. components, utils" : "e.g. index.css, app.js"}
                    className="dlg-input"
                    autoFocus
                    onKeyDown={e => { if (e.key === "Enter") handleCreateOrImport(); }}
                  />
                  <div
                    className={`dlg-browse-zone ${isDraggingOver ? "dragging" : ""}`}
                    style={{ padding: "12px 14px", marginTop: "4px" }}
                    onClick={() => openNewItemModal("import-file")}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); }}
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
                  >
                    <Upload size={14} className="dlg-browse-icon" />
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                      {isDraggingOver ? "Drop to switch to Import Queue" : "Or drag & drop external files/folders here to import"}
                    </span>
                  </div>
                </div>
              )}

              {importError && <div className="dlg-error">⚠ {importError}</div>}
            </div>

            <div className="dlg-footer">
              <button type="button" className="dlg-btn-cancel" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button
                type="button"
                className="dlg-btn-confirm"
                onClick={handleCreateOrImport}
                disabled={newItemType.startsWith("import") && importQueue.length === 0}
              >
                {newItemType.startsWith("import")
                  ? importQueue.length > 0
                    ? `Import ${importQueue.length} Item${importQueue.length !== 1 ? "s" : ""}`
                    : "No Items Selected"
                  : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rename Modal ─────────────────────────────────────── */}
      {showRenameModal && (
        <div className="dlg-overlay">
          <div className="dlg-panel dlg-panel--sm">
            <div className="dlg-header">
              <div className="dlg-title-group">
                <span className="dlg-title-icon"><FileText size={15} /></span>
                <span className="dlg-title">Rename</span>
              </div>
              <button className="dlg-close-btn" onClick={() => setShowRenameModal(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="dlg-body">
              <p className="dlg-hint" style={{ padding: 0, marginBottom: 0 }}>
                Renaming: <code>{renameCurrentName}</code>
              </p>

              <div className="dlg-field">
                <span className="dlg-label">New Name</span>
                <input
                  type="text"
                  value={renameValue}
                  onChange={e => { setRenameValue(e.target.value); setRenameError(""); }}
                  className="dlg-input"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === "Enter") handleRenameConfirm();
                    if (e.key === "Escape") setShowRenameModal(false);
                  }}
                />
              </div>

              {renameError && <div className="dlg-error">⚠ {renameError}</div>}
            </div>

            <div className="dlg-footer">
              <button type="button" className="dlg-btn-cancel" onClick={() => setShowRenameModal(false)}>Cancel</button>
              <button type="button" className="dlg-btn-confirm" onClick={handleRenameConfirm}>Rename</button>
            </div>
          </div>
        </div>
      )}

      {ContextMenuComponent}
    </div>
  );
};

// PERF-7: memoized page — App-level updates (page switches, config changes)
// don't re-render the Explorer while it stays mounted in the background.
export const Explorer = React.memo(ExplorerComponent);
