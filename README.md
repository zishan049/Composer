<div align="center">

<img src="public/composer-icon.svg" alt="Composer app icon" width="76" />

# Composer v0.4.0

**A minimal, fast, local-first desktop workspace.**

Create, edit, organize, search, compare, and preview project files without the complexity of a full IDE.

<br />

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111827)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)

<br />

[**Download**](https://github.com/zishan049/Composer/releases/latest) · [**Features**](#what-you-can-do) · [**Architecture**](#architecture) · [**Shortcuts**](#keyboard-shortcuts) · [**Run locally**](#run-locally) · [**Report an issue**](https://github.com/zishan049/Composer/issues)

</div>

---

## Workspace-first design

Composer v0.4.0 builds on a fast, strictly sandboxed workspace foundation with **Git-free Worktrees**, a **Unified Multi-Media Compare Workspace**, **Quantum Blue** & **Ghost Fiber** visual styling, and **live native system telemetry**.

- **Local-first by design** — Your project files live entirely on your machine inside a canonicalized, sandboxed workspace root with no cloud lock-in.
- **Quantum Blue & Ghost Fiber Aesthetic** — Deep Obsidian (`#0B0F19`) dark mode and crisp Polar White (`#F0F4F8`) light mode with Quantum Blue accents (`#2457FF`, `#00D4FF`, `#DFF7FF`), an animated **Ghost Fibers** canvas ambient backdrop across the shell and startup reveal, glassmorphic navigation bars, adjustable edge smoothness sliders, typography presets, and TOML theme export/import.
- **Three Focused Views + Global Command Palette** — Navigate cleanly between **Overview**, **Files**, and **Settings** via a glassmorphic Top or Bottom Navbar, or invoke the **`Ctrl/Cmd + K`** **Command Palette** from anywhere for instant file search, navigation, worktree creation, and theme toggling.
- **Git-Free Worktrees & Nested Workspaces** — Organize independent sub-workspaces as named **Worktrees** (`<workspace>/.composer/worktrees.json`) without requiring Git, scaffold nested `composer.toml` workspaces straight from the Explorer, and switch worktrees smoothly without losing your place in **Files**.
- **Clean Bento Overview** — A unified Workspace Overview card surfaces your workspace path, **Indexed Files**, **Directories**, **Storage Volume**, and **Composition** stats alongside **Quick Actions** and a filterable **Recent Files** grid powered by **GlideSelect**.
- **Unified Multi-Image / SVG Compare Workspace** — Compare multiple raster images and SVGs in one shared interactive canvas (`Row`, `Stack`, `Board`, draggable A/B `Split`, and `Overlay` blend modes including `difference` and `exclusion`) with synced zoom/pan, `Match Size` vs `1:1` scaling, and customizable backdrops.
- **Live System Telemetry Rings** — Circular **CPU** and **RAM** utilization indicators in the status bar/bottom navbar poll native Rust metrics every **15 seconds** (plus instant refresh on focus restore).
- **Unsaved Changes Protection & Atomic Writes** — Explicit dirty-state guards protect unsaved tabs when closing or switching workspaces, and text saves use atomic sibling-temporary writes to prevent file corruption.

---

## What you can do

| Area | Capabilities |
| --- | --- |
| **Workspace Overview** | Unified hero summary (**Indexed Files**, **Directories**, **Storage Volume**, dominant **Composition** formats), **Quick Actions** (`New File`, `New Folder`, `New Worktree`, `Switch Workspace`), Reveal in File Manager, and **Recent Files** Bento cards with **GlideSelect** category filtering (`All`, `Images`, `Docs`, `Code`). |
| **Worktrees & Workspaces** | Create, rename, switch, and delete named **Worktrees** without Git (`worktrees.json`), scaffold nested `composer.toml` workspaces from Explorer, manage recent workspace history cleanly, and preserve navigation state across worktree switches. |
| **Explorer & Files** | Tree navigation with multi-select (`Ctrl+A`), file/folder creation, rename (`F2`), delete with confirmation, external file/folder import, native drag-and-drop registration, context menus (`Reveal in File Manager`, `Copy Path`), and local version history snapshots. |
| **Code, Markdown & Data** | Lazy-loaded Monaco Editor with self-hosted workers, Markdown preview (`Preview`, `Split`, `Code` + print/save), structured inspection for CSV/JSON/TOML, and atomic disk writes with dirty-state modal guards. |
| **Unified Media Compare & Previews** | Multi-image/SVG compare canvas (`Row`, `Stack`, `Board`, `Split`, `Overlay`, synced zoom/pan, backdrop switcher), single-image inspector (zoom, rotate, flip, eyedropper color sampler), interactive SVG preview/code split, and PDF viewing & editing (`pdfjs-dist` + `pdf-lib`). |
| **Command Palette** | Global **`Ctrl/Cmd + K`** quick switcher with deterministic workspace search (exact filename → prefix → substring → path → text content $\le$ 1 MB), filter tabs, and quick workspace/theme actions. |
| **Appearance & Preferences** | **GlideSelect** dropdown controls, **Ghost Fibers** customization (style, opacity, palette), UI & navbar edge smoothness sliders, Top vs Bottom glassmorphic navbar layout, typography presets, palette color overrides, TOML theme export/import, and built-in GitHub Releases updater checks. |
| **System Telemetry** | Native Rust CPU (`GetSystemTimes` / loadavg) and physical RAM telemetry rendered as compact circular progress rings updating every 15 seconds. |
| **Security & Sandbox** | Canonicalized workspace boundary checks, `..` traversal rejection, symlink escape guards, session allowlisting for native dialogs & drag-and-drop paths, and dynamic runtime Tauri asset protocol scoping. |

---

## Architecture

Composer separates native desktop operations in Rust from the React UI through a typed IPC boundary:

```text
┌──────────────────────────────────────────────────────────────────────┐
│                             React 19 UI                              │
│  Overview · Explorer · Media Compare · Monaco · Palette · Settings   │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ Typed IPC Boundary (src/lib/api.ts)
┌──────────────────────────────────▼───────────────────────────────────┐
│                         Tauri 2 Native Core                          │
│  Sandboxed File Ops · Worktrees · Config · Telemetry · Search Index  │
└──────────────────────────────────────────────────────────────────────┘
```

- **Frontend API Boundary (`src/lib/api.ts`)**: Centralizes Tauri `invoke` calls into typed Promise helpers backed by interfaces in `src/types.ts`.
- **Sandboxed File Operations (`src-tauri/src/file_ops.rs`)**: Validates every path via canonicalization against the active workspace root, indexes workspace files/stats, performs deterministic search, and executes atomic writes.
- **Session Allowlist & Runtime Asset Scope (`src-tauri/src/session.rs`, `src-tauri/src/lib.rs`)**: Tracks user-picked and dropped paths and updates Tauri's runtime asset protocol scope dynamically on workspace switches.
- **Worktree & Config Persistence (`src-tauri/src/worktrees.rs`, `src-tauri/src/config.rs`)**: Persists workspace config, custom themes, TOML import/export, and `<workspace>/.composer/worktrees.json` metadata safely.

---

## Keyboard shortcuts

| Shortcut | Context | Action |
| --- | --- | --- |
| `Ctrl/Cmd + K` | Global | Open / toggle Command Palette & Quick Search |
| `Ctrl/Cmd + F` | Global | Focus Explorer / Home search |
| `Ctrl/Cmd + R` / `F5` | Global | Reload interface |
| `F11` | Global | Toggle fullscreen window |
| `Esc` | Global | Close dialogs, menus, pickers, or Command Palette |
| `Ctrl/Cmd + S` | Explorer | Save active file (atomic write) |
| `Ctrl/Cmd + W` | Explorer | Close active editor tab |
| `Ctrl/Cmd + N` | Explorer | Create new file |
| `Ctrl/Cmd + A` | Explorer | Select all files in current directory |
| `F2` | Explorer | Rename selected item or active tab |
| `Delete` | Explorer | Delete selected item(s) with confirmation |
| `Ctrl + +/-/0/1` | Image Viewer | Zoom in, zoom out, fit to view, actual size (100%) |
| `R` / `Shift + R` | Image Viewer | Rotate clockwise / counter-clockwise |
| `H` / `V` / `I` | Image Viewer | Flip horizontal / flip vertical / toggle eyedropper |
| `Ctrl/Cmd + P` | Markdown Preview | Open print & save dialog |
| `Mouse Back / Fwd` | Window | Navigate previous / next top-level page |

---

## Technology

| Layer | Stack |
| --- | --- |
| Desktop shell | Tauri 2 (`@tauri-apps/api`, dialog, opener, process, updater plugins) |
| Native backend | Rust 2021 (`serde`, `serde_json`, `toml`, `sys-info`, `base64`) |
| UI Framework | React 19 + TypeScript 5.8 (Strict) |
| Build Tool | Vite 7 |
| Styling & Components | Tailwind CSS 4, CSS Design Tokens, Glassmorphism, `GhostFibers`, `GlideSelect` |
| Icons | `lucide-react`, `@hugeicons/react` |
| Editor | `monaco-editor` (lazy-loaded with self-hosted workers) |
| Previews & PDF | `pdfjs-dist`, `pdf-lib`, `DOMPurify`, `marked` |

---

## Run locally

### Requirements

- Node.js (v20 or v22 recommended) & npm
- Rust stable & Cargo
- Platform prerequisites from the [Tauri setup guide](https://tauri.app/start/prerequisites/)

### Setup & Development

```bash
git clone https://github.com/zishan049/Composer.git
cd Composer
npm install
npm run dev
```

To launch the native desktop application in development mode with Tauri:

```bash
npm run tauri dev
```

To build the production bundle:

```bash
npm run build
```

### Verification Checks

```bash
# Typecheck
npm run typecheck

# Frontend unit tests
npm test

# Rust checks
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## Privacy & Network

Composer is local-first. File editing, search indexing, previews, image/SVG comparison, and worktree management happen entirely offline on your machine. Optional update checks configured in **Settings** query GitHub Releases tags (`endpoints` configured in `src-tauri/tauri.conf.json`).

---

## License

Licensing terms will be specified upon public release. All rights reserved.
