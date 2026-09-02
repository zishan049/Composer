import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { 
  Folder, File, FileText, Image as ImageIcon, Table as TableIcon, 
  Search, Plus, Save, ArrowRight, 
  RotateCw, Columns, Code, FileCode, History, Sparkles, X, ChevronRight, ChevronDown
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileEntry } from "../types";
import { useCustomContextMenu } from "./ContextMenu";
import PdfEditor from "./PdfEditor";

interface OpenTab {
  path: string;
  name: string;
  content: string;         // base64 data-url for images/pdfs, plain text otherwise
  originalContent: string;
  isModified: boolean;
  fileType: string;
  fileSize?: number;
}

export const Explorer: React.FC = () => {
  const [currentDirPath, setCurrentDirPath] = useState<string>("");
  const [sidebarWidth, setSidebarWidth] = useState<number>(256);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  // Dynamic theme resolution for Monaco Editor
  const themeInk = typeof document !== "undefined" ? document.documentElement.style.getPropertyValue("--theme-ink") || "#18140f" : "#18140f";
  const isDarkTheme = themeInk.trim() === "#ffffff" || themeInk.trim() === "#fff" || themeInk.trim().toLowerCase().startsWith("#f") || themeInk.trim().toLowerCase().startsWith("#e") || themeInk.trim().toLowerCase().startsWith("#d");
  const monacoTheme = isDarkTheme ? "vs-dark" : "vs-light";

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

    const handleMouseUp = () => {
      setIsResizing(false);
    };

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
  // expandedFolders removed — folder expand state managed implicitly
  
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string>("");
  
  // Editor & Tabs State
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  
  // Secondary views inside active tab
  const [showPreview, setShowPreview] = useState<boolean>(true);
  const [isGridView, setIsGridView] = useState<boolean>(false);
  const [aiSidebarOpen, setAiSidebarOpen] = useState<boolean>(false);
  const [aiPrompt, setAiPrompt] = useState<string>("");
  const [aiResponses, setAiResponses] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [fileVersions, setFileVersions] = useState<{version: number, timestamp: string, content: string}[]>([]);

  // Image metadata states
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

  // Custom Modal for adding files/folders or importing from system
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newItemType, setNewItemType] = useState<"file" | "folder" | "import-file" | "import-folder">("file");
  const [newItemName, setNewItemName] = useState<string>("");
  const [importQueue, setImportQueue] = useState<{ path: string; type: "file" | "folder" }[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  // Rename Modal
  const [showRenameModal, setShowRenameModal] = useState<boolean>(false);
  const [renameTargetPath, setRenameTargetPath] = useState<string>("");
  const [renameCurrentName, setRenameCurrentName] = useState<string>("");
  const [renameValue, setRenameValue] = useState<string>("");
  const [renameError, setRenameError] = useState<string>("");

  const openRenameModal = (targetPath: string) => {
    const name = targetPath.split(/[\\/]/).pop() || "";
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
  };

  const handlePickSystemFile = async () => {
    try {
      setImportError(null);
      const path = await invoke<string | null>("pick_file");
      if (path) {
        setImportQueue(prev => {
          if (prev.some(i => i.path === path)) return prev;
          return [...prev, { path, type: "file" }];
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
      const path = await invoke<string | null>("pick_directory");
      if (path) {
        setImportQueue(prev => {
          if (prev.some(i => i.path === path)) return prev;
          return [...prev, { path, type: "folder" }];
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
      if (!newItemName.trim()) {
        setImportError("Please enter a name");
        return;
      }
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
      if (importQueue.length === 0) {
        setImportError("Please select at least one file or folder to import");
        return;
      }
      try {
        await Promise.all(
          importQueue.map(item =>
            invoke("import_to_directory", { sourcePath: item.path, destDir: currentDirPath })
          )
        );
        setShowAddModal(false);
        loadDirectory(currentDirPath);
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

    // Re-root the explorer whenever the storage path is changed in Settings
    const unsub = listen("config_updated", () => loadDirectory(""));
    return () => { unsub.then(fn => fn()); };
  }, []);

  // Keyboard shortcuts local to Explorer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if focus is inside Monaco or inside input fields/textarea
      const target = e.target as HTMLElement;
      if (
        target?.closest(".monaco-editor") || 
        target?.tagName === "INPUT" || 
        target?.tagName === "TEXTAREA" || 
        target?.isContentEditable
      ) {
        return;
      }

      // Ctrl + S: Save current active tab
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActiveTab();
      }

      // Ctrl + W: Close current active tab
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeTabPath) {
          const filtered = openTabs.filter((t) => t.path !== activeTabPath);
          setOpenTabs(filtered);
          setActiveTabPath(filtered.length > 0 ? filtered[filtered.length - 1].path : null);
        }
      }

      // Ctrl + N: New File creation popup
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openNewItemModal("file");
      }

      // F2: Rename single selected item
      if (e.key === "F2") {
        e.preventDefault();
        const targetPath = selectedPaths.length === 1 ? selectedPaths[0] : activeTabPath;
        if (targetPath) openRenameModal(targetPath);
      }

      // Delete: Delete selected files/folders
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

      // Ctrl + A: Select all items in current directory
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedPaths(files.map(f => f.path));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPaths, activeTabPath, openTabs, currentDirPath, files]);

  const getFileType = (name: string): string => {
    const ext = name.split(".").pop()?.toLowerCase();
    if (!ext) return "code";
    if (["txt", "md"].includes(ext)) return ext;
    if (["html", "css", "js"].includes(ext)) return "html";
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
    if (ext === "pdf") return "pdf";
    if (["csv", "json", "toml"].includes(ext)) return ext;
    return "code";
  };

  // Open file in new tab
  const openFile = async (entry: FileEntry) => {
    const existing = openTabs.find((t) => t.path === entry.path);
    if (existing) {
      setActiveTabPath(entry.path);
      return;
    }

    const type = getFileType(entry.name);
    let content = "";
    
    if (type === "pdf" || type === "image") {
      try {
        content = await invoke<string>("read_binary_file_base64", { filePath: entry.path });
      } catch (e) {
        content = `[Failed to load file: ${e}]`;
      }
    } else {
      try {
        content = await invoke("read_text_file", { filePath: entry.path });
      } catch (e) {
        content = `[Binary content or could not read file: ${e}]`;
      }
    }

    const newTab: OpenTab = {
      path: entry.path,
      name: entry.name,
      content,
      originalContent: content,
      isModified: false,
      fileType: type,
      fileSize: entry.size,
    };

    setOpenTabs([...openTabs, newTab]);
    setActiveTabPath(entry.path);
  };

  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = openTabs.filter((t) => t.path !== path);
    setOpenTabs(filtered);
    if (activeTabPath === path) {
      setActiveTabPath(filtered.length > 0 ? filtered[filtered.length - 1].path : null);
    }
  };

  const saveActiveTab = async () => {
    const tab = openTabs.find((t) => t.path === activeTabPath);
    // PDFs are saved directly by PdfEditor component
    if (tab && tab.isModified && tab.fileType !== "pdf") {
      try {
        await invoke("write_text_file", { filePath: tab.path, content: tab.content });
        setOpenTabs(openTabs.map(t => t.path === tab.path ? { ...t, isModified: false, originalContent: t.content } : t));
        const newVersion = {
          version: fileVersions.length + 1,
          timestamp: new Date().toLocaleTimeString(),
          content: tab.content
        };
        setFileVersions([newVersion, ...fileVersions]);
      } catch (e) {
        alert("Failed to save: " + e);
      }
    }
  };

  const handleContentChange = (val: string | undefined) => {
    if (val === undefined || !activeTabPath) return;
    setOpenTabs(openTabs.map(t => {
      if (t.path === activeTabPath) {
        return { ...t, content: val, isModified: val !== t.originalContent };
      }
      return t;
    }));
  };

  const activeTab = openTabs.find((t) => t.path === activeTabPath);

  // Debounced auto-save — PDFs are handled by PdfEditor directly
  useEffect(() => {
    if (!activeTab || !activeTab.isModified || activeTab.fileType === "pdf") return;

    const timer = setTimeout(async () => {
      try {
        await invoke("write_text_file", { filePath: activeTab.path, content: activeTab.content });
        setOpenTabs(prev => prev.map(t => 
          t.path === activeTab.path 
            ? { ...t, isModified: false, originalContent: activeTab.content } 
            : t
        ));
      } catch (e) {
        console.error("Auto-save failed:", e);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [activeTab?.content, activeTab?.path, activeTab?.isModified]);

  // File tree right click menu
  const handleFileRightClick = (e: React.MouseEvent, entry: FileEntry) => {
    // If the right-clicked item is not already in the selection list, make it the only selected item
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
            // Open all selected files
            currentSelection.forEach(async (path) => {
              const fileObj = files.find(f => f.path === path);
              if (fileObj && !fileObj.is_dir) {
                openFile(fileObj);
              }
            });
          }
        } 
      },
      { label: "", isSeparator: true },
      { 
        label: "Scan with AI", 
        icon: <Sparkles size={13} />, 
        onClick: async () => {
          try {
            const results = await Promise.all(currentSelection.map(path => invoke<string>("scan_and_index_document", { filePath: path })));
            alert(results.join("\n"));
          } catch(err) { alert(err); }
        }
      },
      { 
        label: "Summarize File", 
        onClick: () => {
          setAiSidebarOpen(true);
          const names = currentSelection.map(p => p.split(/[\\/]/).pop()).join(", ");
          setAiResponses([`Synthesizing context summary for selected files: ${names}...`, ...aiResponses]);
        }
      },
      { label: "", isSeparator: true },
      { 
        label: "Rename", 
        shortcut: "F2", 
        disabled: currentSelection.length > 1,
        onClick: () => openRenameModal(entry.path)
      },
      { 
        label: "Delete", 
        shortcut: "Del", 
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

  // Folder sidebar context menu
  const handleSidebarBlankRightClick = (e: React.MouseEvent) => {
    showContextMenu(e, [
      { label: "New File", icon: <Plus size={13} />, shortcut: "Ctrl+N", onClick: () => openNewItemModal("file") },
      { label: "New Folder", icon: <Folder size={13} />, onClick: () => openNewItemModal("folder") },
      { label: "", isSeparator: true },
      { label: "Refresh List", icon: <RotateCw size={13} />, onClick: () => loadDirectory(currentDirPath) }
    ]);
  };

  // AI drawer prompt execution
  const askAIAboutFile = () => {
    if (!aiPrompt.trim() || !activeTab) return;
    const userPrompt = aiPrompt;
    setAiPrompt("");
    setAiResponses(prev => [
      `User: ${userPrompt}`,
      `Composer AI: Refactoring code elements for '${activeTab.name}' based on local editorial rules. Analyzed 2 structure layers.\n\n\`\`\`typescript\n// Suggested Editorial Refactoring\nexport const CleanWidget = () => {\n  return (\n    <div className="border-b double-rule-bottom py-4">\n      <span className="kicker">Synthesized Suggestion</span>\n      <p className="font-serif text-ink">Breathe before it speaks.</p>\n    </div>\n  );\n};\n\`\`\``,
      ...prev
    ]);
  };

  return (
    <div id="explorer-parent-container" className="flex h-full font-serif-text text-ink bg-paper">
      {/* File Tree Left Sidebar */}
      <div 
        id="explorer-sidebar-container"
        className="flex flex-col h-full bg-cream/30 select-none divide-y divide-rule shrink-0"
        style={{ width: `${sidebarWidth}px` }}
        onContextMenu={handleSidebarBlankRightClick}
      >
        <div className="p-3.5 flex items-center justify-between">
          <span className="kicker">Explorer</span>
          <button 
            onClick={() => openNewItemModal("file")}
            className="p-1 hover:bg-cream text-accent transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Directory Navigator Path indicator */}
        <div className="px-3.5 py-2 font-sans-meta text-[10px] text-muted truncate border-b border-light-rule flex items-center gap-1.5 bg-paper" title={currentDirPath}>
          <span className="cursor-pointer hover:underline font-bold text-accent" onClick={() => loadDirectory("")}>Workspace</span>
          <ChevronRight size={10} />
          <span className="truncate font-semibold">{currentDirPath ? currentDirPath.split(/[\\/]/).pop() : "Root"}</span>
        </div>

        {/* Search */}
        <div className="p-2 flex items-center gap-1.5 bg-paper/50">
          <Search size={12} className="text-muted" />
          <input
            id="explorer-search-input"
            type="text"
            placeholder="Filter files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-[11px] font-sans-meta outline-none placeholder-muted/60"
          />
        </div>

        {/* File List */}
        <div 
          id="explorer-sidebar-scroll-container"
          className="flex-1 overflow-y-auto p-1.5 space-y-0.5 font-sans-meta text-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedPaths([]);
            }
          }}
        >
          {currentDirPath !== workspaceRootPath && currentDirPath !== "" && currentDirPath !== "/" && (
            <div 
              onClick={() => {
                const lastSep = Math.max(currentDirPath.lastIndexOf("\\"), currentDirPath.lastIndexOf("/"));
                const parent = lastSep !== -1 ? currentDirPath.substring(0, lastSep) : "";
                if (!parent || parent.length < workspaceRootPath.length) {
                  loadDirectory("");
                } else {
                  loadDirectory(parent);
                }
              }}
              className="px-2.5 py-1.5 hover:bg-cream rounded-sm text-muted cursor-pointer flex items-center gap-2"
            >
              <ChevronDown size={12} className="rotate-90" />
              <span>.. [Up Directory]</span>
            </div>
          )}

          {files
            .filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((file) => {
              const isSelected = selectedPaths.includes(file.path);
              return (
                <div
                  key={file.path}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault();
                      setSelectedPaths(prev => {
                        if (prev.includes(file.path)) {
                          return prev.filter(p => p !== file.path);
                        } else {
                          return [...prev, file.path];
                        }
                      });
                    } else {
                      setSelectedPaths([file.path]);
                      if (file.is_dir) {
                        loadDirectory(file.path);
                      } else {
                        openFile(file);
                      }
                    }
                  }}
                  onContextMenu={(e) => handleFileRightClick(e, file)}
                  className={`group px-2.5 py-1.5 rounded-sm cursor-pointer flex items-center justify-between transition-colors
                    ${isSelected 
                      ? "bg-cream text-accent font-semibold border-l-2 border-accent pl-1.5" 
                      : "hover:bg-cream/70 text-ink/80"}`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {file.is_dir ? (
                      <Folder size={14} className="text-muted group-hover:text-accent" />
                    ) : file.name.endsWith(".md") || file.name.endsWith(".txt") ? (
                      <FileText size={14} className="text-muted/70 group-hover:text-accent/70" />
                    ) : file.name.match(/\.(png|jpg|jpeg|webp|gif)$/i) ? (
                      <ImageIcon size={14} className="text-muted/70 group-hover:text-accent/70" />
                    ) : file.name.endsWith(".pdf") ? (
                      <FileText size={14} className="text-red-700/80 group-hover:text-red-700" />
                    ) : file.name.match(/\.(csv|json|toml)$/i) ? (
                      <TableIcon size={14} className="text-muted/70 group-hover:text-accent/70" />
                    ) : (
                      <FileCode size={14} className="text-muted/70 group-hover:text-accent/70" />
                    )}
                    <span className="truncate">{file.name}</span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Resizer Divider */}
      <div
        onMouseDown={startResizing}
        className={`w-1 cursor-col-resize hover:bg-accent/50 active:bg-accent transition-colors h-full select-none z-30 shrink-0 border-l border-rule ${
          isResizing ? "bg-accent border-accent" : "bg-transparent"
        }`}
        style={{
          marginLeft: "-2px",
          marginRight: "-2px",
        }}
      />

      {/* Editor Panel Right */}
      <div 
        className="flex-1 flex flex-col h-full bg-paper divide-y divide-rule overflow-hidden"
        onContextMenu={(e) => {
          if (openTabs.length === 0) {
            handleSidebarBlankRightClick(e);
          }
        }}
      >
        {/* Tabs Bar */}
        {openTabs.length > 0 ? (
          <div className="flex bg-cream/15 border-b border-rule select-none overflow-x-auto divide-x divide-rule">
            {openTabs.map((tab) => (
              <div
                key={tab.path}
                onClick={() => setActiveTabPath(tab.path)}
                className={`px-4 py-2 text-xs font-sans-meta cursor-pointer flex items-center gap-2 border-t-2 transition-all
                  ${activeTabPath === tab.path 
                    ? "bg-paper border-accent text-ink font-semibold" 
                    : "border-transparent text-muted hover:bg-cream/40"
                  }`}
              >
                <span>{tab.name}</span>
                {tab.isModified && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
                <X 
                  size={10} 
                  className="hover:text-accent text-muted/60 transition-colors ml-1"
                  onClick={(e) => closeTab(tab.path, e)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted/50 select-none">
            <span className="font-serif-display text-4xl italic font-bold text-cream mb-4">Composer</span>
            <p className="font-sans-meta text-xs tracking-wider max-w-sm">
              Double-click a file in the tree to edit or scan, or right-click to schedule local tasks.
            </p>
          </div>
        )}

        {/* Tab Content Display */}
        {activeTab && (
          <div className="flex-1 flex overflow-hidden">
            {/* Editor Workspace Column */}
            <div className="flex-1 flex flex-col h-full overflow-hidden divide-y divide-rule">
              {/* Toolstrip */}
              <div className="px-4 py-2 bg-cream/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-sans-meta text-xs font-semibold text-accent uppercase tracking-wider">{activeTab.fileType} mode</span>
                  {activeTab.isModified && (
                    <button 
                      onClick={saveActiveTab}
                      className="px-2.5 py-0.5 bg-accent hover:bg-accent/90 text-paper font-sans-meta text-[10px] uppercase font-semibold transition-all flex items-center gap-1.5"
                    >
                      <Save size={10} />
                      <span>Save (Modified)</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setAiSidebarOpen(!aiSidebarOpen)}
                    className={`p-1.5 rounded-sm hover:bg-cream transition-colors text-muted flex items-center gap-1 font-sans-meta text-[10px] uppercase font-semibold
                      ${aiSidebarOpen ? "text-accent bg-cream" : ""}`}
                  >
                    <Sparkles size={12} />
                    <span>Ask AI</span>
                  </button>

                  <button 
                    onClick={() => {
                      setShowHistory(!showHistory);
                      if (fileVersions.length === 0) {
                        setFileVersions([
                          { version: 1, timestamp: "Initial Open", content: activeTab.content }
                        ]);
                      }
                    }}
                    className={`p-1.5 rounded-sm hover:bg-cream transition-colors text-muted flex items-center gap-1 font-sans-meta text-[10px] uppercase font-semibold
                      ${showHistory ? "text-accent bg-cream" : ""}`}
                  >
                    <History size={12} />
                    <span>Versions</span>
                  </button>

                  {/* Markdown / HTML specific toggle */}
                  {["md", "html"].includes(activeTab.fileType) && (
                    <button
                      onClick={() => setShowPreview(!showPreview)}
                      className={`p-1.5 rounded-sm hover:bg-cream transition-colors text-muted flex items-center gap-1 font-sans-meta text-[10px] uppercase font-semibold
                        ${showPreview ? "text-accent bg-cream" : ""}`}
                    >
                      <Columns size={12} />
                      <span>Split Preview</span>
                    </button>
                  )}

                  {/* PDF specific edit toggle */}
                  {activeTab.fileType === "pdf" && (
                    <button
                      onClick={() => setIsPdfEditMode(!isPdfEditMode)}
                      className={`p-1.5 rounded-sm hover:bg-cream transition-colors text-muted flex items-center gap-1 font-sans-meta text-[10px] uppercase font-semibold
                        ${isPdfEditMode ? "text-accent bg-cream" : ""}`}
                    >
                      <Code size={12} />
                      <span>{isPdfEditMode ? "View PDF" : "Edit Text"}</span>
                    </button>
                  )}

                  {/* CSV / TOML / JSON Specific grid toggle */}
                  {["csv", "toml", "json"].includes(activeTab.fileType) && (
                    <button
                      onClick={() => setIsGridView(!isGridView)}
                      className={`p-1.5 rounded-sm hover:bg-cream transition-colors text-muted flex items-center gap-1 font-sans-meta text-[10px] uppercase font-semibold
                        ${isGridView ? "text-accent bg-cream" : ""}`}
                    >
                      {isGridView ? <Code size={12} /> : <TableIcon size={12} />}
                      <span>{isGridView ? "Raw Text" : "Grid Table"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Main Workspace Frame */}
              <div className="flex-1 flex overflow-hidden divide-x divide-rule">
                {/* Editor container */}
                <div className="flex-1 h-full overflow-hidden relative custom-editor-container">
                  {isGridView ? (
                    <div className="w-full h-full overflow-auto p-4 bg-paper font-sans-meta text-xs">
                      {activeTab.fileType === "csv" ? (
                        <table className="w-full border-collapse border border-rule text-left">
                          <thead>
                            <tr className="bg-cream">
                              {activeTab.content.split("\n")[0]?.split(",").map((col, idx) => (
                                <th key={idx} className="border border-rule px-3 py-1.5 font-bold uppercase">{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {activeTab.content.split("\n").slice(1).filter(row => row.trim()).map((row, rIdx) => (
                              <tr key={rIdx} className="hover:bg-cream/40">
                                {row.split(",").map((cell, cIdx) => (
                                  <td key={cIdx} className="border border-rule px-3 py-1">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="p-4 bg-cream/15 border border-rule rounded-sm font-mono text-[11px] text-ink/80 whitespace-pre-wrap leading-loose">
                          {activeTab.content}
                        </div>
                      )}
                    </div>
                  ) : activeTab.fileType === "image" ? (
                    <div className="w-full h-full overflow-auto bg-cream/15 p-6 flex items-center justify-center">
                      <div className="border border-rule p-4 bg-paper shadow-lg max-w-3xl flex flex-col items-center rounded-md transition-all">
                        <img 
                          src={activeTab.content} 
                          alt={activeTab.name}
                          className="max-h-[60vh] object-contain rounded-sm border border-light-rule shadow-sm" 
                          onLoad={(e) => {
                            const img = e.currentTarget;
                            setImageDimensions(prev => ({
                              ...prev,
                              [activeTab.path]: {
                                width: img.naturalWidth,
                                height: img.naturalHeight
                              }
                            }));
                          }}
                        />
                        <div className="font-sans-meta text-[11px] text-muted self-start border-t border-light-rule pt-3 mt-4 w-full grid grid-cols-2 gap-x-6 gap-y-2">
                          <div className="flex justify-between border-b border-light-rule/40 pb-1">
                            <span className="font-semibold text-accent uppercase text-[9px]">File Name</span>
                            <span className="text-ink truncate max-w-[180px]" title={activeTab.name}>{activeTab.name}</span>
                          </div>
                          <div className="flex justify-between border-b border-light-rule/40 pb-1">
                            <span className="font-semibold text-accent uppercase text-[9px]">Resolution</span>
                            <span className="text-ink font-mono font-semibold">
                              {imageDimensions[activeTab.path] 
                                ? `${imageDimensions[activeTab.path].width} × ${imageDimensions[activeTab.path].height} px` 
                                : "Detecting..."}
                            </span>
                          </div>
                          <div className="flex justify-between border-b border-light-rule/40 pb-1">
                            <span className="font-semibold text-accent uppercase text-[9px]">File Size</span>
                            <span className="text-ink font-mono font-semibold">{formatFileSize(activeTab.fileSize)}</span>
                          </div>
                          <div className="flex justify-between border-b border-light-rule/40 pb-1">
                            <span className="font-semibold text-accent uppercase text-[9px]">File Path</span>
                            <span className="text-ink truncate max-w-[180px]" title={activeTab.path}>{activeTab.path}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : activeTab.fileType === "pdf" ? (
                    <PdfEditor
                      filePath={activeTab.path}
                      base64DataUrl={activeTab.content}
                      onSaved={(newDataUrl) => {
                        setOpenTabs(prev => prev.map(t =>
                          t.path === activeTab.path
                            ? { ...t, content: newDataUrl, originalContent: newDataUrl, isModified: false }
                            : t
                        ));
                      }}
                    />
                  ) : (
                    <Editor
                      height="100%"
                      defaultLanguage={
                        activeTab.fileType === "html" ? "html" :
                        activeTab.fileType === "md" ? "markdown" :
                        activeTab.fileType === "json" ? "json" :
                        activeTab.fileType === "toml" ? "ini" : "typescript"
                      }
                      theme={monacoTheme}
                      value={activeTab.content}
                      onChange={handleContentChange}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        fontFamily: "EB Garamond, Georgia, serif",
                        lineHeight: 1.5,
                        tabSize: 4,
                        wordWrap: "on",
                        scrollbar: {
                          verticalScrollbarSize: 6,
                          horizontalScrollbarSize: 6
                        }
                      }}
                    />
                  )}
                </div>

                {/* HTML/Markdown Side Preview Pane */}
                {showPreview && ["md", "html"].includes(activeTab.fileType) && (
                  <div className="w-1/2 h-full overflow-y-auto bg-paper flex flex-col">
                    <div className="px-3.5 py-1.5 bg-cream/10 border-b border-rule flex items-center justify-between font-sans-meta text-[10px] uppercase text-muted font-bold">
                      <span>Live sandboxed preview</span>
                      {activeTab.fileType === "html" && (
                        <div className="flex items-center gap-2">
                          <button className="hover:text-accent flex items-center gap-1">
                            <RotateCw size={10} /> Reload
                          </button>
                          <button className="hover:text-accent">Inspect</button>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 p-6 font-serif-text text-ink bg-paper overflow-auto select-text prose leading-relaxed">
                      {activeTab.fileType === "md" ? (
                        <div>
                          <span className="kicker">Markdown Preview</span>
                          <h1 className="font-serif-display text-2xl font-bold tracking-tight border-b border-light-rule pb-2 mb-4 mt-2">
                            {activeTab.name.replace(".md", "")}
                          </h1>
                          <p className="drop-cap text-base leading-loose whitespace-pre-wrap">{activeTab.content}</p>
                        </div>
                      ) : (
                        <iframe
                          sandbox="allow-scripts"
                          className="w-full h-full border-none"
                          srcDoc={activeTab.content}
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Versions snapshot sidebar */}
                {showHistory && (
                  <div className="w-64 h-full bg-cream/15 overflow-y-auto divide-y divide-rule flex flex-col font-sans-meta">
                    <div className="p-3 bg-cream/35 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider font-bold">Version history</span>
                      <button onClick={() => setShowHistory(false)}><X size={12} /></button>
                    </div>
                    {fileVersions.map((v) => (
                      <div key={v.version} className="p-3.5 hover:bg-cream/40 cursor-pointer flex flex-col gap-1.5 transition-colors">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-accent">v{v.version}</span>
                          <span className="text-muted text-[10px]">{v.timestamp}</span>
                        </div>
                        <button 
                          onClick={() => handleContentChange(v.content)}
                          className="self-start text-[9px] uppercase border border-accent/30 text-accent font-semibold px-2 py-0.5 hover:bg-accent hover:text-paper transition-all"
                        >
                          Restore Version
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* AI Refactor Panel */}
                {aiSidebarOpen && (
                  <div className="w-80 h-full bg-paper border-l border-rule overflow-hidden flex flex-col font-sans-meta">
                    <div className="p-3.5 bg-cream/30 border-b border-rule flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-accent flex items-center gap-1.5">
                        <Sparkles size={12} />
                        <span>AI Document Copilot</span>
                      </span>
                      <button onClick={() => setAiSidebarOpen(false)}><X size={12} /></button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs select-text">
                      <div className="p-3 bg-cream/20 border border-light-rule rounded-sm leading-relaxed">
                        Hi! I can suggest refactorings, summaries, or answer questions specifically about <strong>{activeTab.name}</strong>.
                      </div>

                      {aiResponses.map((res, i) => (
                        <div 
                          key={i} 
                          className={`p-3 rounded-sm border whitespace-pre-wrap leading-relaxed
                            ${res.startsWith("User:") 
                              ? "bg-cream/40 border-rule/50 self-end" 
                              : "bg-paper border-light-rule"
                            }`}
                        >
                          {res}
                        </div>
                      ))}
                    </div>

                    <div className="p-3 bg-cream/20 border-t border-rule flex gap-2">
                      <textarea
                        rows={2}
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="Ask about active file..."
                        className="flex-1 bg-paper border border-rule/50 rounded-sm p-1.5 text-xs outline-none focus:border-accent resize-none font-sans-meta"
                      />
                      <button 
                        onClick={askAIAboutFile}
                        className="px-3 bg-ink hover:bg-accent text-paper transition-all flex items-center justify-center rounded-sm"
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
          <div className="bg-paper border-2 border-rule rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4 animate-in duration-200 text-ink">
            <div className="flex items-center justify-between border-b border-rule/35 pb-2.5">
              <div className="flex items-center gap-2 text-accent">
                <Plus size={16} />
                <span className="font-serif-display font-bold text-base italic">
                  Create / Import Item
                </span>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="p-1 hover:bg-cream rounded-sm text-muted hover:text-ink transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {/* Type/Action Selector: 2x2 Grid */}
            <div className="flex flex-col gap-1.5">
              <label className="font-bold text-[9px] uppercase tracking-wider text-muted">Action & Type</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNewItemType("file");
                    setImportError(null);
                    setImportQueue([]);
                  }}
                  className={`py-2 border rounded-md font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-200 ${
                    newItemType === "file"
                      ? "bg-accent/10 border-accent text-accent font-bold"
                      : "border-rule bg-paper hover:bg-cream/45 text-muted"
                  }`}
                >
                  <File size={13} />
                  New File
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewItemType("folder");
                    setImportError(null);
                    setImportQueue([]);
                  }}
                  className={`py-2 border rounded-md font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-200 ${
                    newItemType === "folder"
                      ? "bg-accent/10 border-accent text-accent font-bold"
                      : "border-rule bg-paper hover:bg-cream/45 text-muted"
                  }`}
                >
                  <Folder size={13} />
                  New Folder
                </button>
                <button
                  type="button"
                  onClick={handlePickSystemFile}
                  className={`py-2 border rounded-md font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-200 ${
                    newItemType === "import-file"
                      ? "bg-accent/10 border-accent text-accent font-bold"
                      : "border-rule bg-paper hover:bg-cream/45 text-muted"
                  }`}
                >
                  <File size={13} className="text-accent" />
                  Import File
                </button>
                <button
                  type="button"
                  onClick={handlePickSystemFolder}
                  className={`py-2 border rounded-md font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-200 ${
                    newItemType === "import-folder"
                      ? "bg-accent/10 border-accent text-accent font-bold"
                      : "border-rule bg-paper hover:bg-cream/45 text-muted"
                  }`}
                >
                  <Folder size={13} className="text-accent" />
                  Import Folder
                </button>
              </div>
            </div>

            {/* Import Queue List (shown when in import mode and queue has items) */}
            {(newItemType === "import-file" || newItemType === "import-folder") && importQueue.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-[9px] uppercase tracking-wider text-muted">
                    Import Queue — {importQueue.length} item{importQueue.length !== 1 ? "s" : ""}
                  </label>
                  <button
                    type="button"
                    onClick={() => setImportQueue([])}
                    className="text-[9px] font-bold uppercase text-muted hover:text-accent transition-colors cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 pr-0.5">
                  {importQueue.map((item, idx) => (
                    <div
                      key={item.path}
                      className="flex items-center gap-2 p-1.5 border border-rule/50 rounded-md bg-cream/25 group"
                    >
                      <span className="shrink-0 text-muted">
                        {item.type === "folder" ? <Folder size={11} /> : <File size={11} />}
                      </span>
                      <span className="flex-1 font-mono text-[10px] text-ink truncate" title={item.path}>
                        {item.path.split(/[\\/]/).pop()}
                      </span>
                      <span className="text-[9px] text-muted/60 truncate max-w-[80px] hidden group-hover:block font-sans-meta">
                        {item.path.split(/[\\/]/).slice(-2, -1)[0]}
                      </span>
                      <button
                        type="button"
                        onClick={() => setImportQueue(prev => prev.filter((_, i) => i !== idx))}
                        className="shrink-0 p-0.5 hover:bg-accent/15 hover:text-accent text-muted rounded-sm transition-colors cursor-pointer"
                        title="Remove from queue"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Name Input — only shown for new file/folder creation */}
            {!newItemType.startsWith("import") && (
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-[9px] uppercase tracking-wider text-muted">
                  {newItemType.includes("folder") ? "Folder Name" : "File Name"}
                </label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => {
                    setNewItemName(e.target.value);
                    setImportError(null);
                  }}
                  placeholder={newItemType.includes("folder") ? "e.g. components, utils" : "e.g. index.css, app.js"}
                  className="w-full p-2 border border-rule rounded-md bg-cream/10 outline-none text-xs focus:border-accent font-sans-meta text-ink placeholder:text-muted/50 font-semibold"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateOrImport();
                  }}
                />
              </div>
            )}

            {/* Error Message */}
            {importError && (
              <div className="p-2 bg-accent/10 border border-accent/25 text-[10px] text-accent font-semibold rounded-sm leading-normal">
                ⚠ {importError}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-rule/20">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-3.5 py-1.5 border border-rule/75 hover:border-rule text-muted hover:text-ink font-bold text-[10px] uppercase rounded-md cursor-pointer transition-all duration-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateOrImport}
                className="px-4 py-1.5 bg-ink hover:bg-accent text-paper font-bold text-[10px] uppercase rounded-md cursor-pointer transition-all duration-200 flex items-center gap-1 active-accent-glow"
              >
                {newItemType.startsWith("import")
                  ? importQueue.length > 1 ? `Import ${importQueue.length} Items` : "Import"
                  : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
          <div className="bg-paper border-2 border-rule rounded-xl shadow-2xl max-w-xs w-full p-6 space-y-4 animate-in zoom-in-95 duration-200 text-ink">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-rule/35 pb-2.5">
              <div className="flex items-center gap-2 text-accent">
                <FileText size={16} />
                <span className="font-serif-display font-bold text-base italic">Rename</span>
              </div>
              <button
                onClick={() => setShowRenameModal(false)}
                className="p-1 hover:bg-cream rounded-sm text-muted hover:text-ink transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {/* Current name hint */}
            <div className="text-[10px] text-muted font-sans-meta">
              Renaming: <span className="font-mono font-bold text-ink">{renameCurrentName}</span>
            </div>

            {/* Input */}
            <div className="flex flex-col gap-1.5">
              <label className="font-bold text-[9px] uppercase tracking-wider text-muted">New Name</label>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => { setRenameValue(e.target.value); setRenameError(""); }}
                className="w-full p-2 border border-rule rounded-md bg-cream/10 outline-none text-xs focus:border-accent font-sans-meta text-ink placeholder:text-muted/50 font-semibold"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameConfirm();
                  if (e.key === "Escape") setShowRenameModal(false);
                }}
              />
            </div>

            {/* Error */}
            {renameError && (
              <div className="p-2 bg-accent/10 border border-accent/25 text-[10px] text-accent font-semibold rounded-sm leading-normal">
                ⚠ {renameError}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-rule/20">
              <button
                type="button"
                onClick={() => setShowRenameModal(false)}
                className="px-3.5 py-1.5 border border-rule/75 hover:border-rule text-muted hover:text-ink font-bold text-[10px] uppercase rounded-md cursor-pointer transition-all duration-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenameConfirm}
                className="px-4 py-1.5 bg-ink hover:bg-accent text-paper font-bold text-[10px] uppercase rounded-md cursor-pointer transition-all duration-200 flex items-center gap-1 active-accent-glow"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {ContextMenuComponent}
    </div>
  );
};
