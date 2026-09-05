// @ts-nocheck
import React, { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { invoke } from "@tauri-apps/api/core";
import { Save, Loader } from "lucide-react";

// ─── Worker setup ────────────────────────────────────────────────────────────
// Vite bundles the worker script and gives us a URL we can point pdfjs at.
// @ts-ignore – Vite-specific ?url import
import PDFWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = PDFWorkerUrl;

// ─── Types ────────────────────────────────────────────────────────────────────
interface TextItem {
  str: string;
  /** canvas-space coords (px) */
  x: number;
  y: number;          // top of the bounding box
  width: number;
  height: number;
  fontSize: number;
  /** original PDF user-space transform [a,b,c,d,e,f] – used when saving */
  transform: number[];
  pageIndex: number;
  itemIndex: number;
}

interface PageData {
  pageIndex: number;
  viewportWidth: number;
  viewportHeight: number;
  /** keep a reference so PdfPage can render without re-fetching */
  pdfPage: PDFPageProxy;
  scale: number;
  textItems: TextItem[];
}

// ─── PdfPage ─────────────────────────────────────────────────────────────────
// Each page owns its own canvas. Rendering happens in a useEffect that fires
// after the canvas is mounted, so the ref is always valid.
interface PdfPageProps {
  data: PageData;
  edits: Record<string, string>;
  editKey: (pi: number, ii: number) => string;
  onTextChange: (pi: number, ii: number, v: string) => void;
}

const PdfPage: React.FC<PdfPageProps> = ({ data, edits, editKey, onTextChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const viewport = data.pdfPage.getViewport({ scale: data.scale });
      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx || cancelled) return;
      await data.pdfPage.render({ canvasContext: ctx, canvas, viewport }).promise;
    };
    render();
    return () => { cancelled = true; };
  }, [data]);

  return (
    <div
      className="relative shadow-2xl bg-white shrink-0"
      style={{ width: data.viewportWidth, height: data.viewportHeight }}
    >
      {/* The actual PDF render */}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", display: "block" }}
      />

      {/* Invisible text overlays – transparent until focused */}
      {data.textItems.map((item) => {
        const key = editKey(item.pageIndex, item.itemIndex);
        const value   = key in edits ? edits[key] : item.str;
        const isEdited = key in edits && edits[key] !== item.str;

        return (
          <textarea
            key={key}
            value={value}
            onChange={(e) => onTextChange(item.pageIndex, item.itemIndex, e.target.value)}
            spellCheck={false}
            title={item.str}
            style={{
              position:   "absolute",
              left:       item.x,
              top:        item.y,
              width:      item.width  + 8,
              height:     item.height + 2,
              fontSize:   item.fontSize,
              lineHeight: 1.2,
              fontFamily: "sans-serif",
              color:      "transparent",
              caretColor: "#1565C0",
              background: isEdited ? "rgba(255,220,80,0.40)" : "transparent",
              border:     isEdited ? "1px solid rgba(190,120,0,0.7)" : "1px solid transparent",
              outline:    "none",
              resize:     "none",
              overflow:   "hidden",
              padding:    "0 2px",
              margin:     0,
              zIndex:     10,
              cursor:     "text",
              boxSizing:  "border-box",
              borderRadius: "2px",
              whiteSpace: "nowrap",
            }}
            onFocus={(e) => {
              e.currentTarget.style.color      = "#111";
              e.currentTarget.style.background = "rgba(210,230,255,0.85)";
              e.currentTarget.style.border     = "1.5px solid rgba(25,118,210,0.9)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.color = "transparent";
              const ed = key in edits && edits[key] !== item.str;
              e.currentTarget.style.background = ed ? "rgba(255,220,80,0.40)" : "transparent";
              e.currentTarget.style.border     = ed ? "1px solid rgba(190,120,0,0.7)" : "1px solid transparent";
            }}
          />
        );
      })}
    </div>
  );
};

// ─── PdfEditor ────────────────────────────────────────────────────────────────
interface PdfEditorProps {
  filePath: string;
  base64DataUrl: string;
  onSaved?: (newBase64DataUrl: string) => void;
}

const PdfEditor: React.FC<PdfEditorProps> = ({ filePath, base64DataUrl, onSaved }) => {
  const SCALE = 1.5;
  const [pages,   setPages]   = useState<PageData[]>([]);
  const [edits,   setEdits]   = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const rawBytesRef = useRef<Uint8Array | null>(null);

  // ── decode helper ──────────────────────────────────────────────────────────
  const decodeBase64 = useCallback((dataUrl: string): Uint8Array => {
    const b64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
  }, []);

  // ── load PDF ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEdits({});
    setPages([]);

    (async () => {
      try {
        let pdf: PDFDocumentProxy;
        if (base64DataUrl.startsWith("asset:") || base64DataUrl.startsWith("http")) {
          pdf = await pdfjsLib.getDocument({ url: base64DataUrl }).promise;
          fetch(base64DataUrl)
            .then(res => res.arrayBuffer())
            .then(buf => { rawBytesRef.current = new Uint8Array(buf); })
            .catch(err => console.warn("Failed to cache raw bytes for editing:", err));
        } else {
          const bytes = decodeBase64(base64DataUrl);
          rawBytesRef.current = bytes;
          pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        }
        const result: PageData[] = [];

        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) return;
          const pdfPage  = await pdf.getPage(n);
          const viewport = pdfPage.getViewport({ scale: SCALE });
          const tc       = await pdfPage.getTextContent();

          const textItems: TextItem[] = [];
          (tc.items as any[]).forEach((item, idx) => {
            if (!item.str?.trim()) return;

            // Map PDF transform → canvas coords
            const tx       = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);  // robust extraction
            const x        = tx[4];
            const y        = tx[5] - fontSize;                            // top of text box
            const w        = Math.max((item.width ?? 0) * SCALE, 24);
            const h        = Math.max(fontSize * 1.3, 10);

            textItems.push({
              str:       item.str,
              x, y, width: w, height: h,
              fontSize:  Math.max(fontSize * 0.9, 7),
              transform: item.transform,
              pageIndex: n - 1,
              itemIndex: idx,
            });
          });

          result.push({
            pageIndex:      n - 1,
            viewportWidth:  viewport.width,
            viewportHeight: viewport.height,
            pdfPage,
            scale:          SCALE,
            textItems,
          });
        }

        if (!cancelled) {
          setPages(result);
          setLoading(false);
        }
      } catch (err) {
        console.error("PdfEditor load error:", err);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [base64DataUrl, decodeBase64]);

  // ── edit helpers ───────────────────────────────────────────────────────────
  const editKey = (pi: number, ii: number) => `${pi}:${ii}`;

  const handleTextChange = (pi: number, ii: number, v: string) =>
    setEdits(prev => ({ ...prev, [editKey(pi, ii)]: v }));

  // ── save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!rawBytesRef.current) {
      if (base64DataUrl.startsWith("asset:") || base64DataUrl.startsWith("http")) {
        try {
          const res = await fetch(base64DataUrl);
          const buf = await res.arrayBuffer();
          rawBytesRef.current = new Uint8Array(buf);
        } catch (e) {
          alert("Failed to load original PDF bytes for saving: " + e);
          return;
        }
      } else {
        return;
      }
    }
    setSaving(true);
    try {
      const pdfDoc   = await PDFDocument.load(rawBytesRef.current.slice(), { ignoreEncryption: true });
      const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pdfPages = pdfDoc.getPages();

      for (const page of pages) {
        const pdfPage = pdfPages[page.pageIndex];
        if (!pdfPage) continue;

        for (const item of page.textItems) {
          const key     = editKey(item.pageIndex, item.itemIndex);
          if (!(key in edits) || edits[key] === item.str) continue;
          const newText = edits[key];
          if (!newText.trim()) continue;

          // PDF user-space coords come directly from item.transform[4/5]
          const xPts       = item.transform[4];
          const yPts       = item.transform[5];
          const fsPts      = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);
          const widthPts   = item.width  / SCALE;
          const heightPts  = item.height / SCALE;

          // White-out original text
          pdfPage.drawRectangle({
            x: xPts - 1,
            y: yPts - 1,
            width:  widthPts + 4,
            height: Math.max(fsPts + 2, heightPts),
            color:  rgb(1, 1, 1),
          });

          // Draw new text
          pdfPage.drawText(newText, {
            x:        xPts,
            y:        yPts,
            size:     Math.max(fsPts, 6),
            font,
            color:    rgb(0, 0, 0),
            maxWidth: widthPts + 40,
          });
        }
      }

      const saved = await pdfDoc.save();
      // btoa on large buffers hits stack limits – use a chunked approach
      let b64 = "";
      const chunkSize = 8192;
      for (let i = 0; i < saved.length; i += chunkSize) {
        b64 += String.fromCharCode(...saved.subarray(i, i + chunkSize));
      }
      b64 = btoa(b64);
      const newDataUrl = `data:application/pdf;base64,${b64}`;

      await invoke("write_binary_file_base64", { filePath, base64Content: newDataUrl });

      rawBytesRef.current = saved;
      if (onSaved) onSaved(newDataUrl);
      setEdits({});
    } catch (err) {
      console.error("PDF save error:", err);
      alert("Save failed: " + err);
    } finally {
      setSaving(false);
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-paper">
        <div className="flex flex-col items-center gap-3">
          <Loader size={22} className="animate-spin text-accent" />
          <span className="font-sans-meta text-xs uppercase tracking-wider text-muted">
            Rendering PDF…
          </span>
        </div>
      </div>
    );
  }

  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#525659]">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-1.5 bg-[#323639] border-b border-white/10">
        <span className="font-sans-meta text-[10px] uppercase tracking-wider text-white/50">
          Click any text to edit it in-place
        </span>
        <button
          onClick={handleSave}
          disabled={!hasEdits || saving}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-sm font-sans-meta text-[10px] uppercase font-semibold transition-all
            ${hasEdits && !saving
              ? "bg-accent text-paper hover:bg-accent/90 cursor-pointer"
              : "bg-white/10 text-white/30 cursor-not-allowed"}`}
        >
          {saving ? <Loader size={10} className="animate-spin" /> : <Save size={10} />}
          <span>{saving ? "Saving…" : "Save Changes"}</span>
        </button>
      </div>

      {/* Pages */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center gap-8 py-8 px-4">
        {pages.length === 0 ? (
          <div className="text-white/40 font-sans-meta text-xs uppercase tracking-wider mt-16">
            No renderable pages found
          </div>
        ) : (
          pages.map((page) => (
            <PdfPage
              key={page.pageIndex}
              data={page}
              edits={edits}
              editKey={editKey}
              onTextChange={handleTextChange}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default PdfEditor;
