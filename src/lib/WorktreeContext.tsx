/**
 * Composer v0.4 — Worktree Context
 *
 * Provides the active worktree state and management functions
 * to the entire component tree. Each worktree is a named, independently
 * navigable sub-workspace inside a parent workspace.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  WorktreeMetadata,
  WorktreeId,
  WorktreeState,
  ParentWorkspace,
} from "../types";

// ── IPC types ────────────────────────────────────────────────────

export interface CreateWorktreeArgs {
  name: string;
  root_path: string;
  parent_workspace_id: string;
}

export interface RenameWorktreeArgs {
  worktree_id: WorktreeId;
  new_name: string;
}

// ── Context shape ─────────────────────────────────────────────────

export interface WorktreeContextValue {
  /** All worktrees in the active parent workspace */
  worktrees: WorktreeMetadata[];
  /** The currently active worktree (null = main/default) */
  activeWorktreeId: WorktreeId | null;
  activeWorktree: WorktreeMetadata | null;
  /** Parent workspace information */
  parentWorkspace: ParentWorkspace | null;

  isLoading: boolean;
  error: string | null;

  createWorktree: (args: CreateWorktreeArgs) => Promise<WorktreeMetadata>;
  renameWorktree: (args: RenameWorktreeArgs) => Promise<void>;
  switchWorktree: (id: WorktreeId | null) => Promise<void>;
  removeWorktree: (id: WorktreeId, deleteFiles?: boolean) => Promise<void>;
  refreshWorktrees: () => Promise<void>;

  /** Save per-worktree editor state before switching */
  saveWorktreeState: (state: WorktreeState) => void;
  /** Get saved state for a worktree (for restoration) */
  getWorktreeState: (id: WorktreeId) => WorktreeState | null;
}

const WorktreeContext = createContext<WorktreeContextValue | null>(null);

export function useWorktrees(): WorktreeContextValue {
  const ctx = useContext(WorktreeContext);
  if (!ctx) throw new Error("useWorktrees must be used inside <WorktreeProvider>");
  return ctx;
}

// ── Provider ─────────────────────────────────────────────────────

interface WorktreeProviderProps {
  children: React.ReactNode;
  workspacePath: string;
}

export function WorktreeProvider({
  children,
  workspacePath,
}: WorktreeProviderProps): React.ReactElement {
  const [worktrees, setWorktrees] = useState<WorktreeMetadata[]>([]);
  const [activeWorktreeId, setActiveWorktreeId] = useState<WorktreeId | null>(null);
  const [parentWorkspace, setParentWorkspace] = useState<ParentWorkspace | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-worktree editor state saved in memory (tabs, scroll, cursor)
  const worktreeStates = useRef<Map<WorktreeId, WorktreeState>>(new Map());

  const refreshWorktrees = useCallback(async () => {
    if (!workspacePath) {
      setWorktrees([]);
      setParentWorkspace(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const ws = await invoke<ParentWorkspace | null>("get_parent_workspace", {
        workspacePath,
      });
      if (ws) {
        setParentWorkspace(ws);
        setWorktrees(ws.worktrees);
        // Restore last active worktree id
        if (ws.active_worktree_id && ws.worktrees.some(w => w.id === ws.active_worktree_id)) {
          setActiveWorktreeId(ws.active_worktree_id);
        } else {
          setActiveWorktreeId(null);
        }
      } else {
        setParentWorkspace(null);
        setWorktrees([]);
        setActiveWorktreeId(null);
      }
    } catch (err: unknown) {
      // Worktree system may not be initialized yet — that's OK
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("not found") && !msg.includes("no worktrees")) {
        setError(msg);
      }
      setParentWorkspace(null);
      setWorktrees([]);
    } finally {
      setIsLoading(false);
    }
  }, [workspacePath]);

  // Load on mount and workspace change
  useEffect(() => {
    refreshWorktrees();
  }, [refreshWorktrees]);

  // Listen for external config_updated events (workspace switch)
  useEffect(() => {
    const unsub = listen("config_updated", () => {
      refreshWorktrees();
    });
    return () => { unsub.then(fn => fn()); };
  }, [refreshWorktrees]);

  const createWorktree = useCallback(
    async (args: CreateWorktreeArgs): Promise<WorktreeMetadata> => {
      const result = await invoke<WorktreeMetadata>("create_worktree", {
        name: args.name,
        rootPath: args.root_path,
        parentWorkspaceId: args.parent_workspace_id,
      });
      await refreshWorktrees();
      return result;
    },
    [refreshWorktrees]
  );

  const renameWorktree = useCallback(
    async (args: RenameWorktreeArgs): Promise<void> => {
      await invoke("rename_worktree", {
        worktreeId: args.worktree_id,
        newName: args.new_name,
      });
      await refreshWorktrees();
    },
    [refreshWorktrees]
  );

  const switchWorktree = useCallback(
    async (id: WorktreeId | null): Promise<void> => {
      if (id === activeWorktreeId) return;

      // Persist the new active worktree
      await invoke("set_active_worktree", {
        workspacePath,
        worktreeId: id,
      });
      setActiveWorktreeId(id);

      // Notify other components a worktree switch occurred
      window.dispatchEvent(
        new CustomEvent("composer:worktree-switched", { detail: { id } })
      );
    },
    [activeWorktreeId, workspacePath]
  );

  const removeWorktree = useCallback(
    async (id: WorktreeId, deleteFiles = false): Promise<void> => {
      await invoke("remove_worktree", {
        worktreeId: id,
        deleteFiles,
      });
      // If we just removed the active one, fall back to main
      if (id === activeWorktreeId) {
        setActiveWorktreeId(null);
      }
      await refreshWorktrees();
    },
    [activeWorktreeId, refreshWorktrees]
  );

  const saveWorktreeState = useCallback((state: WorktreeState) => {
    worktreeStates.current.set(state.worktree_id, state);
  }, []);

  const getWorktreeState = useCallback(
    (id: WorktreeId): WorktreeState | null => {
      return worktreeStates.current.get(id) ?? null;
    },
    []
  );

  const activeWorktree =
    worktrees.find(w => w.id === activeWorktreeId) ?? null;

  const value: WorktreeContextValue = {
    worktrees,
    activeWorktreeId,
    activeWorktree,
    parentWorkspace,
    isLoading,
    error,
    createWorktree,
    renameWorktree,
    switchWorktree,
    removeWorktree,
    refreshWorktrees,
    saveWorktreeState,
    getWorktreeState,
  };

  return (
    <WorktreeContext.Provider value={value}>
      {children}
    </WorktreeContext.Provider>
  );
}
