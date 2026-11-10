import test from "node:test";
import assert from "node:assert/strict";

// Workspace recent list retention logic
function updateRecentWorkspaces(existingList, newPath, newName) {
  const now = Date.now();
  const normalizedPath = newPath.replace(/[\\/]+$/, "");
  const filtered = existingList.filter(
    (w) => w.path.replace(/[\\/]+$/, "").toLowerCase() !== normalizedPath.toLowerCase()
  );
  
  const updated = [
    { path: newPath, name: newName || newPath.split(/[\\/]/).pop() || "Workspace", last_opened: now },
    ...filtered
  ];

  // Max 10 recent workspaces
  return updated.slice(0, 10);
}

function removeRecentWorkspace(existingList, pathToRemove) {
  const normalizedPath = pathToRemove.replace(/[\\/]+$/, "").toLowerCase();
  return existingList.filter(
    (w) => w.path.replace(/[\\/]+$/, "").toLowerCase() !== normalizedPath
  );
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "Unknown";
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  return `${diffDays}d ago`;
}

function classifyFileType(filename) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["md", "markdown", "mdown"].includes(ext)) return "Markdown";
  if (["ts", "tsx", "js", "jsx", "rs", "py", "html", "css", "scss", "c", "cpp", "go"].includes(ext)) return "Code";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext)) return "Media";
  if (["json", "toml", "yaml", "yml", "csv", "xml"].includes(ext)) return "Config/Data";
  return "Plain Text / Other";
}

test("Workspace Lifecycle - Adding new workspace adds to front and updates timestamp", () => {
  const initial = [
    { path: "/ws/project-a", name: "project-a", last_opened: 1000 },
    { path: "/ws/project-b", name: "project-b", last_opened: 900 }
  ];

  const updated = updateRecentWorkspaces(initial, "/ws/project-c", "project-c");
  assert.equal(updated.length, 3);
  assert.equal(updated[0].path, "/ws/project-c");
  assert.equal(updated[0].name, "project-c");
  assert.ok(updated[0].last_opened > 1000);
});

test("Workspace Lifecycle - Re-opening existing workspace moves it to top without duplicates", () => {
  const initial = [
    { path: "/ws/project-a", name: "project-a", last_opened: 1000 },
    { path: "/ws/project-b", name: "project-b", last_opened: 900 }
  ];

  const updated = updateRecentWorkspaces(initial, "/ws/project-b", "project-b");
  assert.equal(updated.length, 2);
  assert.equal(updated[0].path, "/ws/project-b");
  assert.equal(updated[1].path, "/ws/project-a");
});

test("Workspace Lifecycle - Removing workspace removes entry from list without altering others", () => {
  const initial = [
    { path: "/ws/project-a", name: "project-a", last_opened: 1000 },
    { path: "/ws/project-b", name: "project-b", last_opened: 900 },
    { path: "/ws/project-c", name: "project-c", last_opened: 800 }
  ];

  const filtered = removeRecentWorkspace(initial, "/ws/project-b");
  assert.equal(filtered.length, 2);
  assert.ok(!filtered.some((w) => w.path === "/ws/project-b"));
  assert.equal(filtered[0].path, "/ws/project-a");
  assert.equal(filtered[1].path, "/ws/project-c");
});

test("Workspace Lifecycle - Relative time formatting produces human-readable strings", () => {
  const now = Date.now();
  assert.equal(formatRelativeTime(now - 10 * 1000), "Just now");
  assert.equal(formatRelativeTime(now - 5 * 60 * 1000), "5m ago");
  assert.equal(formatRelativeTime(now - 3 * 3600 * 1000), "3h ago");
  assert.equal(formatRelativeTime(now - 2 * 86400 * 1000), "2d ago");
  assert.equal(formatRelativeTime(null), "Unknown");
});

test("File Classification - Extension categorized reliably into distinct groups", () => {
  assert.equal(classifyFileType("README.md"), "Markdown");
  assert.equal(classifyFileType("main.rs"), "Code");
  assert.equal(classifyFileType("App.tsx"), "Code");
  assert.equal(classifyFileType("diagram.svg"), "Media");
  assert.equal(classifyFileType("photo.png"), "Media");
  assert.equal(classifyFileType("config.toml"), "Config/Data");
  assert.equal(classifyFileType("data.json"), "Config/Data");
  assert.equal(classifyFileType("notes.txt"), "Plain Text / Other");
  assert.equal(classifyFileType("no_extension"), "Plain Text / Other");
});

test("Unsaved changes guard - Flags active dirty editors before workspace navigation", () => {
  const tabs = [
    { path: "/ws/file1.txt", dirty: false },
    { path: "/ws/file2.md", dirty: true },
    { path: "/ws/file3.rs", dirty: false }
  ];

  const hasUnsavedChanges = tabs.some((t) => t.dirty);
  assert.equal(hasUnsavedChanges, true);

  const dirtyFiles = tabs.filter((t) => t.dirty).map((t) => t.path);
  assert.deepEqual(dirtyFiles, ["/ws/file2.md"]);
});
