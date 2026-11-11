import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  FolderOpen,
  Plus,
  GitBranch,
  ChevronDown,
  Pencil,
  Trash2,
  ExternalLink,
  Check,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { WorktreeMetadata, WorktreeId } from "../types";
import { useWorktrees, CreateWorktreeArgs } from "../lib/WorktreeContext";
import { pickDirectory, openInFileManager } from "../lib/api";
import { formatRelativeTime } from "../utils/recentFiles";

// ── Worktree Creation Dialog ───────────────────────────────────

interface CreateWorktreeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspacePath: string;
  workspaceId: string;
}

export function CreateWorktreeDialog({
  isOpen,
  onClose,
  workspacePath,
  workspaceId,
}: CreateWorktreeDialogProps): React.ReactElement | null {
  const { createWorktree } = useWorktrees();
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState(workspacePath);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setRootPath(workspacePath);
      setError(null);
      setTimeout(() => nameRef.current?.focus(), 60);
    }
  }, [isOpen, workspacePath]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  const handlePickDir = async () => {
    const picked = await pickDirectory();
    if (picked) setRootPath(picked);
  };

  const validate = (): string | null => {
    const n = name.trim();
    if (!n) return "Worktree name cannot be empty.";
    if (n.length > 80) return "Name must be 80 characters or fewer.";
    if (/[<>:"/\\|?*\x00-\x1F]/.test(n))
      return "Name contains invalid characters.";
    if (!rootPath.trim()) return "Please choose a directory.";
    return null;
  };

  const handleCreate = async () => {
    const err = validate();
    if (err) { setError(err); return; }

    setIsCreating(true);
    setError(null);
    try {
      const args: CreateWorktreeArgs = {
        name: name.trim(),
        root_path: rootPath.trim(),
        parent_workspace_id: workspaceId,
      };
      await createWorktree(args);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-md flex flex-col rounded-2xl overflow-hidden glass-card border border-[var(--border-strong)] shadow-2xl animate-in zoom-in-95 duration-150"
        style={{
          background: "var(--bg-surface-elevated)",
        }}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-wt-title"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-lg"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              <GitBranch size={15} />
            </div>
            <div>
              <h2
                id="create-wt-title"
                style={{
                  fontSize: "var(--font-size-md)",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                }}
              >
                New Worktree
              </h2>
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)", marginTop: 2 }}>
                Create a named workspace inside this project
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-5 py-5">
          {/* Name field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="wt-name"
              style={{
                fontSize: "var(--font-size-sm)",
                fontWeight: 600,
                color: "var(--text-secondary)",
              }}
            >
              Worktree Name
            </label>
            <input
              id="wt-name"
              ref={nameRef}
              className="input"
              placeholder="e.g. Website Redesign, Mobile App…"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              maxLength={80}
              autoComplete="off"
            />
          </div>

          {/* Directory field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="wt-root"
              style={{
                fontSize: "var(--font-size-sm)",
                fontWeight: 600,
                color: "var(--text-secondary)",
              }}
            >
              Directory
            </label>
            <div className="flex gap-2">
              <input
                id="wt-root"
                className="input flex-1 font-mono"
                style={{ fontSize: "var(--font-size-sm)" }}
                placeholder="/path/to/directory"
                value={rootPath}
                onChange={(e) => { setRootPath(e.target.value); setError(null); }}
                autoComplete="off"
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={handlePickDir}
                title="Browse…"
                type="button"
              >
                <FolderOpen size={13} />
              </button>
            </div>
            <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              The directory where this worktree's files will live. Defaults to the
              parent workspace, but can be any accessible folder.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div
              className="flex items-start gap-2 rounded-lg px-3 py-2.5"
              style={{
                background: "rgba(248,113,113,0.10)",
                border: "1px solid rgba(248,113,113,0.25)",
              }}
            >
              <AlertTriangle size={13} style={{ color: "var(--color-danger)", marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-danger)", lineHeight: 1.5 }}>
                {error}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-4"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <button className="btn btn-ghost btn-sm" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleCreate}
            disabled={isCreating || !name.trim()}
            type="button"
          >
            {isCreating ? (
              <>
                <RefreshCw size={12} className="animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Plus size={13} />
                Create Worktree
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Worktree Switcher Panel (embedded in sidebar) ──────────────

interface WorktreeSwitcherProps {
  workspacePath: string;
  workspaceId: string;
}

export function WorktreeSwitcher({
  workspacePath,
  workspaceId,
}: WorktreeSwitcherProps): React.ReactElement {
  const {
    worktrees,
    activeWorktreeId,
    activeWorktree,
    isLoading,
    switchWorktree,
    renameWorktree,
    removeWorktree,
  } = useWorktrees();

  const [isExpanded, setIsExpanded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [renamingId, setRenamingId] = useState<WorktreeId | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<WorktreeId | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);

  const activeName = activeWorktree?.name ?? "Main";

  // Dismiss worktree dropdown on outside click or Escape key
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
        setRenamingId(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsExpanded(false);
        setRenamingId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isExpanded]);

  // Wire global event: open Create dialog from context menu / Home quick action
  useEffect(() => {
    const handler = () => { setShowCreate(true); setIsExpanded(false); };
    window.addEventListener("composer:worktree-open-create", handler);
    return () => window.removeEventListener("composer:worktree-open-create", handler);
  }, []);

  const handleSwitch = async (id: WorktreeId | null) => {
    setIsExpanded(false);
    await switchWorktree(id);
  };

  const startRename = (wt: WorktreeMetadata) => {
    setRenamingId(wt.id);
    setRenameValue(wt.name);
    setTimeout(() => renameInputRef.current?.focus(), 60);
  };

  const confirmRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    try {
      await renameWorktree({ worktree_id: renamingId, new_name: renameValue.trim() });
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    setRenamingId(null);
  };

  const handleDelete = async (id: WorktreeId) => {
    try {
      // Never delete files — only remove metadata association
      await removeWorktree(id, false);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    setConfirmDeleteId(null);
  };

  if (!workspacePath || worktrees.length === 0) {
    // Show minimal add-first-worktree button
    return (
      <>
        <div className="c2-worktree-bar">
          <button
            className="c2-worktree-selector"
            onClick={() => setShowCreate(true)}
            title="Add a worktree to this workspace"
          >
            <Plus size={13} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <span className="c2-worktree-name">Add worktree…</span>
          </button>
        </div>
        <CreateWorktreeDialog
          isOpen={showCreate}
          onClose={() => setShowCreate(false)}
          workspacePath={workspacePath}
          workspaceId={workspaceId}
        />
      </>
    );
  }

  return (
    <>
      {/* Active worktree pill */}
      <div ref={switcherRef} className="c2-worktree-bar relative inline-flex">
        <button
          className="c2-worktree-selector"
          onClick={() => setIsExpanded(prev => !prev)}
          title="Switch worktree"
        >
          <span className="c2-worktree-dot" />
          <span className="c2-worktree-name">{activeName}</span>
          <ChevronDown
            size={10}
            style={{
              color: "var(--accent)",
              flexShrink: 0,
              transform: isExpanded ? "rotate(180deg)" : undefined,
              transition: "transform 150ms",
            }}
          />
        </button>

        {/* Dropdown */}
        {isExpanded && (
          <div
            className="absolute z-50 left-0 mt-1 min-w-[200px] rounded-lg overflow-hidden"
            style={{
              background: "var(--bg-surface-elevated)",
              border: "1px solid var(--border-strong)",
              boxShadow: "var(--shadow-md)",
              top: "calc(100% + 2px)",
            }}
          >
            {/* Main option */}
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--sidebar-nav-hover-bg)] transition-colors"
              onClick={() => handleSwitch(null)}
            >
              {activeWorktreeId === null && (
                <Check size={11} style={{ color: "var(--accent)", flexShrink: 0 }} />
              )}
              {activeWorktreeId !== null && (
                <span style={{ width: 11, flexShrink: 0 }} />
              )}
              <span
                style={{
                  fontSize: "var(--font-size-sm)",
                  fontWeight: activeWorktreeId === null ? 600 : 400,
                  color: activeWorktreeId === null ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                Main
              </span>
              {activeWorktreeId === null && (
                <span className="badge badge-accent ml-auto">active</span>
              )}
            </button>

            {/* Worktrees */}
            {worktrees.map(wt => (
              <div key={wt.id} className="relative group">
                {renamingId === wt.id ? (
                  <div className="flex items-center gap-1 px-3 py-1.5">
                    <input
                      ref={renameInputRef}
                      className="input input-sm flex-1"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") confirmRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                    <button className="btn btn-primary btn-icon btn-sm" onClick={confirmRename}>
                      <Check size={11} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--sidebar-nav-hover-bg)] transition-colors"
                    onClick={() => handleSwitch(wt.id)}
                  >
                    {activeWorktreeId === wt.id && (
                      <Check size={11} style={{ color: "var(--accent)", flexShrink: 0 }} />
                    )}
                    {activeWorktreeId !== wt.id && (
                      <span style={{ width: 11, flexShrink: 0 }} />
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span
                        style={{
                          fontSize: "var(--font-size-sm)",
                          fontWeight: activeWorktreeId === wt.id ? 600 : 400,
                          color: activeWorktreeId === wt.id ? "var(--text-primary)" : "var(--text-secondary)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {wt.name}
                      </span>
                      {wt.last_opened_ms > 0 && (
                        <span style={{ fontSize: 9, color: "var(--text-faint)" }}>
                          {formatRelativeTime(wt.last_opened_ms)}
                        </span>
                      )}
                    </div>
                    {activeWorktreeId === wt.id && (
                      <span className="badge badge-accent ml-auto">active</span>
                    )}

                    {/* Actions — appear on hover */}
                    <div
                      className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        className="btn btn-ghost btn-icon"
                        style={{ width: 20, height: 20 }}
                        title="Rename"
                        onClick={() => startRename(wt)}
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        className="btn btn-ghost btn-icon"
                        style={{ width: 20, height: 20 }}
                        title="Reveal in file manager"
                        onClick={() => openInFileManager(wt.root_path)}
                      >
                        <ExternalLink size={10} />
                      </button>
                      <button
                        className="btn btn-ghost btn-icon"
                        style={{ width: 20, height: 20, color: "var(--color-danger)" }}
                        title="Remove worktree (keeps files)"
                        onClick={() => setConfirmDeleteId(wt.id)}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </button>
                )}
              </div>
            ))}

            {/* Loading */}
            {isLoading && (
              <div className="flex items-center justify-center py-2">
                <RefreshCw size={12} className="animate-spin" style={{ color: "var(--text-muted)" }} />
              </div>
            )}

            {/* Add new */}
            <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--sidebar-nav-hover-bg)] transition-colors"
                style={{ color: "var(--accent)" }}
                onClick={() => { setIsExpanded(false); setShowCreate(true); }}
              >
                <Plus size={11} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: "var(--font-size-sm)", fontWeight: 600 }}>
                  New worktree…
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirm dialog */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ backgroundColor: "var(--surface-overlay)" }}
        >
          <div
            className="w-full max-w-sm rounded-xl overflow-hidden"
            style={{
              background: "var(--bg-surface-elevated)",
              border: "1px solid var(--border-strong)",
              boxShadow: "var(--shadow-dialog)",
            }}
          >
            <div className="px-5 py-4">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
                  style={{ background: "rgba(248,113,113,0.12)", color: "var(--color-danger)" }}
                >
                  <AlertTriangle size={15} />
                </div>
                <h3 style={{ fontSize: "var(--font-size-md)", fontWeight: 700, color: "var(--text-primary)" }}>
                  Remove Worktree?
                </h3>
              </div>
              <p style={{ fontSize: "var(--font-size-base)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                This removes the worktree from Composer but{" "}
                <strong>does not delete</strong> its files from disk.
              </p>
            </div>
            <div
              className="flex items-center justify-end gap-2 px-5 py-3"
              style={{ borderTop: "1px solid var(--border-subtle)" }}
            >
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleDelete(confirmDeleteId)}
              >
                <Trash2 size={12} />
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error toast */}
      {actionError && (
        <div
          className="fixed bottom-6 right-6 z-[70] rounded-lg px-4 py-3 flex items-center gap-2 max-w-xs"
          style={{
            background: "var(--bg-surface-elevated)",
            border: "1px solid var(--color-danger)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <AlertTriangle size={13} style={{ color: "var(--color-danger)", flexShrink: 0 }} />
          <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-primary)" }}>
            {actionError}
          </span>
          <button
            className="btn btn-ghost btn-icon ml-auto"
            style={{ width: 18, height: 18 }}
            onClick={() => setActionError(null)}
          >
            <X size={11} />
          </button>
        </div>
      )}

      <CreateWorktreeDialog
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        workspacePath={workspacePath}
        workspaceId={workspaceId}
      />
    </>
  );
}
