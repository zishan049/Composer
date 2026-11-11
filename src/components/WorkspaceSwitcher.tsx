import React, { useState } from "react";
import {
  FolderOpen,
  X,
  HardDrive,
  Clock,
  Trash2,
  AlertTriangle,
  Check,
  ExternalLink,
} from "lucide-react";
import { RecentWorkspace } from "../types";
import { formatRelativeTime } from "../utils/recentFiles";
import { openInFileManager } from "../lib/api";

export interface WorkspaceSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspace: string;
  recentWorkspaces: RecentWorkspace[];
  onSelectWorkspace: (path: string) => void;
  onOpenDirectory: () => void;
  onRemoveRecent: (path: string) => void;
  hasUnsavedChanges?: boolean;
}

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  isOpen,
  onClose,
  currentWorkspace,
  recentWorkspaces,
  onSelectWorkspace,
  onOpenDirectory,
  onRemoveRecent,
  hasUnsavedChanges = false,
}) => {
  const [pendingSwitchPath, setPendingSwitchPath] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleWorkspaceClick = (path: string) => {
    if (path === currentWorkspace) {
      onClose();
      return;
    }
    if (hasUnsavedChanges) {
      setPendingSwitchPath(path);
    } else {
      onSelectWorkspace(path);
      onClose();
    }
  };

  const confirmSwitch = () => {
    if (pendingSwitchPath) {
      onSelectWorkspace(pendingSwitchPath);
      setPendingSwitchPath(null);
      onClose();
    }
  };

  const cancelPendingSwitch = () => {
    setPendingSwitchPath(null);
  };

  const currentName =
    currentWorkspace.split(/[\\\/]/).filter(Boolean).pop() || "Current Workspace";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
      <div
        className="relative w-full max-w-lg bg-[var(--bg-surface-elevated)] border border-[var(--border-strong)] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
              <HardDrive size={15} />
            </div>
            <div>
              <h2
                id="workspace-modal-title"
                className="text-sm font-semibold text-[var(--text-primary)]"
              >
                Workspace Management
              </h2>
              <p className="text-[11px] text-[var(--text-muted)]">
                Switch, open, or manage local project workspaces
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-nav-hover-bg)] transition-colors cursor-pointer"
            title="Close dialog (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        {/* Unsaved changes confirmation warning banner */}
        {pendingSwitchPath && (
          <div className="p-4 bg-amber-500/10 border-b border-amber-500/20 text-xs">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold text-amber-200 block mb-1">
                  Unsaved changes in active workspace
                </span>
                <p className="text-amber-300/80 leading-relaxed mb-3">
                  You have unsaved changes in your editor tabs. Switching workspaces will
                  discard these unsaved edits.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={confirmSwitch}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black cursor-pointer transition-colors"
                  >
                    Discard Changes &amp; Switch
                  </button>
                  <button
                    onClick={cancelPendingSwitch}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Active Workspace Block */}
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-2">
              Active Workspace
            </span>
            <div className="p-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                    {currentName}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-[var(--accent)] text-white">
                    Current
                  </span>
                </div>
                <span
                  className="text-[11px] text-[var(--text-secondary)] truncate block font-mono"
                  title={currentWorkspace}
                >
                  {currentWorkspace || "No workspace loaded"}
                </span>
              </div>
              <button
                onClick={() => openInFileManager(currentWorkspace).catch(() => {})}
                className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer shrink-0"
                title="Open in system file manager"
              >
                <ExternalLink size={14} />
              </button>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (hasUnsavedChanges) {
                  // Prompt first
                  setPendingSwitchPath("NEW_PICKER");
                } else {
                  onOpenDirectory();
                  onClose();
                }
              }}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium bg-[var(--bg-surface-elevated)] hover:bg-[var(--sidebar-nav-hover-bg)] border border-[var(--border-default)] hover:border-[var(--border-strong)] text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              <FolderOpen size={14} className="text-[var(--accent)]" />
              <span>Open Existing Folder...</span>
            </button>
          </div>

          {/* Recent Workspaces List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Recent Workspaces ({recentWorkspaces.length})
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                Stored locally
              </span>
            </div>

            {recentWorkspaces.length > 0 ? (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {recentWorkspaces.map((item) => {
                  const isActive =
                    item.path.toLowerCase() === currentWorkspace.toLowerCase();
                  return (
                    <div
                      key={item.path}
                      onClick={() => handleWorkspaceClick(item.path)}
                      className={`group flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${
                        isActive
                          ? "bg-[var(--accent-soft)] border-[var(--accent)]/40 text-[var(--text-primary)]"
                          : "bg-[var(--bg-surface-elevated)] border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--sidebar-nav-hover-bg)]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <FolderOpen
                          size={15}
                          className={
                            isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                          }
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                              {item.name}
                            </span>
                            {isActive && (
                              <Check size={12} className="text-[var(--accent)] shrink-0" />
                            )}
                          </div>
                          <span
                            className="text-[10.5px] text-[var(--text-muted)] truncate block font-mono"
                            title={item.path}
                          >
                            {item.path}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {item.last_opened > 0 && (
                          <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                            <Clock size={10} />
                            {formatRelativeTime(item.last_opened)}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveRecent(item.path);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                          title="Remove from recent list (does not delete directory)"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center rounded-lg border border-dashed border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                No recent workspaces saved yet. Open a workspace folder to get started.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--sidebar-nav-hover-bg)] text-[var(--text-secondary)] border border-[var(--border-subtle)] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
