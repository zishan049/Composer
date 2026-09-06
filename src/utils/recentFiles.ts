import { RecentFile } from "../types";

const STORAGE_KEY = "composer_recent_files";
const MAX_RECENT_ITEMS = 12;

export function getRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(item => item && typeof item.path === "string" && typeof item.filename === "string");
    }
  } catch (err) {
    console.warn("Failed to parse recent files from storage:", err);
  }
  return [];
}

export function trackRecentFile(path: string, filename: string): void {
  try {
    if (!path) return;
    const current = getRecentFiles().filter(item => item.path !== path);
    const updated: RecentFile[] = [
      {
        path,
        filename: filename || path.split(/[\\\/]/).pop() || "file",
        lastOpened: Date.now(),
      },
      ...current,
    ].slice(0, MAX_RECENT_ITEMS);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("composer:recent-files-updated", { detail: updated }));
  } catch (err) {
    console.warn("Failed to persist recent file:", err);
  }
}

export function removeRecentFile(path: string): void {
  try {
    const current = getRecentFiles().filter(item => item.path !== path);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent("composer:recent-files-updated", { detail: current }));
  } catch (err) {
    console.warn("Failed to remove recent file:", err);
  }
}

export function clearAllRecentFiles(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("composer:recent-files-updated", { detail: [] }));
  } catch (err) {
    console.warn("Failed to clear recent files:", err);
  }
}

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
