// Side-effect module: self-hosts the Monaco core so @monaco-editor/react
// never fetches it from the jsdelivr CDN at runtime (PERF-3 — the editor
// must work offline in the desktop app).
//
// Import this module once from any component that mounts the editor
// (e.g. `import "../lib/monacoSetup";` in Explorer.tsx). Do NOT import it
// from vite.config.ts or an entry file — pulling in the whole Monaco core
// should stay tied to the lazy editor chunks.

import * as monaco from "monaco-editor";
// Subpaths are exports-map compliant (monaco-editor's "exports" maps "./*" to
// "./esm/vs/*.js", so the specifier must NOT repeat the esm/vs prefix).
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { loader } from "@monaco-editor/react";

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });
