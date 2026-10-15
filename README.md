<div align="center">

<img src="src-tauri/icons/icon.ico" alt="Composer app icon" width="88" height="88" />

# Composer

### A quiet, local-first workspace for creating and editing.

One desktop studio for code, Markdown, PDFs, SVGs, images, and structured data — built to keep your work on your machine.

<br />

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111827)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-8B9AAB?style=flat-square)](LICENSE)

**[Download for Windows](https://github.com/zishan049/Composer/releases/latest)** · **[Explore the source](https://github.com/zishan049/Composer)** · **[Report a bug](https://github.com/zishan049/Composer/issues)**

</div>

---

## The idea

Creative and technical work often means bouncing between a code editor, a Markdown previewer, a PDF tool, and an image utility. Composer brings those everyday tools into one focused desktop workspace.

It is built with **Tauri 2, Rust, React, and TypeScript**: a native desktop shell with a modern web UI, local file workflows, and a deliberately customizable interface.

> **Your workspace. Your files. Your machine.**

## What you can do

| Studio | What it's for |
| --- | --- |
| **Code** | Edit source files with Monaco, syntax highlighting, multi-tab workflows, Vim keybindings, and save support. |
| **Markdown** | Write and preview Markdown, switch between code/split/preview modes, and prepare print-ready documents. |
| **PDF** | Inspect PDFs and edit supported text directly on the page canvas. |
| **SVG** | Inspect vector artwork, edit XML, and see changes in a live preview. |
| **Images** | Zoom, rotate, flip, inspect metadata, and sample exact pixel colors. |
| **Data** | Work with supported structured and tabular files in code or grid views. |
| **Workspace** | Browse local folders, search for files, revisit recent work, and use quick actions. |
| **Appearance** | Personalize themes, typography, accent colors, and navigation layouts. |

## Interface

Composer is designed around a minimal, editorial interface: restrained surfaces, readable typography, compact navigation, and themes that can adapt to your workflow.

<!--
Add genuine screenshots captured from the running application here.
Recommended files:
  docs/screenshots/home.png
  docs/screenshots/code-studio.png
  docs/screenshots/markdown-studio.png
  docs/screenshots/pdf-studio.png

Capture at a consistent desktop viewport and use the real app UI; do not substitute concept art for application screenshots.
-->

*Screenshots will be added after capturing the current application build so the README reflects the actual UI, not mockups.*

## Why Composer

- **Local-first workflow** — work with files on your machine instead of relying on a cloud workspace.
- **Multiple tools, one workspace** — move between code, documents, vector graphics, images, and data without changing apps.
- **A UI you can make yours** — choose from curated palettes, typography presets, and navigation layouts.
- **Native desktop foundation** — Tauri and Rust power the desktop shell and filesystem operations.
- **Keyboard-friendly** — global search and familiar editing shortcuts keep common actions close at hand.

> Privacy note: Composer is designed for local workflows. Review the source code and the permissions of any installed build to verify the behavior that matters to you. Some optional features, such as dynamically loaded fonts or update checks, may use network access.

## Get started

### Download the app

The latest published Windows installer is available from **[GitHub Releases](https://github.com/zishan049/Composer/releases/latest)**.

1. Download the latest `.exe` installer from the release assets.
2. Run the installer and follow the prompts.
3. Launch Composer and choose your workspace during setup.

### Run from source

#### Prerequisites

- Node.js 20 or 22
- npm
- Rust and Cargo
- Platform-specific Tauri build prerequisites ([Tauri setup guide](https://tauri.app/start/prerequisites/))

#### Development

```bash
git clone https://github.com/zishan049/Composer.git
cd Composer
npm install
npm run tauri dev
```

#### Production build

```bash
npm run tauri build
```

Build artifacts are produced under `src-tauri/target/release/bundle/`.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + K` | Open quick search |
| `Ctrl/Cmd + S` | Save the active document |
| `Ctrl/Cmd + F` | Focus file search |
| `F11` | Toggle fullscreen |
| `Esc` | Close the active dialog or overlay |

Shortcut behavior can vary by view and platform.

## Built with

| Layer | Technology |
| --- | --- |
| Desktop runtime | Tauri 2 |
| Native backend | Rust 2021 |
| UI | React 19 + TypeScript |
| Build tooling | Vite 7 |
| Styling | Tailwind CSS 4 + modular CSS |
| Code editing | Monaco Editor |
| PDF processing | PDF.js + pdf-lib |

## Project structure

```text
Composer/
├── .github/          # CI and release workflows
├── public/           # Static assets
├── src/
│   ├── components/   # Studio views and shared UI
│   ├── styles/       # Design tokens and modular styles
│   ├── utils/        # Client-side utilities
│   ├── App.tsx       # Application shell and navigation
│   └── types.ts      # Shared TypeScript types
├── src-tauri/
│   └── src/          # Rust commands and native file operations
├── PRD.md            # Product requirements
└── package.json      # Dependencies and scripts
```

## Roadmap

- [x] Unified desktop workspace for supported creative and technical file types
- [x] Local file explorer and quick search
- [x] Code, Markdown, PDF, SVG, image, and structured-data workflows
- [x] Customizable themes and navigation layouts
- [ ] Add screenshots captured from the current app build
- [ ] Expand automated tests and cross-platform release coverage

## Contributing

Ideas, bug reports, and thoughtful improvements are welcome.

1. Check the existing issues before opening a new one.
2. Include clear reproduction steps for bugs.
3. Keep changes focused and consistent with the project's local-first, minimal design direction.

Open an issue on **[GitHub](https://github.com/zishan049/Composer/issues)** to get started.

## License

Composer is distributed under the [MIT License](LICENSE).

---

<div align="center">

**Made for focused work. Built to stay out of the way.**

<sub>If Composer is useful to you, consider giving the project a ⭐ on GitHub.</sub>

</div>
