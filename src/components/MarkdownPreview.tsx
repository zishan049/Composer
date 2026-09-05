// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Marked, marked } from "marked";
import DOMPurify from "dompurify";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  List,
  Type,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Copy,
  Check,
  Printer,
  FileText,
  Clock,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Info,
  Lightbulb,
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  Hash,
  Sparkles,
  AlignLeft,
  Maximize2,
  Minimize2,
  X,
  Download,
  Sliders,
  CheckCircle2,
  FileDown
} from "lucide-react";

interface MarkdownPreviewProps {
  content: string;
  fileName?: string;
  filePath?: string;
  workspaceRoot?: string;
  className?: string;
}

interface TocItem {
  id: string;
  text: string;
  level: number;
}

export interface PrintConfig {
  customTitle: string;
  pageSize: "A4" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";
  margins: "normal" | "narrow" | "wide";
  font: "serif" | "sans" | "mono";
  fontSize: "sm" | "base" | "lg";
  theme: "white" | "editorial" | "monochrome";
  includeHeader: boolean;
  includeFooter: boolean;
  includeToc: boolean;
  enableDropCap: boolean;
}

type TypographyFont = "serif" | "sans" | "mono";
type FontSize = "sm" | "base" | "lg" | "xl";

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  fileName = "Document.md",
  filePath = "",
  workspaceRoot = "",
  className = ""
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const printPreviewRef = useRef<HTMLDivElement>(null);
  const [showToc, setShowToc] = useState<boolean>(false);
  const [showTypographyMenu, setShowTypographyMenu] = useState<boolean>(false);
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const [fontFamily, setFontFamily] = useState<TypographyFont>("serif");
  const [fontSize, setFontSize] = useState<FontSize>("base");
  const [enableDropCap, setEnableDropCap] = useState<boolean>(true);
  const [isFullWidth, setIsFullWidth] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; icon?: React.ReactNode } | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  const [printConfig, setPrintConfig] = useState<PrintConfig>({
    customTitle: fileName.replace(/\.md$/i, ""),
    pageSize: "A4",
    orientation: "portrait",
    margins: "normal",
    font: fontFamily,
    fontSize: fontSize === "xl" ? "lg" : fontSize,
    theme: "white",
    includeHeader: true,
    includeFooter: true,
    includeToc: false,
    enableDropCap: enableDropCap
  });

  useEffect(() => {
    setPrintConfig(prev => ({
      ...prev,
      customTitle: fileName.replace(/\.md$/i, "")
    }));
  }, [fileName]);

  const showToast = useCallback((message: string, icon?: React.ReactNode) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, icon });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 2200);
  }, []);

  // Compute base folder for relative asset resolution
  const fileDir = useMemo(() => {
    if (filePath) {
      const normalized = filePath.replace(/\\/g, "/");
      const idx = normalized.lastIndexOf("/");
      if (idx !== -1) return normalized.substring(0, idx);
    }
    if (workspaceRoot) {
      return workspaceRoot.replace(/\\/g, "/");
    }
    return "";
  }, [filePath, workspaceRoot]);

  // Helper to resolve relative image path to local Tauri asset URL
  const resolveAssetSrc = useCallback((src: string): string => {
    if (!src) return src;
    const trimmed = src.trim();
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("blob:")
    ) {
      return trimmed;
    }

    // Relative path resolution
    let cleanPath = trimmed.replace(/^(\.\/|\/)/, "");
    let fullPath = "";
    if (fileDir) {
      fullPath = `${fileDir}/${cleanPath}`;
    } else if (workspaceRoot) {
      const cleanRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "");
      fullPath = `${cleanRoot}/${cleanPath}`;
    }

    if (fullPath) {
      try {
        return convertFileSrc(fullPath);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }, [fileDir, workspaceRoot]);

  // Debounced content to prevent synchronous AST parsing and DOMPurify on every single keystroke
  const [debouncedContent, setDebouncedContent] = useState<string>(content);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedContent(content);
    }, 200);
    return () => clearTimeout(timer);
  }, [content]);

  // Extract Document Outline / Table of Contents
  const tocItems = useMemo<TocItem[]>(() => {
    if (!debouncedContent) return [];
    const items: TocItem[] = [];
    const lines = debouncedContent.split("\n");
    let insideCodeBlock = false;

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        insideCodeBlock = !insideCodeBlock;
        continue;
      }
      if (insideCodeBlock) continue;

      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const rawText = match[2]
          .replace(/<[^>]+>/g, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/[*_`~]/g, "")
          .trim();

        const id = rawText
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-");

        if (rawText) {
          items.push({ id, text: rawText, level });
        }
      }
    }
    return items;
  }, [debouncedContent]);

  // Calculate Reading Stats
  const stats = useMemo(() => {
    const textOnly = debouncedContent
      .replace(/```[\s\S]*?```/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const words = textOnly.trim().split(/\s+/).filter(Boolean).length;
    const readingTime = Math.max(1, Math.ceil(words / 200));
    const chars = debouncedContent.length;
    const headings = tocItems.length;
    return { words, readingTime, chars, headings };
  }, [debouncedContent, tocItems]);

  // Memoize markedInstance so renderer plugins are configured once, not per keystroke
  const markedInstance = useMemo(() => {
    const inst = typeof Marked === "function"
      ? new Marked({ gfm: true, breaks: true })
      : marked;

    if (inst && typeof inst.use === "function") {
      inst.use({
        renderer: {
          heading(arg, depth, raw) {
            const token = typeof arg === "object" && arg !== null ? arg : { text: arg, depth, raw };
            const textVal = token.text || "";
            const depthVal = token.depth || 1;
            const rawText = textVal
              .replace(/<[^>]+>/g, "")
              .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
              .replace(/[*_`~]/g, "")
              .trim();

            const slug = rawText
              .toLowerCase()
              .replace(/[^\w\s-]/g, "")
              .trim()
              .replace(/\s+/g, "-");

            return `
              <div class="md-heading-container group" id="${slug}">
                <h${depthVal} class="font-serif-display font-bold tracking-tight">
                  ${textVal}
                </h${depthVal}>
                <a href="#${slug}" class="md-heading-anchor" title="Direct link to ${rawText}">#</a>
              </div>
            `;
          },

          image(arg, title, text) {
            const token = typeof arg === "object" && arg !== null ? arg : { href: arg, title, text };
            const resolvedHref = resolveAssetSrc(token.href || "");
            const titleAttr = token.title ? `title="${token.title}"` : "";
            const altAttr = token.text ? `alt="${token.text}"` : 'alt=""';
            return `<img src="${resolvedHref}" ${altAttr} ${titleAttr} loading="lazy" onerror="this.onerror=null; this.classList.add('opacity-40'); this.title='Image failed to load: ' + this.getAttribute('src');" />`;
          },

          link(arg, title, text) {
            const token = typeof arg === "object" && arg !== null ? arg : { href: arg, title, text };
            const hrefVal = token.href || "";
            const isExternal = hrefVal.startsWith("http://") || hrefVal.startsWith("https://") || hrefVal.startsWith("mailto:");
            const titleAttr = token.title ? `title="${token.title}"` : "";
            const textVal = token.text || hrefVal;
            if (isExternal) {
              return `<a href="${hrefVal}" ${titleAttr} data-external="true" target="_blank" rel="noopener noreferrer">${textVal}</a>`;
            }
            return `<a href="${hrefVal}" ${titleAttr}>${textVal}</a>`;
          },

          code(arg, lang) {
            const token = typeof arg === "object" && arg !== null ? arg : { text: arg, lang };
            const codeText = token.text || "";
            const language = (token.lang || "text").toLowerCase();
            const escapedCode = encodeURIComponent(codeText);
            return `
              <div class="my-4 rounded border border-rule/70 bg-cream/20 overflow-hidden shadow-xs relative group/code">
                <div class="px-3 py-1.5 bg-cream/40 border-b border-rule/50 flex items-center justify-between text-[11px] font-sans-meta text-muted">
                  <span class="font-mono uppercase font-bold tracking-wider text-accent text-[10px]">${language}</span>
                  <button 
                    type="button" 
                    class="code-copy-btn p-1 px-2 rounded hover:bg-cream hover:text-ink text-muted transition-colors flex items-center gap-1 text-[10px] font-semibold cursor-pointer"
                    data-code="${escapedCode}"
                    title="Copy code block"
                  >
                    <span>Copy</span>
                  </button>
                </div>
                <pre class="p-3.5 overflow-x-auto text-[12.5px] font-mono leading-relaxed bg-paper/60 select-text"><code>${codeText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>
              </div>
            `;
          }
        }
      });
    }
    return inst;
  }, [resolveAssetSrc]);

  // Configure Marked with custom renderers and parse markdown
  const renderedHtml = useMemo(() => {
    if (!debouncedContent) return "";

    try {

      // Pre-process raw <img> tags inside HTML to resolve relative paths
      let processedContent = debouncedContent.replace(
        /<img\s+([^>]*?)src=["']([^"']+)["']([^>]*)>/gi,
        (match, prefix, src, suffix) => {
          const resolved = resolveAssetSrc(src);
          return `<img ${prefix}src="${resolved}"${suffix}>`;
        }
      );

      // Parse with marked safely
      let rawHtml = "";
      if (markedInstance && typeof markedInstance.parse === "function") {
        rawHtml = markedInstance.parse(processedContent) as string;
      } else if (typeof marked?.parse === "function") {
        rawHtml = marked.parse(processedContent) as string;
      } else if (typeof marked === "function") {
        rawHtml = marked(processedContent) as string;
      } else {
        rawHtml = processedContent;
      }

      // Transform GitHub Alerts: [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]
      rawHtml = rawHtml.replace(
        /<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?([\s\S]*?)<\/p>\s*<\/blockquote>/gi,
        (match, type, body) => {
          const alertType = type.toLowerCase();
          const titles: Record<string, string> = {
            note: "Note",
            tip: "Tip",
            important: "Important",
            warning: "Warning",
            caution: "Caution"
          };
          return `
            <div class="md-alert md-alert-${alertType}">
              <div class="md-alert-title">
                <span>${titles[alertType] || type}</span>
              </div>
              <div class="text-ink/90 text-sm leading-relaxed">${body}</div>
            </div>
          `;
        }
      );

      // Sanitize with DOMPurify safely
      let clean = rawHtml;
      try {
        const purifyInstance = typeof DOMPurify?.sanitize === "function" 
          ? DOMPurify 
          : typeof DOMPurify === "function" 
          ? DOMPurify(window) 
          : null;

        if (purifyInstance && typeof purifyInstance.sanitize === "function") {
          clean = purifyInstance.sanitize(rawHtml, {
            ADD_TAGS: ["iframe"],
            ADD_ATTR: ["target", "rel", "align", "data-code", "data-external", "onerror", "loading"],
            FORBID_TAGS: ["script"],
            FORBID_ATTR: ["onload"]
          });
        }
      } catch (purifyErr) {
        console.warn("DOMPurify sanitize warning:", purifyErr);
      }

      return clean;
    } catch (err: any) {
      return `<div class="p-4 text-red-600 font-mono text-xs">Failed to render Markdown: ${err.message}</div>`;
    }
  }, [debouncedContent, resolveAssetSrc, markedInstance]);

  // Click delegation for links and code copy buttons
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check for code copy button
      const copyBtn = target.closest(".code-copy-btn");
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const rawEncoded = copyBtn.getAttribute("data-code");
        if (rawEncoded) {
          try {
            const decoded = decodeURIComponent(rawEncoded);
            await navigator.clipboard.writeText(decoded);
            const labelSpan = copyBtn.querySelector("span");
            if (labelSpan) {
              const originalText = labelSpan.textContent;
              labelSpan.textContent = "Copied!";
              copyBtn.classList.add("text-accent", "font-bold");
              setTimeout(() => {
                labelSpan.textContent = originalText;
                copyBtn.classList.remove("text-accent", "font-bold");
              }, 2000);
            }
            showToast("Code copied to clipboard", <Check size={12} className="text-emerald-500" />);
          } catch (err) {
            console.error("Clipboard copy failed:", err);
          }
        }
        return;
      }

      // Check for anchor links or external links
      const link = target.closest("a");
      if (link) {
        const href = link.getAttribute("href");
        const isExternal = link.getAttribute("data-external") === "true";

        if (isExternal && href) {
          e.preventDefault();
          try {
            await openUrl(href);
          } catch (err) {
            window.open(href, "_blank");
          }
          return;
        }

        if (href?.startsWith("#")) {
          e.preventDefault();
          const targetId = href.substring(1);
          const targetElem = container.querySelector(`[id="${targetId}"]`);
          if (targetElem) {
            targetElem.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      }
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [showToast]);

  // Jump to TOC heading
  const scrollToHeading = (id: string) => {
    if (!containerRef.current) return;
    const targetElem = containerRef.current.querySelector(`[id="${id}"]`);
    if (targetElem) {
      targetElem.scrollIntoView({ behavior: "smooth", block: "start" });
      setShowToc(false);
    }
  };

  // Actions
  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(content);
      showToast("Raw Markdown copied", <Check size={12} className="text-emerald-500" />);
    } catch {
      showToast("Failed to copy", <AlertCircle size={12} className="text-red-500" />);
    }
  };

  const handleCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(renderedHtml);
      showToast("Rendered HTML copied", <Check size={12} className="text-emerald-500" />);
    } catch {
      showToast("Failed to copy HTML", <AlertCircle size={12} className="text-red-500" />);
    }
  };

  // Generate pure, self-contained printable HTML document
  const generatePrintableHtml = useCallback((config: PrintConfig): string => {
    const marginMap = {
      normal: "20mm 20mm",
      narrow: "10mm 10mm",
      wide: "30mm 30mm"
    };

    const fontMap = {
      serif: `"EB Garamond", Georgia, serif`,
      sans: `"Inter", system-ui, -apple-system, sans-serif`,
      mono: `"JetBrains Mono", monospace`
    };

    const headingFontMap = {
      serif: `"Playfair Display", Georgia, serif`,
      sans: `"Inter", system-ui, sans-serif`,
      mono: `"JetBrains Mono", monospace`
    };

    const sizeMap = {
      sm: "10pt",
      base: "11.5pt",
      lg: "13pt"
    };

    const themeColors = {
      white: { bg: "#ffffff", text: "#111111", muted: "#666666", rule: "#e5e5e5", accent: "#b8440c" },
      editorial: { bg: "#fbf8f2", text: "#18140f", muted: "#8a7f6e", rule: "#c9bfab", accent: "#b8440c" },
      monochrome: { bg: "#ffffff", text: "#000000", muted: "#444444", rule: "#cccccc", accent: "#000000" }
    };

    const colors = themeColors[config.theme] || themeColors.white;

    let tocHtml = "";
    if (config.includeToc && tocItems.length > 0) {
      tocHtml = `
        <div class="print-toc" style="margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 2px solid ${colors.rule}; page-break-after: avoid; break-after: avoid;">
          <h2 style="font-family: ${headingFontMap[config.font]}; font-size: 1.25rem; margin-top: 0; color: ${colors.accent};">Table of Contents</h2>
          <ul style="list-style: none; padding-left: 0; margin: 0.5rem 0 0 0; line-height: 1.8;">
            ${tocItems.map(item => `
              <li style="padding-left: ${(item.level - 1) * 16}px; font-size: 0.85rem; color: ${colors.muted};">
                <span style="color: ${colors.text};">${item.text}</span>
              </li>
            `).join("")}
          </ul>
        </div>
      `;
    }

    let headerHtml = "";
    if (config.includeHeader) {
      headerHtml = `
        <header class="print-header" style="border-bottom: 2px solid ${colors.rule}; padding-bottom: 0.75rem; margin-bottom: 1.8rem; display: flex; justify-content: space-between; align-items: flex-end; font-family: 'Inter', sans-serif; font-size: 8.5pt; color: ${colors.muted}; page-break-after: avoid; break-after: avoid;">
          <div>
            <h1 style="margin: 0; font-family: ${headingFontMap[config.font]}; font-size: 1.65rem; color: ${colors.text}; font-weight: 700; border: none; padding: 0;">${config.customTitle || fileName.replace(/\.md$/i, "")}</h1>
            <div style="margin-top: 4px; font-size: 8.5pt;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} • ${stats.words} words • ~${stats.readingTime} min read</div>
          </div>
          <div style="text-transform: uppercase; letter-spacing: 0.12em; font-size: 7.5pt; color: ${colors.accent}; font-weight: 700;">
            Composer Editorial
          </div>
        </header>
      `;
    }

    let footerHtml = "";
    if (config.includeFooter) {
      footerHtml = `
        <footer class="print-footer" style="margin-top: 3rem; padding-top: 0.75rem; border-top: 1px solid ${colors.rule}; display: flex; justify-content: space-between; font-family: 'Inter', sans-serif; font-size: 8pt; color: ${colors.muted}; page-break-inside: avoid; break-inside: avoid;">
          <span>Generated with Composer</span>
          <span>${config.customTitle || fileName}</span>
        </footer>
      `;
    }

    const dropCapCss = config.enableDropCap ? `
      p:not([align="center"]):first-of-type::first-letter {
        font-family: ${headingFontMap[config.font]};
        font-size: 3.4em;
        float: left;
        line-height: 0.75;
        margin-right: 0.12em;
        margin-top: 0.08em;
        color: ${colors.accent};
      }
    ` : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${config.customTitle || fileName.replace(/\.md$/i, "")}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..700;1,400..700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet">
  <style>
    @page {
      size: ${config.pageSize} ${config.orientation};
      margin: ${marginMap[config.margins] || "20mm 20mm"};
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      background-color: ${colors.bg};
      color: ${colors.text};
      font-family: ${fontMap[config.font]};
      font-size: ${sizeMap[config.fontSize]};
      line-height: 1.65;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: ${headingFontMap[config.font]};
      page-break-after: avoid;
      break-after: avoid;
      color: ${colors.text};
    }
    h1 { font-size: 2.1rem; border-bottom: 1px solid ${colors.rule}; padding-bottom: 0.35rem; margin-top: 1.5rem; margin-bottom: 0.9rem; }
    h2 { font-size: 1.5rem; border-bottom: 1px solid ${colors.rule}; padding-bottom: 0.25rem; margin-top: 1.35rem; margin-bottom: 0.7rem; }
    h3 { font-size: 1.25rem; margin-top: 1.15rem; margin-bottom: 0.45rem; }
    h4, h5, h6 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: ${colors.accent}; }
    p { margin: 0.75rem 0; line-height: 1.65; }
    [align="center"] { text-align: center; }
    [align="center"] > * { margin-left: auto; margin-right: auto; }
    img { max-width: 100%; height: auto; page-break-inside: avoid; break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; margin: 1.2rem 0; font-size: 0.9em; page-break-inside: avoid; break-inside: avoid; border: 1px solid ${colors.rule}; }
    th { background-color: ${colors.bg === '#ffffff' ? '#f4f4f4' : '#eee8db'}; border: 1px solid ${colors.rule}; padding: 0.5rem 0.75rem; font-weight: 700; text-align: left; }
    td { border: 1px solid ${colors.rule}; padding: 0.45rem 0.75rem; }
    pre { background-color: #f8f8f8; border: 1px solid ${colors.rule}; padding: 0.75rem 1rem; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 0.85em; overflow-x: auto; page-break-inside: avoid; break-inside: avoid; }
    code { font-family: 'JetBrains Mono', monospace; font-size: 0.85em; background: rgba(0,0,0,0.05); padding: 0.1em 0.3em; border-radius: 2px; }
    pre code { background: transparent; padding: 0; }
    blockquote { border-left: 3px solid ${colors.accent}; margin: 1rem 0; padding: 0.5rem 1rem; background: rgba(0,0,0,0.02); font-style: italic; page-break-inside: avoid; break-inside: avoid; }
    .md-alert { border-left: 4px solid; padding: 0.75rem 1rem; margin: 1rem 0; border-radius: 3px; page-break-inside: avoid; break-inside: avoid; }
    .md-alert-note { border-color: #2563eb; background: rgba(37, 99, 235, 0.05); }
    .md-alert-tip { border-color: #059669; background: rgba(5, 150, 105, 0.05); }
    .md-alert-important { border-color: #7c3aed; background: rgba(124, 58, 237, 0.05); }
    .md-alert-warning { border-color: #d97706; background: rgba(217, 119, 6, 0.05); }
    .md-alert-caution { border-color: #dc2626; background: rgba(220, 38, 38, 0.05); }
    .md-alert-title { font-weight: bold; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; margin-bottom: 0.3rem; font-family: 'Inter', sans-serif; }
    a { color: ${colors.accent}; text-decoration: underline; }
    .code-copy-btn, .md-heading-anchor { display: none !important; }
    ${dropCapCss}
  </style>
</head>
<body>
  ${headerHtml}
  ${tocHtml}
  <article class="print-article">
    ${renderedHtml}
  </article>
  ${footerHtml}
</body>
</html>`;
  }, [renderedHtml, tocItems, fileName, stats]);

  // Execute isolated print via dedicated hidden iframe (ONLY prints document content)
  const executeIsolatedPrint = useCallback((config: PrintConfig) => {
    const oldIframe = document.getElementById("composer-print-iframe");
    if (oldIframe) oldIframe.remove();

    const iframe = document.createElement("iframe");
    iframe.id = "composer-print-iframe";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    const fullHtml = generatePrintableHtml(config);
    doc.open();
    doc.write(fullHtml);
    doc.close();

    showToast("Opening Windows Print & Save...", <Printer size={12} className="text-accent" />);

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setShowPrintModal(false);
    }, 350);
  }, [generatePrintableHtml, showToast]);

  // Download complete standalone HTML
  const downloadStandaloneHtml = useCallback((config: PrintConfig) => {
    const fullHtml = generatePrintableHtml(config);
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(config.customTitle || fileName.replace(/\.md$/i, "")).trim()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("HTML document downloaded", <Check size={12} className="text-emerald-500" />);
  }, [generatePrintableHtml, fileName, showToast]);

  // Copy complete standalone HTML
  const copyPrintableHtml = useCallback(async (config: PrintConfig) => {
    const fullHtml = generatePrintableHtml(config);
    try {
      await navigator.clipboard.writeText(fullHtml);
      showToast("Printable HTML copied", <Check size={12} className="text-emerald-500" />);
    } catch {
      showToast("Failed to copy HTML", <AlertCircle size={12} className="text-red-500" />);
    }
  }, [generatePrintableHtml, showToast]);

  const handlePrint = () => {
    executeIsolatedPrint({
      ...printConfig,
      font: fontFamily,
      enableDropCap: enableDropCap
    });
  };

  // Keyboard shortcut: Ctrl+P triggers direct Windows Print & Save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        executeIsolatedPrint({
          ...printConfig,
          font: fontFamily,
          enableDropCap: enableDropCap
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [executeIsolatedPrint, printConfig, fontFamily, enableDropCap]);

  // Font styling resolution
  const fontClass =
    fontFamily === "serif"
      ? "font-serif-text"
      : fontFamily === "sans"
      ? "font-sans-meta"
      : "font-mono";

  const sizeClass =
    fontSize === "sm"
      ? "text-sm"
      : fontSize === "base"
      ? "text-[15.5px]"
      : fontSize === "lg"
      ? "text-[17px]"
      : "text-[19px]";

  return (
    <div className={`relative flex flex-col h-full w-full bg-paper overflow-hidden select-text ${className}`}>
      {/* Editorial Navigation & Controls Bar */}
      <div className="px-4 py-2 bg-cream/15 border-b border-rule flex items-center justify-between font-sans-meta text-xs select-none shrink-0 z-20">
        {/* Left: Document Info & Table of Contents Toggle */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-ink font-semibold">
            <BookOpen size={14} className="text-accent" />
            <span className="truncate max-w-50" title={fileName}>
              {fileName.replace(/\.md$/i, "")}
            </span>
          </div>

          <div className="h-3 w-px bg-rule/70" />

          {/* Table of Contents Button */}
          <button
            onClick={() => setShowToc(!showToc)}
            className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer ${
              showToc ? "bg-accent text-paper" : "text-muted hover:text-ink hover:bg-cream/50"
            }`}
            title="Table of Contents Outline"
          >
            <List size={13} />
            <span>Outline</span>
            {tocItems.length > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                showToc ? "bg-paper/20 text-paper" : "bg-cream text-muted"
              }`}>
                {tocItems.length}
              </span>
            )}
          </button>
        </div>

        {/* Center: Reading Stats Pill */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-0.5 rounded-full bg-cream/30 border border-rule/50 text-[10px] text-muted font-medium">
          <span className="flex items-center gap-1">
            <FileText size={11} className="text-accent/80" />
            {stats.words.toLocaleString()} words
          </span>
          <span className="text-rule">•</span>
          <span className="flex items-center gap-1">
            <Clock size={11} className="text-accent/80" />
            ~{stats.readingTime} min read
          </span>
        </div>

        {/* Right: Typography Controls & Quick Actions */}
        <div className="flex items-center gap-1.5">
          {/* Typography Dropdown Toggle */}
          <div className="relative">
            <button
              onClick={() => setShowTypographyMenu(!showTypographyMenu)}
              className={`p-1.5 rounded transition-colors text-muted hover:text-ink hover:bg-cream/50 flex items-center gap-1 cursor-pointer ${
                showTypographyMenu ? "text-accent bg-cream" : ""
              }`}
              title="Typography & Appearance"
            >
              <Type size={13} />
            </button>

            {/* Typography Popover */}
            {showTypographyMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-60 bg-paper border border-rule shadow-xl rounded p-3 z-30 flex flex-col gap-3 font-sans-meta text-xs">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted tracking-wider block mb-1.5">
                    Font Family
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      onClick={() => setFontFamily("serif")}
                      className={`px-2 py-1 rounded border text-[11px] font-serif cursor-pointer ${
                        fontFamily === "serif"
                          ? "border-accent bg-accent text-paper font-semibold"
                          : "border-rule/50 hover:bg-cream text-ink"
                      }`}
                    >
                      Serif
                    </button>
                    <button
                      onClick={() => setFontFamily("sans")}
                      className={`px-2 py-1 rounded border text-[11px] font-sans cursor-pointer ${
                        fontFamily === "sans"
                          ? "border-accent bg-accent text-paper font-semibold"
                          : "border-rule/50 hover:bg-cream text-ink"
                      }`}
                    >
                      Sans
                    </button>
                    <button
                      onClick={() => setFontFamily("mono")}
                      className={`px-2 py-1 rounded border text-[11px] font-mono cursor-pointer ${
                        fontFamily === "mono"
                          ? "border-accent bg-accent text-paper font-semibold"
                          : "border-rule/50 hover:bg-cream text-ink"
                      }`}
                    >
                      Mono
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-muted tracking-wider block mb-1.5">
                    Text Scale
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {(["sm", "base", "lg", "xl"] as FontSize[]).map((sz) => (
                      <button
                        key={sz}
                        onClick={() => setFontSize(sz)}
                        className={`px-2 py-1 rounded border text-[10px] uppercase font-semibold cursor-pointer ${
                          fontSize === sz
                            ? "border-accent bg-accent text-paper"
                            : "border-rule/50 hover:bg-cream text-ink"
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-rule/50 flex flex-col gap-1.5">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[11px] text-ink">Editorial Drop-Cap</span>
                    <input
                      type="checkbox"
                      checked={enableDropCap}
                      onChange={(e) => setEnableDropCap(e.target.checked)}
                      className="accent-accent cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[11px] text-ink">Full Width Layout</span>
                    <input
                      type="checkbox"
                      checked={isFullWidth}
                      onChange={(e) => setIsFullWidth(e.target.checked)}
                      className="accent-accent cursor-pointer"
                    />
                  </label>
                </div>

                <div className="pt-2 border-t border-rule/50">
                  <button
                    onClick={() => {
                      setShowTypographyMenu(false);
                      setShowPrintModal(true);
                    }}
                    className="w-full py-1.5 px-2 rounded bg-cream/60 hover:bg-cream text-ink text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    title="Customize print paper size, margins, and themes"
                  >
                    <Sliders size={12} className="text-accent" />
                    <span>Print Studio & Export...</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="h-3 w-px bg-rule/70" />

          {/* Copy Markdown */}
          <button
            onClick={handleCopyMarkdown}
            className="p-1.5 rounded transition-colors text-muted hover:text-ink hover:bg-cream/50 cursor-pointer"
            title="Copy Raw Markdown"
          >
            <Copy size={13} />
          </button>

          {/* Copy Rendered HTML */}
          <button
            onClick={handleCopyHtml}
            className="p-1.5 rounded transition-colors text-muted hover:text-ink hover:bg-cream/50 cursor-pointer"
            title="Copy Rendered HTML"
          >
            <Sparkles size={13} />
          </button>

          {/* One-Click Windows Print & Save */}
          <button
            onClick={handlePrint}
            className="p-1.5 rounded transition-colors text-muted hover:text-ink hover:bg-cream/50 cursor-pointer"
            title="Print or Save as PDF (Ctrl+P)"
          >
            <Printer size={13} />
          </button>
        </div>
      </div>

      {/* Main Workspace Frame */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Table of Contents Drawer */}
        {showToc && (
          <div className="w-64 bg-cream/25 border-r border-rule flex flex-col shrink-0 font-sans-meta z-10 animate-fadeInUp">
            <div className="p-3 bg-cream/40 border-b border-rule/60 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-bold text-accent flex items-center gap-1.5">
                <List size={12} />
                <span>Document Outline</span>
              </span>
              <span className="text-[10px] text-muted">{tocItems.length} headings</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {tocItems.length > 0 ? (
                tocItems.map((item, idx) => (
                  <button
                    key={`${item.id}-${idx}`}
                    onClick={() => scrollToHeading(item.id)}
                    style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
                    className="w-full text-left py-1.5 pr-2 rounded hover:bg-cream text-[11px] text-ink/80 hover:text-accent transition-colors flex items-center gap-1 truncate cursor-pointer"
                    title={item.text}
                  >
                    <span className="text-muted/60 text-[9px] font-mono shrink-0">H{item.level}</span>
                    <span className="truncate">{item.text}</span>
                  </button>
                ))
              ) : (
                <div className="p-4 text-center text-muted/60 text-xs italic">
                  No headings found in document
                </div>
              )}
            </div>
          </div>
        )}

        {/* Rendered Article Pane */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden p-6 sm:p-10 scroll-smooth"
        >
          <div
            className={`mx-auto transition-all ${
              isFullWidth ? "max-w-none" : "max-w-3xl"
            } ${fontClass} ${sizeClass} ${enableDropCap ? "drop-cap-enabled" : ""}`}
          >
            {/* Rendered HTML Container */}
            <div
              className="md-preview-prose leading-relaxed select-text"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        </div>
      </div>

      {/* Dedicated Print & Export Studio Modal */}
      {showPrintModal && (
        <div className="fixed inset-0 bg-ink/75 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-6 animate-fadeInUp select-none">
          <div className="bg-paper border border-rule rounded shadow-2xl w-full max-w-5xl h-[88vh] max-h-205 flex flex-col overflow-hidden font-sans-meta">
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-cream/35 border-b border-rule flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-accent text-paper">
                  <Printer size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-ink">Print & Export Studio</h3>
                  <div className="text-[10.5px] text-muted flex items-center gap-2">
                    <span>{fileName}</span>
                    <span>•</span>
                    <span>{stats.words} words</span>
                    <span>•</span>
                    <span>~{stats.readingTime} min read</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowPrintModal(false)}
                className="p-1.5 rounded hover:bg-cream text-muted hover:text-ink transition-colors cursor-pointer"
                title="Close dialog (Esc)"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body: Left Controls | Right Live Virtual Paper Preview */}
            <div className="flex-1 flex overflow-hidden divide-x divide-rule">
              {/* Left Column: Print Settings & Actions */}
              <div className="w-84 md:w-96 flex flex-col justify-between overflow-y-auto bg-cream/15 p-5 space-y-4 shrink-0 text-xs">
                <div className="space-y-4">
                  {/* Document Title Customization */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted tracking-wider block mb-1">
                      Document Title
                    </label>
                    <input
                      type="text"
                      value={printConfig.customTitle}
                      onChange={(e) => setPrintConfig({ ...printConfig, customTitle: e.target.value })}
                      placeholder="Document title on print..."
                      className="w-full px-2.5 py-1.5 bg-paper border border-rule rounded text-xs text-ink outline-none focus:border-accent"
                    />
                  </div>

                  {/* Page & Paper Layout */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted tracking-wider block mb-1.5">
                      Orientation & Paper
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 mb-2">
                      <button
                        onClick={() => setPrintConfig({ ...printConfig, orientation: "portrait" })}
                        className={`py-1.5 px-2 rounded border text-center font-semibold transition-all cursor-pointer ${
                          printConfig.orientation === "portrait"
                            ? "border-accent bg-accent text-paper"
                            : "border-rule/60 hover:bg-cream text-ink"
                        }`}
                      >
                        Portrait
                      </button>
                      <button
                        onClick={() => setPrintConfig({ ...printConfig, orientation: "landscape" })}
                        className={`py-1.5 px-2 rounded border text-center font-semibold transition-all cursor-pointer ${
                          printConfig.orientation === "landscape"
                            ? "border-accent bg-accent text-paper"
                            : "border-rule/60 hover:bg-cream text-ink"
                        }`}
                      >
                        Landscape
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-1 mb-2">
                      {(["A4", "Letter", "Legal"] as const).map((sz) => (
                        <button
                          key={sz}
                          onClick={() => setPrintConfig({ ...printConfig, pageSize: sz })}
                          className={`py-1 px-2 rounded border text-[10px] uppercase font-semibold text-center transition-all cursor-pointer ${
                            printConfig.pageSize === sz
                              ? "border-accent bg-accent text-paper"
                              : "border-rule/60 hover:bg-cream text-ink"
                          }`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="text-[10.5px] text-muted mr-1">Margins:</span>
                      {(["normal", "narrow", "wide"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setPrintConfig({ ...printConfig, margins: m })}
                          className={`flex-1 py-1 rounded border text-[10px] capitalize font-medium transition-all cursor-pointer ${
                            printConfig.margins === m
                              ? "border-accent bg-accent/15 text-accent font-bold"
                              : "border-rule/50 hover:bg-cream text-muted"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Typography & Styling */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted tracking-wider block mb-1.5">
                      Typography & Theme
                    </label>
                    <div className="grid grid-cols-3 gap-1 mb-2">
                      <button
                        onClick={() => setPrintConfig({ ...printConfig, font: "serif" })}
                        className={`py-1.5 px-2 rounded border text-[11px] font-serif transition-all cursor-pointer ${
                          printConfig.font === "serif"
                            ? "border-accent bg-accent text-paper font-semibold"
                            : "border-rule/60 hover:bg-cream text-ink"
                        }`}
                      >
                        Serif
                      </button>
                      <button
                        onClick={() => setPrintConfig({ ...printConfig, font: "sans" })}
                        className={`py-1.5 px-2 rounded border text-[11px] font-sans transition-all cursor-pointer ${
                          printConfig.font === "sans"
                            ? "border-accent bg-accent text-paper font-semibold"
                            : "border-rule/60 hover:bg-cream text-ink"
                        }`}
                      >
                        Sans
                      </button>
                      <button
                        onClick={() => setPrintConfig({ ...printConfig, font: "mono" })}
                        className={`py-1.5 px-2 rounded border text-[11px] font-mono transition-all cursor-pointer ${
                          printConfig.font === "mono"
                            ? "border-accent bg-accent text-paper font-semibold"
                            : "border-rule/60 hover:bg-cream text-ink"
                        }`}
                      >
                        Mono
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { id: "white", label: "Clean White" },
                        { id: "editorial", label: "Warm Print" },
                        { id: "monochrome", label: "B&W Mono" }
                      ].map((th) => (
                        <button
                          key={th.id}
                          onClick={() => setPrintConfig({ ...printConfig, theme: th.id as any })}
                          className={`py-1 px-1.5 rounded border text-[10px] font-medium transition-all cursor-pointer ${
                            printConfig.theme === th.id
                              ? "border-accent bg-accent/15 text-accent font-bold"
                              : "border-rule/50 hover:bg-cream text-muted"
                          }`}
                        >
                          {th.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Document Elements Toggles */}
                  <div className="pt-2 border-t border-rule/50 space-y-2">
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-[11px] text-ink">Include Header (Title & Date)</span>
                      <input
                        type="checkbox"
                        checked={printConfig.includeHeader}
                        onChange={(e) => setPrintConfig({ ...printConfig, includeHeader: e.target.checked })}
                        className="accent-accent cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-[11px] text-ink">Include Footer (Document Info)</span>
                      <input
                        type="checkbox"
                        checked={printConfig.includeFooter}
                        onChange={(e) => setPrintConfig({ ...printConfig, includeFooter: e.target.checked })}
                        className="accent-accent cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-[11px] text-ink">Include Table of Contents</span>
                      <input
                        type="checkbox"
                        checked={printConfig.includeToc}
                        onChange={(e) => setPrintConfig({ ...printConfig, includeToc: e.target.checked })}
                        className="accent-accent cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-[11px] text-ink">Editorial Opening Drop-Cap</span>
                      <input
                        type="checkbox"
                        checked={printConfig.enableDropCap}
                        onChange={(e) => setPrintConfig({ ...printConfig, enableDropCap: e.target.checked })}
                        className="accent-accent cursor-pointer"
                      />
                    </label>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-4 border-t border-rule/60 space-y-2">
                  <button
                    onClick={() => executeIsolatedPrint(printConfig)}
                    className="w-full py-2.5 px-4 bg-accent hover:bg-accent/90 text-paper font-bold rounded flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer text-xs"
                    title="Open Windows print & save dialog for this document"
                  >
                    <Printer size={15} />
                    <span>Print & Save (Windows Print)</span>
                  </button>

                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    <button
                      onClick={() => downloadStandaloneHtml(printConfig)}
                      className="py-1.5 px-2 border border-rule/70 hover:bg-cream text-muted hover:text-ink font-semibold rounded flex items-center justify-center gap-1 transition-colors cursor-pointer text-[10.5px]"
                      title="Download full standalone HTML with embedded styles"
                    >
                      <Download size={11} />
                      <span className="truncate">Save HTML</span>
                    </button>

                    <button
                      onClick={() => copyPrintableHtml(printConfig)}
                      className="py-1.5 px-2 border border-rule/70 hover:bg-cream text-muted hover:text-ink font-semibold rounded flex items-center justify-center gap-1 transition-colors cursor-pointer text-[10.5px]"
                      title="Copy complete printable HTML code"
                    >
                      <Copy size={11} />
                      <span className="truncate">Copy HTML</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Scaled Virtual Paper Preview */}
              <div className="flex-1 bg-cream/35 p-6 overflow-y-auto flex flex-col items-center select-text">
                <div className="w-full max-w-155 flex items-center justify-between mb-3 text-[10.5px] text-muted font-sans-meta">
                  <span className="uppercase tracking-wider font-bold text-accent">
                    Document Print Preview
                  </span>
                  <span className="bg-paper px-2 py-0.5 rounded border border-rule/50 font-mono text-[9.5px]">
                    {printConfig.pageSize} • {printConfig.orientation.toUpperCase()}
                  </span>
                </div>

                {/* Virtual Sheet of Paper */}
                <div
                  ref={printPreviewRef}
                  className={`print-paper-sheet theme-${printConfig.theme} w-full max-w-155 shadow-2xl transition-all border border-rule/60 mb-8 rounded-sm`}
                  style={{
                    padding:
                      printConfig.margins === "narrow"
                        ? "28px"
                        : printConfig.margins === "wide"
                        ? "56px"
                        : "42px",
                    fontFamily:
                      printConfig.font === "serif"
                        ? '"EB Garamond", Georgia, serif'
                        : printConfig.font === "sans"
                        ? '"Inter", sans-serif'
                        : '"JetBrains Mono", monospace',
                    fontSize:
                      printConfig.fontSize === "sm"
                        ? "11px"
                        : printConfig.fontSize === "lg"
                        ? "14px"
                        : "12.5px"
                  }}
                >
                  {/* Virtual Header */}
                  {printConfig.includeHeader && (
                    <div className="border-b-2 border-rule/70 pb-2.5 mb-5 flex justify-between items-end font-sans-meta text-[9.5px] text-muted">
                      <div>
                        <h2 className="text-lg font-bold text-ink m-0 font-serif-display leading-tight">
                          {printConfig.customTitle || fileName.replace(/\.md$/i, "")}
                        </h2>
                        <div className="text-[9px] text-muted mt-0.5">
                          {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} • {stats.words} words • ~{stats.readingTime} min read
                        </div>
                      </div>
                      <div className="text-[8px] uppercase tracking-wider font-bold text-accent">
                        Composer Document
                      </div>
                    </div>
                  )}

                  {/* Virtual TOC */}
                  {printConfig.includeToc && tocItems.length > 0 && (
                    <div className="mb-5 pb-3 border-b border-rule/60">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-accent mb-2">
                        Table of Contents
                      </h3>
                      <div className="space-y-1 text-[10.5px] text-muted">
                        {tocItems.slice(0, 12).map((it, idx) => (
                          <div key={idx} style={{ paddingLeft: `${(it.level - 1) * 12}px` }} className="flex justify-between">
                            <span className="text-ink/80">{it.text}</span>
                          </div>
                        ))}
                        {tocItems.length > 12 && (
                          <div className="italic text-[9.5px] text-muted/60 pt-1">+ {tocItems.length - 12} more sections...</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Virtual Document Body */}
                  <div
                    className={`md-preview-prose leading-relaxed select-text ${
                      printConfig.enableDropCap ? "drop-cap-enabled" : ""
                    }`}
                    dangerouslySetInnerHTML={{ __html: renderedHtml }}
                  />

                  {/* Virtual Footer */}
                  {printConfig.includeFooter && (
                    <div className="mt-8 pt-2.5 border-t border-rule/50 flex justify-between items-center text-[8.5px] text-muted font-sans-meta">
                      <span>Generated with Composer</span>
                      <span>{printConfig.customTitle || fileName}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div className="absolute bottom-4 right-4 bg-paper/95 backdrop-blur border border-rule shadow-lg rounded px-3 py-2 flex items-center gap-2 font-sans-meta text-xs text-ink z-50 animate-fadeInUp">
          {toast.icon}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};

export default MarkdownPreview;
