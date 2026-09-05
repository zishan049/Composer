// @ts-nocheck
import React, { useState, useEffect, useMemo, Suspense } from "react";
import Editor from "@monaco-editor/react";
import { 
  Folder, File, FileText, Image as ImageIcon, Table as TableIcon, 
  Search, Plus, Save, BookOpen,
  RotateCw, Columns, Code, FileCode, History, X, ChevronRight, ChevronDown,
  Grid3x3, List, Upload, FolderPlus
} from "lucide-react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileEntry } from "../types";
import { useCustomContextMenu } from "./ContextMenu";

// Lazy-loaded heavy media & preview engines
const PdfEditor    = React.lazy(() => import("./PdfEditor"));
const SvgPreview   = React.lazy(() => import("./SvgPreview"));
const ImagePreview = React.lazy(() => import("./ImagePreview"));
const MarkdownPreview = React.lazy(() => import("./MarkdownPreview").then(m => ({ default: m.MarkdownPreview })));

interface OpenTab {
  path: string;
  name: string;
  content: string;         // asset URL for images/pdfs, plain text otherwise
  originalContent: string;
  isModified: boolean;
  fileType: string;
  fileSize?: number;
  svgViewMode?: "preview" | "split" | "code";
  mdViewMode?: "preview" | "split" | "code";
}

export const Explorer: React.FC = () => {
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

  // Load directory contents
  const loadDirectory = async (path: string) => {
    try {
      const result: FileEntry[] = await invoke("list_directory_contents", { dirPath: path });
      setFiles(result);
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
  };

  useEffect(() => {
    loadDirectory("");
    const unsub = listen("config_updated", () => loadDirectory(""));
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target?.closest(".monaco-editor") ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveActiveTab(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeTabPath) {
          const filtered = openTabs.filter(t => t.path !== activeTabPath);
          setOpenTabs(filtered);
          setActiveTabPath(filtered.length > 0 ? filtered[filtered.length - 1].path : null);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); openNewItemModal("file"); }
      if (e.key === "F2") {
        e.preventDefault();
        const targetPath = selectedPaths.length === 1 ? selectedPaths[0] : activeTabPath;
        if (targetPath) openRenameModal(targetPath);
      }
      if (e.key === "Delete" || e.key === "Del") {
        e.preventDefault();
        const targets = selectedPaths.length > 0 ? selectedPaths : (activeTabPath ? [activeTabPath] : []);
        const toDelete = targets.filter(p => !p.includes("composer.toml"));
        if (toDelete.length > 0) {
          if (confirm(`Are you sure you want to delete ${toDelete.length} selected item(s)?`)) {
            Promise.all(toDelete.map(path => invoke("delete_file_or_dir", { path })))
              .then(() => {
                setSelectedPaths([]);
                loadDirectory(currentDirPath);
                const remainingTabs = openTabs.filter(t => !toDelete.includes(t.path));
                setOpenTabs(remainingTabs);
                if (activeTabPath && toDelete.includes(activeTabPath)) {
                  setActiveTabPath(remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].path : null);
                }
              })
              .catch(err => alert(err));
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); setSelectedPaths(files.map(f => f.path)); }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPaths, activeTabPath, openTabs, currentDirPath, files]);

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

  const openFile = async (entry: FileEntry) => {
    const existing = openTabs.find(t => t.path === entry.path);
    if (existing) { setActiveTabPath(entry.path); return; }

    const type = getFileType(entry.name);
    let content = "";
    if (type === "pdf" || type === "image") {
      try { content = convertFileSrc(entry.path); }
      catch (e) { content = `[Failed to resolve asset path: ${e}]`; }
    } else {
      try { content = await invoke("read_text_file", { filePath: entry.path }); }
      catch (e) { content = `[Binary content or could not read file: ${e}]`; }
    }

    const newTab: OpenTab = {
      path: entry.path, name: entry.name, content, originalContent: content,
      isModified: false, fileType: type, fileSize: entry.size,
      svgViewMode: type === "svg" ? "preview" : undefined,
      mdViewMode:  type === "md"  ? "split"   : undefined,
    };
    setOpenTabs([...openTabs, newTab]);
    setActiveTabPath(entry.path);
  };

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
        const newVersion = { version: fileVersions.length + 1, timestamp: new Date().toLocaleTimeString(), content: tab.content };
        setFileVersions([newVersion, ...fileVersions]);
      } catch (e) { alert("Failed to save: " + e); }
    }
  };

  const handleContentChange = (val: string | undefined) => {
    if (val === undefined || !activeTabPath) return;
    setOpenTabs(openTabs.map(t => {
      if (t.path === activeTabPath) return { ...t, content: val, isModified: val !== t.originalContent };
      return t;
    }));
  };

  const activeTab = openTabs.find(t => t.path === activeTabPath);
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

  // Context menus
  const handleFileRightClick = (e: React.MouseEvent, entry: FileEntry) => {
    let currentSelection = selectedPaths;
    if (!selectedPaths.includes(entry.path)) {
      currentSelection = [entry.path];
      setSelectedPaths([entry.path]);
    }
    showContextMenu(e, [
      {
        label: currentSelection.length > 1 ? `Open Selected (${currentSelection.length})` : `Open ${entry.name}`,
        icon: <File size={13} />,
        onClick: () => {
          if (entry.is_dir && currentSelection.length === 1) {
            loadDirectory(entry.path);
          } else {
            currentSelection.forEach(async (path) => {
              const fileObj = files.find(f => f.path === path);
              if (fileObj && !fileObj.is_dir) openFile(fileObj);
            });
          }
        }
      },
      { label: "", isSeparator: true },
      { label: "Rename", shortcut: "F2", disabled: currentSelection.length > 1, onClick: () => openRenameModal(entry.path) },
      {
        label: "Delete", shortcut: "Del",
        disabled: currentSelection.some(p => p.includes("composer.toml")),
        onClick: () => {
          if (confirm(`Are you sure you want to delete ${currentSelection.length} selected item(s)?`)) {
            Promise.all(currentSelection.map(path => invoke("delete_file_or_dir", { path })))
              .then(() => {
                setSelectedPaths([]);
                loadDirectory(currentDirPath);
                const remainingTabs = openTabs.filter(t => !currentSelection.includes(t.path));
                setOpenTabs(remainingTabs);
                if (activeTabPath && currentSelection.includes(activeTabPath)) {
                  setActiveTabPath(remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].path : null);
                }
              })
              .catch(err => alert(err));
          }
        }
      }
    ]);
  };

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

  // ── File type icon helper ──────────────────────────────────────
  const getFileIcon = (file: FileEntry, isSelected: boolean) => {
    const iconColor = isSelected ? "var(--accent)" : "var(--text-muted)";
    const iconProps = { size: 13, style: { color: iconColor, flexShrink: 0 } };
    if (file.is_dir)                                          return <Folder      {...iconProps} />;
    if (file.name.endsWith(".md") || file.name.endsWith(".txt")) return <FileText {...iconProps} />;
    if (file.name.match(/\.(png|jpg|jpeg|webp|gif|svg)$/i))  return <ImageIcon   {...iconProps} />;
    if (file.name.endsWith(".pdf"))                           return <FileText    {...{ ...iconProps, style: { color: "#F87171", flexShrink: 0 } }} />;
    if (file.name.match(/\.(csv|json|toml)$/i))              return <TableIcon   {...iconProps} />;
    return <FileCode {...iconProps} />;
  };

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
          {files
            .filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map(file => {
              const isSelected = selectedPaths.includes(file.path);
              return (
                <div
                  key={file.path}
                  onClick={e => {
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault();
                      setSelectedPaths(prev =>
                        prev.includes(file.path) ? prev.filter(p => p !== file.path) : [...prev, file.path]
                      );
                    } else {
                      setSelectedPaths([file.path]);
                      if (file.is_dir) loadDirectory(file.path);
                      else openFile(file);
                    }
                  }}
                  onContextMenu={e => handleFileRightClick(e, file)}
                  className={`exp-tree-item ${isSelected ? "selected" : ""}`}
                >
                  <span className="exp-tree-icon">{getFileIcon(file, isSelected)}</span>
                  <span className="exp-tree-name">{file.name}</span>
                </div>
              );
            })
          }
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
        {activeTab && (
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
                          {mode === "preview" ? <ImageIcon size={10} /> : mode === "split" ? <Columns size={10} /> : <Code size={10} />}
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
                            <table className="exp-grid-table">
                              <thead>
                                <tr>
                                  {activeTab.content.split("\n")[0]?.split(",").map((col, idx) => (
                                    <th key={idx}>{col}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {activeTab.content.split("\n").slice(1).filter(row => row.trim()).map((row, rIdx) => (
                                  <tr key={rIdx}>
                                    {row.split(",").map((cell, cIdx) => <td key={cIdx}>{cell}</td>)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
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
                        <Editor
                          height="100%"
                          defaultLanguage={
                            activeTab.fileType === "html"   ? "html" :
                            activeTab.fileType === "md"     ? "markdown" :
                            activeTab.fileType === "json"   ? "json" :
                            activeTab.fileType === "toml"   ? "ini" :
                            isSvgFile(activeTab)            ? "xml" : "typescript"
                          }
                          language={
                            activeTab.fileType === "html"   ? "html" :
                            activeTab.fileType === "md"     ? "markdown" :
                            activeTab.fileType === "json"   ? "json" :
                            activeTab.fileType === "toml"   ? "ini" :
                            isSvgFile(activeTab)            ? "xml" : "typescript"
                          }
                          theme={monacoTheme}
                          value={activeTab.content}
                          onChange={handleContentChange}
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
                      <iframe sandbox="allow-scripts" style={{ flex: 1, border: "none" }} srcDoc={activeTab.content} />
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
                              onClick={() => handleContentChange(v.content)}
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
