// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { 
  ZoomIn, ZoomOut, Maximize2, RotateCcw, Copy, Check, Download, 
  Sun, Moon, Grid, AlertCircle, CheckCircle2, Move, Sparkles
} from "lucide-react";

interface SvgPreviewProps {
  svgContent: string;
  fileName?: string;
  fileSize?: number;
  className?: string;
}

type BgMode = "grid" | "checker" | "paper" | "dark" | "light";

export const SvgPreview: React.FC<SvgPreviewProps> = ({
  svgContent,
  fileName = "image.svg",
  fileSize,
  className = ""
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [bgMode, setBgMode] = useState<BgMode>("grid");
  const [copied, setCopied] = useState<boolean>(false);
  const [xmlError, setXmlError] = useState<string | null>(null);
  const [activeBlobUrl, setActiveBlobUrl] = useState<string>("");
  const [dimensions, setDimensions] = useState<{ width?: number; height?: number; viewBox?: string }>({});
  const [elementCounts, setElementCounts] = useState<{ total: number; paths: number }>({ total: 0, paths: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const prevBlobUrlRef = useRef<string>("");

  // Parse, validate, and build isolated Blob URL
  useEffect(() => {
    if (!svgContent) return;

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgContent, "image/svg+xml");
      const parseErrorNode = doc.querySelector("parsererror");

      if (parseErrorNode) {
        // Subtle non-blocking warning; retain previous valid rendering
        setXmlError(parseErrorNode.textContent?.split("\n")[0] || "Invalid SVG XML");
        return;
      }

      setXmlError(null);

      const svgEl = doc.querySelector("svg");
      if (svgEl) {
        // Extract dimensions and viewBox
        const vb = svgEl.getAttribute("viewBox");
        let w = parseFloat(svgEl.getAttribute("width") || "0");
        let h = parseFloat(svgEl.getAttribute("height") || "0");

        if ((!w || !h) && vb) {
          const parts = vb.trim().split(/[\s,]+/).map(Number);
          if (parts.length === 4) {
            if (!w) w = parts[2];
            if (!h) h = parts[3];
          }
        }

        setDimensions({
          width: w > 0 ? Math.round(w) : undefined,
          height: h > 0 ? Math.round(h) : undefined,
          viewBox: vb || undefined,
        });

        setElementCounts({
          total: svgEl.querySelectorAll("*").length,
          paths: svgEl.querySelectorAll("path").length,
        });

        // Ensure proper namespaces for bulletproof image rendering
        if (!svgEl.getAttribute("xmlns")) {
          svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        }
        if (svgContent.includes("xlink:") && !svgEl.getAttribute("xmlns:xlink")) {
          svgEl.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
        }

        const serialized = new XMLSerializer().serializeToString(doc);
        const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
        const newUrl = URL.createObjectURL(blob);

        if (prevBlobUrlRef.current) {
          URL.revokeObjectURL(prevBlobUrlRef.current);
        }
        prevBlobUrlRef.current = newUrl;
        setActiveBlobUrl(newUrl);
      }
    } catch (e: any) {
      setXmlError(e.message || "Failed to parse SVG");
    }
  }, [svgContent]);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (prevBlobUrlRef.current) {
        URL.revokeObjectURL(prevBlobUrlRef.current);
      }
    };
  }, []);

  // Format file size
  const formattedSize = useMemo(() => {
    if (!fileSize) {
      const bytes = new Blob([svgContent]).size;
      if (bytes < 1024) return `${bytes} B`;
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (fileSize < 1024) return `${fileSize} B`;
    return `${(fileSize / 1024).toFixed(1)} KB`;
  }, [fileSize, svgContent]);

  // Zoom helpers
  const handleZoomIn = () => setZoom((z) => Math.min(5, Math.round((z + 0.25) * 100) / 100));
  const handleZoomOut = () => setZoom((z) => Math.max(0.2, Math.round((z - 0.25) * 100) / 100));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleFitToView = () => {
    if (!containerRef.current || !dimensions.width || !dimensions.height) {
      handleResetZoom();
      return;
    }
    const containerW = containerRef.current.clientWidth - 48; // padding
    const containerH = containerRef.current.clientHeight - 48;
    const scaleW = containerW / dimensions.width;
    const scaleH = containerH / dimensions.height;
    const fitScale = Math.min(scaleW, scaleH, 1);
    setZoom(Math.max(0.2, Math.round(fitScale * 100) / 100));
    setPan({ x: 0, y: 0 });
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((z) => Math.min(5, Math.max(0.2, Math.round((z + delta) * 100) / 100)));
    }
  };

  // Pan controls
  const handleMouseDown = (e: React.MouseEvent) => {
    // Left mouse click starts pan
    if (e.button === 0) {
      setIsPanning(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsPanning(false);

  // Copy SVG action
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(svgContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy SVG:", err);
    }
  };

  // Download SVG
  const handleDownload = () => {
    const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName.endsWith(".svg") ? fileName : `${fileName}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Background style computation using active theme paper base color
  const getBgStyle = () => {
    switch (bgMode) {
      case "grid":
      default:
        return {
          backgroundColor: "var(--theme-paper, #f6f2ea)",
          backgroundImage: `
            linear-gradient(to right, var(--theme-light-rule, rgba(128, 128, 128, 0.2)) 1px, transparent 1px),
            linear-gradient(to bottom, var(--theme-light-rule, rgba(128, 128, 128, 0.2)) 1px, transparent 1px)
          `,
          backgroundSize: "24px 24px",
          backgroundPosition: "-1px -1px"
        };
      case "checker":
        return {
          backgroundColor: "var(--theme-paper, #f6f2ea)",
          backgroundImage: `
            linear-gradient(45deg, var(--theme-cream, rgba(128, 128, 128, 0.15)) 25%, transparent 25%), 
            linear-gradient(-45deg, var(--theme-cream, rgba(128, 128, 128, 0.15)) 25%, transparent 25%), 
            linear-gradient(45deg, transparent 75%, var(--theme-cream, rgba(128, 128, 128, 0.15)) 75%), 
            linear-gradient(-45deg, transparent 75%, var(--theme-cream, rgba(128, 128, 128, 0.15)) 75%)
          `,
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px"
        };
      case "paper":
        return { backgroundColor: "var(--theme-paper, #f6f2ea)" };
      case "dark":
        return { backgroundColor: "#141417" };
      case "light":
        return { backgroundColor: "#ffffff" };
    }
  };

  return (
    <div className={`flex flex-col h-full w-full bg-paper overflow-hidden select-none ${className}`}>
      {/* Top Inspector & Toolbar */}
      <div className="px-3.5 py-1.5 bg-cream/30 border-b border-rule flex items-center justify-between font-sans-meta text-[11px] gap-2 shrink-0">
        {/* Left: Metadata & Validity */}
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex items-center gap-1.5 font-semibold text-accent uppercase tracking-wider text-[10px]">
            <Sparkles size={11} />
            <span>SVG Image</span>
          </div>

          {dimensions.width && dimensions.height ? (
            <span className="font-mono text-[10px] text-ink/70 px-1.5 py-0.5 bg-cream/70 rounded-sm border border-rule/50">
              {dimensions.width} × {dimensions.height} px
            </span>
          ) : dimensions.viewBox ? (
            <span className="font-mono text-[10px] text-ink/70 px-1.5 py-0.5 bg-cream/70 rounded-sm border border-rule/50">
              {dimensions.viewBox}
            </span>
          ) : null}

          <span className="font-mono text-[10px] text-muted">
            {formattedSize}
          </span>

          {elementCounts.paths > 0 && (
            <span className="hidden sm:inline-block text-[10px] text-muted/80">
              ({elementCounts.paths} {elementCounts.paths === 1 ? "path" : "paths"})
            </span>
          )}

          {xmlError ? (
            <div 
              className="flex items-center gap-1 text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-37.5"
              title={`SVG XML syntax warning: ${xmlError}`}
            >
              <AlertCircle size={10} className="shrink-0" />
              <span className="truncate">Syntax Warning</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px] font-medium">
              <CheckCircle2 size={10} className="shrink-0" />
              <span>Valid</span>
            </div>
          )}
        </div>

        {/* Right: Backgrounds & Zoom Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Background Modes */}
          <div className="flex items-center bg-cream/60 p-0.5 rounded border border-rule/50 gap-0.5">
            <button
              onClick={() => setBgMode("grid")}
              title="Theme Paper Grid (Default)"
              className={`p-1 rounded-sm transition-colors ${
                bgMode === "grid" ? "bg-accent text-paper" : "text-muted hover:text-ink"
              }`}
            >
              <Grid size={11} />
            </button>
            <button
              onClick={() => setBgMode("paper")}
              title="Theme Paper (Solid)"
              className={`px-1.5 py-0.5 text-[9px] uppercase font-bold rounded-sm transition-colors ${
                bgMode === "paper" ? "bg-accent text-paper" : "text-muted hover:text-ink"
              }`}
            >
              Paper
            </button>
            <button
              onClick={() => setBgMode("light")}
              title="Light Background"
              className={`p-1 rounded-sm transition-colors ${
                bgMode === "light" ? "bg-accent text-paper" : "text-muted hover:text-ink"
              }`}
            >
              <Sun size={11} />
            </button>
            <button
              onClick={() => setBgMode("dark")}
              title="Dark Background"
              className={`p-1 rounded-sm transition-colors ${
                bgMode === "dark" ? "bg-accent text-paper" : "text-muted hover:text-ink"
              }`}
            >
              <Moon size={11} />
            </button>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center bg-cream/60 p-0.5 rounded border border-rule/50 gap-0.5 font-mono text-[10px]">
            <button
              onClick={handleZoomOut}
              title="Zoom Out"
              className="p-1 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
            >
              <ZoomOut size={11} />
            </button>
            <button
              onClick={handleResetZoom}
              title="Click to Reset Zoom (100%)"
              className="px-1.5 py-0.5 text-center min-w-9.5 hover:text-accent font-semibold transition-colors"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              title="Zoom In"
              className="p-1 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
            >
              <ZoomIn size={11} />
            </button>
            <button
              onClick={handleFitToView}
              title="Fit to View"
              className="p-1 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
            >
              <Maximize2 size={11} />
            </button>
            <button
              onClick={handleResetZoom}
              title="Reset Position & Zoom"
              className="p-1 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
            >
              <RotateCcw size={11} />
            </button>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              title="Copy SVG XML"
              className="p-1.5 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors flex items-center gap-1 text-[10px] font-sans-meta uppercase font-semibold"
            >
              {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
              <span className="hidden md:inline">{copied ? "Copied" : "Copy"}</span>
            </button>
            <button
              onClick={handleDownload}
              title="Download SVG file"
              className="p-1.5 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
            >
              <Download size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive Canvas Area */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={getBgStyle()}
        className={`flex-1 relative overflow-hidden flex items-center justify-center ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        {activeBlobUrl ? (
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: isPanning ? "none" : "transform 0.12s ease-out",
            }}
            className="inline-block p-4 select-none pointer-events-none"
          >
            <div className="relative shadow-md rounded-sm border border-light-rule/40 overflow-hidden bg-transparent">
              <img
                src={activeBlobUrl}
                alt={fileName}
                draggable={false}
                style={{
                  maxWidth: dimensions.width ? `${dimensions.width}px` : "100%",
                  maxHeight: dimensions.height ? `${dimensions.height}px` : "75vh",
                  display: "block",
                }}
                className="object-contain"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-muted gap-2">
            <AlertCircle size={24} className="text-muted/60" />
            <span className="font-sans-meta text-xs">No SVG content to render</span>
          </div>
        )}

        {/* Pan Hint Overlay in bottom-right */}
        <div className="absolute bottom-2 right-2 px-2 py-1 bg-paper/85 backdrop-blur-xs border border-rule/50 rounded text-[9px] font-sans-meta text-muted flex items-center gap-1.5 pointer-events-none opacity-60 hover:opacity-100 transition-opacity">
          <Move size={9} />
          <span>Drag to pan · Ctrl + Scroll to zoom</span>
        </div>
      </div>
    </div>
  );
};

export default SvgPreview;
