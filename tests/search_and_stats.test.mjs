import test from "node:test";
import assert from "node:assert/strict";

// Mirror ranking algorithm from Rust / API
function rankSearchResults(entries, query, limit = 50) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const queryLower = trimmed.toLowerCase();
  const results = [];

  for (const entry of entries) {
    const filename = entry.name.split("/").pop() || entry.name;
    const fileLower = filename.toLowerCase();
    const stem = filename.includes(".") ? filename.substring(0, filename.lastIndexOf(".")) : filename;
    const stemLower = stem.toLowerCase();
    const relLower = entry.name.toLowerCase();

    // 1. Exact filename match (full name or file stem)
    if (fileLower === queryLower || stemLower === queryLower) {
      results.push({ ...entry, match_type: "exact_filename", score: 1 });
    } else if (fileLower.startsWith(queryLower) || stemLower.startsWith(queryLower)) {
      results.push({ ...entry, match_type: "prefix_filename", score: 2 });
    } else if (fileLower.includes(queryLower)) {
      results.push({ ...entry, match_type: "substring_filename", score: 3 });
    } else if (relLower.includes(queryLower)) {
      results.push({ ...entry, match_type: "path", score: 4 });
    } else if (entry.content && entry.content.toLowerCase().includes(queryLower)) {
      results.push({ ...entry, match_type: "content", score: 5 });
    }
  }

  results.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const nameCmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    if (nameCmp !== 0) return nameCmp;
    return a.path.localeCompare(b.path);
  });

  return results.slice(0, limit);
}

function formatFileSize(bytes) {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "0 B";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${val} ${sizes[i] || "B"}`;
}

test("Search Ranking - Exact matches precede prefix and substring matches", () => {
  const items = [
    { name: "docs/other.md", path: "/ws/docs/other.md", is_dir: false },
    { name: "readme.md", path: "/ws/readme.md", is_dir: false },
    { name: "readme_backup.md", path: "/ws/readme_backup.md", is_dir: false },
    { name: "my_readme.md", path: "/ws/my_readme.md", is_dir: false },
    { name: "guide.txt", path: "/ws/guide.txt", is_dir: false, content: "Contains readme inside body" }
  ];

  const results = rankSearchResults(items, "readme");
  assert.equal(results.length, 4);

  // Score 1: exact filename match (readme.md)
  assert.equal(results[0].match_type, "exact_filename");
  assert.equal(results[0].name, "readme.md");
  assert.equal(results[0].score, 1);

  // Score 2: prefix filename match (readme_backup.md)
  assert.equal(results[1].match_type, "prefix_filename");
  assert.equal(results[1].name, "readme_backup.md");
  assert.equal(results[1].score, 2);

  // Score 3: substring filename match (my_readme.md)
  assert.equal(results[2].match_type, "substring_filename");
  assert.equal(results[2].name, "my_readme.md");
  assert.equal(results[2].score, 3);

  // Score 5: content match (guide.txt)
  assert.equal(results[3].match_type, "content");
  assert.equal(results[3].name, "guide.txt");
  assert.equal(results[3].score, 5);
});

test("Search Ranking - Content match falls back to score 5", () => {
  const items = [
    { name: "notes.txt", path: "/ws/notes.txt", is_dir: false, content: "Found specific_term in line 12" },
    { name: "specific_term.md", path: "/ws/specific_term.md", is_dir: false }
  ];

  const results = rankSearchResults(items, "specific_term");
  assert.equal(results[0].name, "specific_term.md");
  assert.equal(results[0].score, 1);
  assert.equal(results[1].name, "notes.txt");
  assert.equal(results[1].score, 5);
});

test("formatFileSize formats bytes, KB, MB reliably", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(1024), "1 KB");
  assert.equal(formatFileSize(2048), "2 KB");
  assert.equal(formatFileSize(1048576), "1 MB");
});
