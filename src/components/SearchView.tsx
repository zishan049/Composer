import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  File,
  Folder,
  FileText,
  FileCode,
  Image as ImageIcon,
  Table as TableIcon,
  X,
  CornerDownLeft,
  Filter,
} from "lucide-react";
import { SearchResult } from "../types";
import { searchWorkspace } from "../lib/api";
import { SvgFileIcon } from "./SvgFileIcon";
import { MarkdownFileIcon } from "./MarkdownFileIcon";

interface SearchViewProps {
  onOpenFile: (path: string, filename: string) => void;
  onOpenFolder?: (path: string) => void;
  workspaceName?: string;
}

export const SearchView: React.FC<SearchViewProps> = ({
  onOpenFile,
  onOpenFolder,
  workspaceName,
}) => {
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "md" | "code" | "data" | "text">("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchWorkspace(q);
        if (!isCancelled) {
          setResults(res);
          setSelectedIndex(0);
        }
      } catch (err) {
        if (!isCancelled) setResults([]);
      } finally {
        if (!isCancelled) setIsSearching(false);
      }
    }, 60);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Filter results by category
  const filteredResults = useMemo(() => {
    if (filterType === "all") return results;
    return results.filter((item) => {
      const ext = item.name.split(".").pop()?.toLowerCase() || "";
      if (filterType === "md") return ext === "md" || ext === "markdown";
      if (filterType === "code")
        return ["js", "jsx", "ts", "tsx", "rs", "py", "html", "css", "scss", "sh"].includes(ext);
      if (filterType === "data") return ["json", "toml", "csv", "yaml", "yml", "xml"].includes(ext);
      if (filterType === "text") return ext === "txt" || ext === "log" || ext === "env";
      return true;
    });
  }, [results, filterType]);

  const handleSelect = (item: SearchResult) => {
    const filename = item.name.split(/[\\\/]/).pop() || item.name;
    if (item.is_dir && onOpenFolder) {
      onOpenFolder(item.path);
    } else {
      onOpenFile(item.path, filename);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < filteredResults.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev - 1 >= 0 ? prev - 1 : filteredResults.length - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < filteredResults.length) {
        handleSelect(filteredResults[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      setQuery("");
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
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext || ""))
      return <ImageIcon {...iconProps} />;
    if (["csv", "json", "toml"].includes(ext || "")) return <TableIcon {...iconProps} />;
    if (["js", "ts", "jsx", "tsx", "html", "css", "rs", "py"].includes(ext || ""))
      return <FileCode {...iconProps} />;
    return <File {...iconProps} />;
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-app)] select-none">
      {/* Header & Search Bar */}
      <div className="p-6 pb-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
                Search Workspace
              </h1>
              <p className="text-xs text-[var(--text-muted)]">
                Deterministic local search across filenames, relative paths, and contents
                {workspaceName ? ` in ${workspaceName}` : ""}
              </p>
            </div>
            <kbd className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
              Ctrl+F
            </kbd>
          </div>

          {/* Search Input Box */}
          <div className="relative flex items-center w-full rounded-lg bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-all">
            <Search size={16} className="ml-3.5 text-[var(--text-muted)] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search by filename, folder path, or text content..."
              className="w-full px-3 py-2.5 text-xs bg-transparent border-none text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
              spellCheck={false}
              autoComplete="off"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="p-1.5 mr-2 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                title="Clear query"
              >
                <X size={14} />
              </button>
            )}
            {isSearching && (
              <span className="mr-3 text-[10px] text-[var(--text-muted)] animate-pulse">
                Searching...
              </span>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 mt-3 pt-1 text-xs">
            <span className="text-[11px] text-[var(--text-muted)] mr-1 flex items-center gap-1">
              <Filter size={11} /> Filters:
            </span>
            {[
              { id: "all", label: "All Files" },
              { id: "md", label: "Markdown" },
              { id: "code", label: "Code" },
              { id: "data", label: "Config & Data" },
              { id: "text", label: "Plain Text" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterType(tab.id as any)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  filterType === tab.id
                    ? "bg-[var(--accent)] text-[#0B0D0F]"
                    : "bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
            {filteredResults.length > 0 && (
              <span className="ml-auto text-[11px] text-[var(--text-muted)]">
                {filteredResults.length} match{filteredResults.length === 1 ? "" : "es"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Results Viewport */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {query.trim().length === 0 ? (
            <div className="p-12 text-center text-xs text-[var(--text-muted)]">
              <Search size={32} className="mx-auto mb-3 text-[var(--border-strong)]" />
              <p className="font-medium text-[var(--text-secondary)] mb-1">
                Type to start searching
              </p>
              <p className="max-w-xs mx-auto leading-relaxed">
                Matches are ranked strictly: exact filename, prefixes, substrings, paths,
                and body contents.
              </p>
            </div>
          ) : filteredResults.length > 0 ? (
            <div className="space-y-1.5">
              {filteredResults.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                const matchTypeLabel = item.match_type.replace("_", " ");
                return (
                  <div
                    key={`${item.path}-${idx}`}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`group flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-[var(--accent-soft)] border-[var(--accent)]/40"
                        : "bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-default)]"
                    }`}
                  >
                    <div className="mt-0.5">{getFileIcon(item.name, item.is_dir)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                          {item.name}
                        </span>
                        <span className="text-[9.5px] px-1.5 py-0.2 rounded font-semibold uppercase tracking-wider bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] text-[var(--accent)]">
                          {matchTypeLabel}
                        </span>
                        {item.line_number && (
                          <span className="text-[10px] text-[var(--text-muted)]">
                            Line {item.line_number}
                          </span>
                        )}
                      </div>

                      {item.snippet ? (
                        <p className="text-[11px] text-[var(--text-secondary)] font-mono bg-[var(--bg-app)]/50 p-1.5 rounded border border-[var(--border-subtle)] mt-1.5 truncate">
                          {item.snippet}
                        </p>
                      ) : (
                        <span
                          className="text-[10.5px] text-[var(--text-muted)] font-mono truncate block"
                          title={item.path}
                        >
                          {item.path}
                        </span>
                      )}
                    </div>
                    <CornerDownLeft
                      size={12}
                      className={`text-[var(--text-muted)] mt-1 transition-opacity ${
                        isSelected ? "opacity-100 text-[var(--accent)]" : "opacity-0"
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-xs text-[var(--text-muted)]">
              <p className="font-semibold text-[var(--text-secondary)] mb-1">
                No files matching "{query}"
              </p>
              <p>Check your spelling or try searching for a different keyword or path.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
