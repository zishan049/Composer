/**
 * Composer v0.4 — Per-document dirty state manager
 *
 * Maintains a map of path → isDirty instead of one global boolean.
 * Provides hooks and utilities for components to track and query dirty state.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";

export interface DirtyStateContextValue {
  /** Mark a document as dirty or clean */
  setDirty: (path: string, isDirty: boolean) => void;
  /** Check if a specific document is dirty */
  isDirty: (path: string) => boolean;
  /** True when any open document has unsaved changes */
  hasAnyDirty: boolean;
  /** All dirty paths */
  dirtyPaths: string[];
  /** Clear all dirty state (e.g. on workspace switch) */
  clearAll: () => void;
  /** Remove a path from tracking (e.g. when tab is closed) */
  removePath: (path: string) => void;
}

const DirtyStateContext = createContext<DirtyStateContextValue | null>(null);

export function useDirtyState(): DirtyStateContextValue {
  const ctx = useContext(DirtyStateContext);
  if (!ctx) throw new Error("useDirtyState must be inside <DirtyStateProvider>");
  return ctx;
}

import React from "react";

export function DirtyStateProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const dirtyMapRef = useRef<Record<string, boolean>>({});

  const setDirty = useCallback((path: string, isDirty: boolean) => {
    setDirtyMap(prev => {
      const current = prev[path] ?? false;
      if (current === isDirty) return prev;
      const next = { ...prev, [path]: isDirty };
      dirtyMapRef.current = next;
      return next;
    });
  }, []);

  const isDirty = useCallback(
    (path: string) => dirtyMapRef.current[path] ?? false,
    []
  );

  const hasAnyDirty = Object.values(dirtyMap).some(Boolean);
  const dirtyPaths = Object.entries(dirtyMap)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const clearAll = useCallback(() => {
    dirtyMapRef.current = {};
    setDirtyMap({});
  }, []);

  const removePath = useCallback((path: string) => {
    setDirtyMap(prev => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      dirtyMapRef.current = next;
      return next;
    });
  }, []);

  // Sync hasAnyDirty to window for App.tsx consumers
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("composer:unsaved-changed", {
        detail: { hasUnsaved: hasAnyDirty },
      })
    );
  }, [hasAnyDirty]);

  const value: DirtyStateContextValue = {
    setDirty,
    isDirty,
    hasAnyDirty,
    dirtyPaths,
    clearAll,
    removePath,
  };

  return (
    <DirtyStateContext.Provider value={value}>
      {children}
    </DirtyStateContext.Provider>
  );
}
