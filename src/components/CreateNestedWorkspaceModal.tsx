import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { FolderPlus, X, RefreshCw, GitBranch, ArrowRight } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

interface CreateNestedWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentDir: string;
  onCreated: (folderPath: string, name: string) => void;
}

export function CreateNestedWorkspaceModal({
  isOpen,
  onClose,
  parentDir,
  onCreated,
}: CreateNestedWorkspaceModalProps): React.ReactElement | null {
  const [name, setName] = useState("");
  const [promoteToWorktree, setPromoteToWorktree] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setError(null);
      setIsSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const sanitized = name.trim();
    if (!sanitized) {
      setError("Please enter a workspace name");
      return;
    }
    if (sanitized.includes("/") || sanitized.includes("\\") || sanitized === "." || sanitized === "..") {
      setError("Workspace name cannot contain path separators or traversal characters");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // 1. Create the subfolder
      const folderPath: string = await invoke("create_new_folder", {
        parentDir,
        name: sanitized,
      });

      // 2. Initialize composer.toml inside it
      const configPath = `${folderPath}/composer.toml`;
      const configContent = `[workspace]\nname = "${sanitized}"\nversion = "0.4.0"\ncreated_at = ${Date.now()}\n`;
      await invoke("write_text_file", {
        filePath: configPath,
        content: configContent,
      });

      // 3. Optionally promote to worktree immediately
      if (promoteToWorktree) {
        try {
          await invoke("create_worktree", {
            name: sanitized,
            rootPath: folderPath,
            parentWorkspaceId: "",
          });
          await emit("config_updated");
        } catch (wtErr: any) {
          console.warn("Could not auto-promote to worktree:", wtErr);
        }
      }

      onCreated(folderPath, sanitized);
      onClose();
    } catch (err: any) {
      setError(err?.toString() || "Failed to create workspace");
      setIsSubmitting(false);
    }
  };

  const previewPath = parentDir
    ? `${parentDir.replace(/\\/g, "/")}/${name.trim() || "<name>"}`
    : `<root>/${name.trim() || "<name>"}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="glass-panel w-full max-w-md flex flex-col rounded-2xl shadow-2xl relative"
        style={{
          background: "var(--bg-surface-elevated)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-dialog)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent-text, var(--accent))",
                border: "1px solid var(--border-strong)",
              }}
            >
              <FolderPlus size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)]">
                New Nested Workspace
              </h2>
              <p className="text-[11.5px] text-[var(--text-muted)] mt-0.5">
                Create an isolated workspace folder inside this project
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-nav-hover-bg)] transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4.5 px-6 py-5">
          {error && (
            <div className="p-3 rounded-lg text-xs bg-red-500/10 border border-red-500/25 text-red-400">
              {error}
            </div>
          )}

          {/* Workspace Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">
              Workspace Name
            </label>
            <input
              ref={inputRef}
              type="text"
              className="w-full px-3.5 py-2.5 rounded-xl text-xs outline-none transition-all"
              style={{
                background: "var(--bg-app)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
              placeholder="e.g. backend, mobile-app, packages/core"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              autoComplete="off"
            />
          </div>

          {/* Location Preview */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)]">Destination Directory</span>
            <div
              className="px-3 py-2 rounded-lg font-mono text-[10.5px] truncate border"
              style={{
                background: "var(--bg-app)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-muted)",
              }}
              title={previewPath}
            >
              {previewPath}
            </div>
          </div>

          {/* Promote to Worktree Checkbox */}
          <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={promoteToWorktree}
              onChange={(e) => setPromoteToWorktree(e.target.checked)}
              className="rounded accent-[var(--accent)] cursor-pointer"
            />
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <GitBranch size={13} style={{ color: "var(--accent)" }} />
              <span>Promote to Worktree immediately</span>
            </div>
          </label>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-medium border border-[var(--border-default)] hover:bg-[var(--sidebar-nav-hover-bg)] text-[var(--text-secondary)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-md disabled:opacity-50"
              style={{
                background: "var(--accent)",
                color: "#FFFFFF",
              }}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={12} className="animate-spin" />
                  <span>Creating…</span>
                </>
              ) : (
                <>
                  <span>Create Workspace</span>
                  <ArrowRight size={13} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
