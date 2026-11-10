<div align="center">

<img src="src-tauri/icons/icon.ico" alt="Composer app icon" width="72" />

# Composer v0.3

**A minimal, fast, local-first desktop workspace.**

Create, edit, organize, search, and preview project files without the complexity of a full IDE.

<br />

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111827)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)

<br />

[**Download**](https://github.com/zishan049/Composer/releases/latest) · [**Features**](#what-you-can-do) · [**Architecture**](#architecture) · [**Run locally**](#run-locally) · [**Report an issue**](https://github.com/zishan049/Composer/issues)

</div>

---

## Workspace-first design

Composer v0.3 matures Composer into a comprehensive workspace management application designed around local files and folders. Rather than an editor surrounded by unrelated panels or an overloaded IDE, Composer prioritizes workspace clarity, rapid search, reliable workspace lifecycle, and smooth previews.

- **Local-first by design** — Your project files live entirely on your machine in a strictly sandboxed directory. No telemetry, no cloud lock-in.
- **Complete UI/UX Redesign** — Premium minimal desktop workspace inspired by modern productivity software. Restrained teal accent (`#39C6B0`), dark-first charcoal surfaces (`#0B0D0F`, `#111416`, `#171B1E`), and a matching high-contrast light theme with reduced-motion accessibility support.
- **First-Class Workspace Lifecycle** — Switch between recent workspaces, open existing folders, view relative timestamps, and remove workspace entries from history without touching files on disk. Graceful handling of missing or inaccessible workspace roots.
- **Real Workspace Overview** — Answers *"What is in this workspace, and what should I open next?"* with live file/folder counts, volume stats, composition breakdowns by file type (Markdown, Code, Media, Config, etc.), quick action triggers, and "Reveal in File Manager".
- **Dedicated Information Architecture** — Clean separation into four core workspace views:
  - **Overview**: Landing page with workspace health, metrics, composition breakdown, and quick starts.
  - **Files**: Explorer tree, Monaco editor, tab state management, and rich previewers.
  - **Search**: Dedicated search hub with deterministic ranking and category filter pills.
  - **Recent**: Dedicated activity hub distinguishing recently opened files, recently modified files on disk, and known workspaces.
- **Unsaved Changes Protection** — Explicit modal guards prevent accidental data loss when closing dirty editor tabs or switching workspaces.
- **Deterministic Search & Indexing** — Fast, local search ranked strictly:
  1. Exact filename match (matches full name or stem)
  2. Filename prefix match
  3. Filename substring match
  4. Relative path match
  5. File content match (for supported text/markdown files $\le$ 1MB) with stable alphabetical tie-breaking.
- **Command Palette (`Ctrl/Cmd + K`)** — Jump to views, create documents, switch workspaces, toggle themes, and find files instantly from any screen.
- **Atomic file operations** — Text saves use atomic sibling-temporary writes to prevent data corruption during unexpected halts or power interruptions.

---

## What you can do

| Area | Capabilities |
| --- | --- |
| **Workspace Overview** | Summary metrics (files, folders, recursive volume), file type composition bars, switch workspaces, quick action cards, reveal in file manager, and tabbed recent/modified file activity. |
| **Workspace Management** | Switch between recent workspaces, open local folders, remove recent workspace history without deleting files, and recover from missing roots. |
| **Explorer & Files** | Compact tree navigation, recursive expansion, file and folder creation, rename, delete with confirmation, and external asset import. Context menu includes "Reveal in File Manager" and "Copy Path". |
| **Code & Markdown** | Monaco-based editor, Markdown preview (split, code, and preview modes), syntax highlighting, saved/unsaved status indicators, and tabs with dirty-state confirmation guards. |
| **Search View** | Dedicated search engine with deterministic ranking, category filter pills (All, Markdown, Code, Config/Data, Plain Text), match type badges, and code snippets with line numbers. |
| **Recent Activity** | Dedicated hub tracking recently opened files, recently modified files on disk, and recent workspace history. |
| **Command Palette** | Accessible with `Ctrl/Cmd + K` or titlebar search for keyboard-driven navigation, file opening, and theme toggling. |
| **Previews** | Native vector rendering for SVG, text/canvas viewer for PDF, color sampling and metadata inspection for images, and table views for CSV/JSON/TOML. |
| **Security & Sandbox** | Canonicalized workspace root enforcement, traversal (`..`) rejection, and session allowlisting. |

---

## Architecture

Composer separates native desktop concerns from UI rendering through a typed boundary:

```text
┌────────────────────────────────────────────────────────┐
│                      React 19 UI                       │
│  Overview · Explorer · Monaco Editor · Command Palette  │
└───────────────────────────┬────────────────────────────┘
                            │ Typed IPC Boundary (src/lib/api.ts)
┌───────────────────────────▼────────────────────────────┐
│                   Tauri 2 Native Core                  │
│    Path Sandboxing · Atomic File Ops · Search Index    │
└────────────────────────────────────────────────────────┘
```

- **Frontend API Boundary (`src/lib/api.ts`)**: Centralizes all `invoke` calls into typed, promise-based functions with normalized error handling and consistent TypeScript interfaces (`AppConfig`, `FileEntry`, `WorkspaceStats`, `SearchResult`).
- **Security Sandboxing (`src-tauri/src/file_ops.rs`)**: Every path is validated against the active workspace root using canonicalization to prevent escapes, symlink traversal, or directory breakout.
- **Workspace Index & Invalidation**: High-speed indexing caches workspace file metadata in a compact JSON cache, automatically invalidated upon file creation, rename, or deletion.

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + K` | Open Command Palette / Quick Search |
| `Ctrl/Cmd + S` | Save active file (atomic write) |
| `Ctrl/Cmd + W` | Close active editor tab |
| `Ctrl/Cmd + N` | Create new file |
| `F2` | Rename selected item |
| `Delete` | Delete selected item(s) with confirmation |
| `F11` | Toggle fullscreen window |
| `Esc` | Close active dialog or dismiss command palette |

---

## Technology

| Layer | Stack |
| --- | --- |
| Desktop shell | Tauri 2 |
| Native backend | Rust 2021 |
| UI Framework | React 19 + TypeScript (Strict) |
| Build Tool | Vite 7 |
| Styling | Tailwind CSS 4 + Design Token CSS Variables |
| Editor | Monaco Editor (Lazy loaded) |
| Previews | PDF.js, pdf-lib, DOMPurify, Marked |

---

## Run locally

### Requirements

- Node.js (v20 or v22 recommended)
- npm
- Rust stable and Cargo
- Platform prerequisites from the [Tauri setup guide](https://tauri.app/start/prerequisites/)

### Setup and Development

```bash
git clone https://github.com/zishan049/Composer.git
cd Composer
npm install
npm test
npm run dev
```

To run the desktop application in dev mode with Tauri:

```bash
npm run tauri dev
```

### Verification Checks

```bash
# Typecheck
npx tsc --noEmit

# Frontend Unit Tests
npm test

# Rust Checks
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## Privacy & Network

Composer is local-first. Normal creation, editing, file operations, searching, and previewing occur entirely offline on your machine. Optional background update checks (configured in Settings) connect to GitHub Releases to inspect release tags.

---

## License

Licensing terms will be specified upon public release. All rights reserved.
