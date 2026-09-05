import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@monaco-editor")) {
            return "vendor-monaco";
          }
          if (id.includes("pdfjs-dist") || id.includes("pdf-lib") || id.includes("jspdf")) {
            return "vendor-pdf";
          }
          if (id.includes("marked") || id.includes("dompurify")) {
            return "vendor-markdown";
          }
          if (id.includes("lucide-react") || id.includes("framer-motion")) {
            return "vendor-ui";
          }
        },
      },
    },
  },
}));
