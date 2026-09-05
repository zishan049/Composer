// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { 
  ZoomIn, ZoomOut, Maximize2, RotateCcw, RotateCw, 
  FlipHorizontal2, FlipVertical2, Copy, Check, Download, 
  Sun, Moon, Grid, Move, Pipette, FolderOpen, 
  Info, Box, ChevronDown, CheckCircle2
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

interface ImagePreviewProps {
  src: string;          // base64 data-url or asset url
  fileName?: string;
  filePath?: string;
  fileSize?: number;
  className?: string;
}

type BgMode = "grid" | "checker" | "paper" | "dark" | "light";

export const ImagePreview: React.FC<ImagePreviewProps> = ({
  src,
  fileName = "image.png",
  filePath = "",
  fileSize,
  className = ""
}) => {
  // Viewport & Transform State
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState<number>(0);
  const [flipH, setFlipH] = useState<boolean>(false);
  const [flipV, setFlipV] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFitMode, setIsFitMode] = useState<boolean>(true);

  // Inspector & Mode States
  const [bgMode, setBgMode] = useState<BgMode>("grid");
  const [isPixelated, setIsPixelated] = useState<boolean>(false);
  const [isEyedropperActive, setIsEyedropperActive] = useState<boolean>(false);
  const [hoveredColor, setHoveredColor] = useState<{ x: number; y: number; hex: string; rgb: string } | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [showPresetsMenu, setShowPresetsMenu] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; icon?: React.ReactNode } | null>(null);
  const [isImageCopied, setIsImageCopied] = useState<boolean>(false);
  const [isPathCopied, setIsPathCopied] = useState<boolean>(false);

  // Natural Dimensions
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  // References
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const hasInitiallyFitted = useRef<boolean>(false);
  const toastTimeoutRef = useRef<any>(null);

  // Show Toast Helper
  const showToast = useCallback((message: string, icon?: React.ReactNode) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, icon });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 2400);
  }, []);

  // Format Helper: File Extension / Type
  const fileFormat = useMemo(() => {
    const ext = fileName.split(".").pop()?.toUpperCase();
    if (ext && ext.length <= 5) return ext;
    if (src.startsWith("data:image/")) {
      const mime = src.split(";")[0].split("/")[1]?.toUpperCase();
      if (mime) return mime;
    }
    return "IMG";
  }, [fileName, src]);

  // Format Helper: File Size
  const formattedSize = useMemo(() => {
    if (fileSize !== undefined && fileSize !== null) {
      if (fileSize < 1024) return `${fileSize} B`;
      if (fileSize < 1024 * 1024) return `${(fileSize / 1024).toFixed(1)} KB`;
      return `${(fileSize / (1024 * 1024)).toFixed(2)} MB`;
    }
    if (src.startsWith("data:")) {
      const bytes = Math.round((src.length * 3) / 4);
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return "Unknown size";
  }, [fileSize, src]);

  // Format Helper: Aspect Ratio & Megapixels
  const { aspectRatio, megapixels } = useMemo(() => {
    if (!dimensions) return { aspectRatio: "—", megapixels: "—" };
    const { width, height } = dimensions;
    const mp = ((width * height) / 1_000_000).toFixed(2) + " MP";

    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, height);
    const rW = width / divisor;
    const rH = height / divisor;

    let ratio = `${rW}:${rH}`;
    if (rW === 1 && rH === 1) ratio = "1:1";
    else if ((rW === 16 && rH === 9) || (rW === 9 && rH === 16)) ratio = `${rW}:${rH}`;
    else if ((rW === 4 && rH === 3) || (rW === 3 && rH === 4)) ratio = `${rW}:${rH}`;
    else if ((rW === 3 && rH === 2) || (rW === 2 && rH === 3)) ratio = `${rW}:${rH}`;
    else if (rW > 40 || rH > 40) ratio = `${(width / height).toFixed(2)}:1`;

    return { aspectRatio: ratio, megapixels: mp };
  }, [dimensions]);

  // Lazy offscreen canvas initialization (only created when eyedropper is activated)
  const ensureOffscreenCanvas = useCallback(() => {
    if (offscreenCtxRef.current || !imageRef.current || !dimensions) return;
    try {
      const img = imageRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        offscreenCanvasRef.current = canvas;
        offscreenCtxRef.current = ctx;
      }
    } catch (err) {
      console.warn("Could not create offscreen canvas for pixel inspection:", err);
    }
  }, [dimensions]);

  // Handle Image Load
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setDimensions({ width: w, height: h });

    // Auto-fit on initial open
    if (!hasInitiallyFitted.current && containerRef.current) {
      hasInitiallyFitted.current = true;
      fitToContainer(w, h, 0);
    }
  };

  // Fit to Container Calculation
  const fitToContainer = useCallback((w?: number, h?: number, currentRot?: number) => {
    if (!containerRef.current) return;
    const imgW = w ?? dimensions?.width;
    const imgH = h ?? dimensions?.height;
    if (!imgW || !imgH) return;

    const rot = currentRot ?? rotation;
    const isSideways = rot === 90 || rot === 270;
    const effectiveW = isSideways ? imgH : imgW;
    const effectiveH = isSideways ? imgW : imgH;

    const padding = 56; // 28px padding on each side
    const availableW = Math.max(100, containerRef.current.clientWidth - padding);
    const availableH = Math.max(100, containerRef.current.clientHeight - padding);

    const scaleW = availableW / effectiveW;
    const scaleH = availableH / effectiveH;
    const fitScale = Math.min(scaleW, scaleH, 1); // don't upscale tiny images over 100% on initial fit

    setZoom(Math.max(0.05, Math.round(fitScale * 100) / 100));
    setPan({ x: 0, y: 0 });
    setIsFitMode(true);
  }, [dimensions, rotation]);

  // Zoom Helpers
  const handleZoomIn = () => {
    setZoom((z) => Math.min(32, Math.round((z * 1.25) * 100) / 100));
    setIsFitMode(false);
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(0.05, Math.round((z / 1.25) * 100) / 100));
    setIsFitMode(false);
  };

  const handleActualSize = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsFitMode(false);
  };

  const handleFitToView = () => {
    fitToContainer();
  };

  const handleResetAll = () => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setIsPixelated(false);
    setIsEyedropperActive(false);
    fitToContainer(dimensions?.width, dimensions?.height, 0);
    showToast("View reset");
  };

  // Rotate & Flip Helpers
  const handleRotateCW = () => {
    const nextRot = (rotation + 90) % 360;
    setRotation(nextRot);
    if (isFitMode) {
      fitToContainer(dimensions?.width, dimensions?.height, nextRot);
    }
  };

  const handleRotateCCW = () => {
    const nextRot = (rotation - 90 + 360) % 360;
    setRotation(nextRot);
    if (isFitMode) {
      fitToContainer(dimensions?.width, dimensions?.height, nextRot);
    }
  };

  const handleToggleFlipH = () => setFlipH((prev) => !prev);
  const handleToggleFlipV = () => setFlipV((prev) => !prev);

  // Wheel Zoom (Anchored to mouse cursor)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;

    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextZoom = Math.min(32, Math.max(0.05, Math.round(zoom * factor * 1000) / 1000));

    const newPanX = mouseX - (mouseX - pan.x) * (nextZoom / zoom);
    const newPanY = mouseY - (mouseY - pan.y) * (nextZoom / zoom);

    setZoom(nextZoom);
    setPan({ x: newPanX, y: newPanY });
    setIsFitMode(false);
  };

  // Pan Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isEyedropperActive) return;
    if (e.button === 0) { // Left click
      setIsPanning(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // Only update cursor state when eyedropper is actively sampling pixels
    if (isEyedropperActive) {
      setCursorPos({ x: e.clientX, y: e.clientY });
    }

    // Handle Pan
    if (isPanning) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
      setIsFitMode(false);
      return;
    }

    // Handle Eyedropper Pixel Reading
    if (isEyedropperActive && dimensions && containerRef.current && offscreenCtxRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2 + pan.x;
      const centerY = rect.top + rect.height / 2 + pan.y;

      let dx = (e.clientX - centerX) / zoom;
      let dy = (e.clientY - centerY) / zoom;

      const rad = (-rotation * Math.PI) / 180;
      let rotX = dx * Math.cos(rad) - dy * Math.sin(rad);
      let rotY = dx * Math.sin(rad) + dy * Math.cos(rad);

      if (flipH) rotX = -rotX;
      if (flipV) rotY = -rotY;

      const px = Math.floor(rotX + dimensions.width / 2);
      const py = Math.floor(rotY + dimensions.height / 2);

      if (px >= 0 && px < dimensions.width && py >= 0 && py < dimensions.height) {
        try {
          const p = offscreenCtxRef.current.getImageData(px, py, 1, 1).data;
          const hex = "#" + [p[0], p[1], p[2]].map((x) => x.toString(16).padStart(2, "0")).join("");
          const rgb = `rgb(${p[0]}, ${p[1]}, ${p[2]})`;
          setHoveredColor({ x: px, y: py, hex, rgb });
        } catch {
          setHoveredColor(null);
        }
      } else {
        setHoveredColor(null);
      }
    }
  };

  const handleMouseUp = () => setIsPanning(false);

  // Click Canvas (Handles Eyedropper Copy or Double Click)
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (isEyedropperActive && hoveredColor) {
      navigator.clipboard.writeText(hoveredColor.hex);
      showToast(`Copied ${hoveredColor.hex}`, (
        <span 
          className="w-3.5 h-3.5 rounded-full border border-paper shrink-0 inline-block shadow-xs" 
          style={{ backgroundColor: hoveredColor.hex }} 
        />
      ));
    }
  };

  const handleDoubleClick = () => {
    if (isEyedropperActive) return;
    if (isFitMode || zoom < 0.95 || zoom > 1.05) {
      handleActualSize();
    } else {
      handleFitToView();
    }
  };

  // Quick Action: Copy Image to Clipboard
  const handleCopyImage = async () => {
    try {
      const response = await fetch(src);
      const blob = await response.blob();

      if (blob.type === "image/png") {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ]);
      } else {
        // Convert non-PNG images to PNG blob via canvas for system clipboard compatibility
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = src;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0);

        await new Promise<void>((resolve, reject) => {
          canvas.toBlob(async (pngBlob) => {
            if (pngBlob) {
              try {
                await navigator.clipboard.write([
                  new ClipboardItem({ "image/png": pngBlob })
                ]);
                resolve();
              } catch (err) {
                reject(err);
              }
            } else {
              reject(new Error("Canvas toBlob failed"));
            }
          }, "image/png");
        });
      }

      setIsImageCopied(true);
      setTimeout(() => setIsImageCopied(false), 2000);
      showToast("Image copied to clipboard!", <Check size={13} className="text-emerald-500" />);
    } catch (err) {
      console.error("Clipboard copy failed, fallback to data url:", err);
      try {
        await navigator.clipboard.writeText(src);
        showToast("Image data copied to clipboard!");
      } catch {
        showToast("Failed to copy image to clipboard");
      }
    }
  };

  // Quick Action: Copy File Path
  const handleCopyPath = async () => {
    if (!filePath) return;
    try {
      await navigator.clipboard.writeText(filePath);
      setIsPathCopied(true);
      setTimeout(() => setIsPathCopied(false), 2000);
      showToast("Path copied to clipboard!", <Check size={13} className="text-emerald-500" />);
    } catch {
      showToast("Failed to copy path");
    }
  };

  // Quick Action: Reveal in OS File Explorer
  const handleRevealInExplorer = async () => {
    if (!filePath) {
      showToast("No file path available");
      return;
    }
    try {
      await revealItemInDir(filePath);
      showToast("Revealed in File Explorer", <FolderOpen size={13} />);
    } catch (err) {
      console.error("Reveal in explorer error:", err);
      showToast("Could not reveal in File Explorer");
    }
  };

  // Quick Action: Download Image
  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = src;
    link.download = fileName || "image";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Download started", <Download size={13} />);
  };

  // Keyboard Navigation & Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        handleZoomIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        handleZoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        handleFitToView();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "1") {
        e.preventDefault();
        handleActualSize();
      } else if (e.key === "r" || e.key === "R") {
        if (e.shiftKey) handleRotateCCW();
        else handleRotateCW();
      } else if (e.key === "h" || e.key === "H") {
        handleToggleFlipH();
      } else if (e.key === "v" || e.key === "V") {
        handleToggleFlipV();
      } else if (e.key === "i" || e.key === "I") {
        setIsEyedropperActive((prev) => !prev);
      } else if (e.key === "Escape") {
        if (isEyedropperActive) setIsEyedropperActive(false);
        if (showPresetsMenu) setShowPresetsMenu(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zoom, pan, rotation, flipH, flipV, isEyedropperActive, showPresetsMenu]);

  // Window Resize: re-fit if in fit mode
  useEffect(() => {
    const handleResize = () => {
      if (isFitMode && dimensions) {
        fitToContainer();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isFitMode, dimensions, fitToContainer]);

  // Background Style Generator
  const getBgStyle = () => {
    switch (bgMode) {
      case "grid":
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
            linear-gradient(45deg, var(--theme-cream, rgba(128, 128, 128, 0.2)) 25%, transparent 25%), 
            linear-gradient(-45deg, var(--theme-cream, rgba(128, 128, 128, 0.2)) 25%, transparent 25%), 
            linear-gradient(45deg, transparent 75%, var(--theme-cream, rgba(128, 128, 128, 0.2)) 75%), 
            linear-gradient(-45deg, transparent 75%, var(--theme-cream, rgba(128, 128, 128, 0.2)) 75%)
          `,
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px"
        };
      case "paper":
        return { backgroundColor: "var(--theme-paper, #f6f2ea)" };
      case "dark":
        return { backgroundColor: "#121214" };
      case "light":
        return { backgroundColor: "#ffffff" };
    }
  };

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className={`flex flex-col h-full w-full bg-paper overflow-hidden select-none relative ${className}`}>
      {/* Top Inspector & Controls Toolbar */}
      <div className="px-3.5 py-1.5 bg-cream/35 border-b border-rule flex items-center justify-between font-sans-meta text-[11px] gap-2 shrink-0 z-20">
        {/* Left: Format, Dimensions & Badges */}
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="font-mono text-[10px] font-bold text-accent px-1.5 py-0.5 bg-accent/10 rounded-sm border border-accent/20">
            {fileFormat}
          </span>

          {dimensions ? (
            <span className="font-mono text-[10px] text-ink/80 px-1.5 py-0.5 bg-cream/70 rounded-sm border border-rule/50">
              {dimensions.width} × {dimensions.height} px
            </span>
          ) : (
            <span className="font-mono text-[10px] text-muted animate-pulse">Loading image...</span>
          )}

          <span className="font-mono text-[10px] text-muted hidden sm:inline-block">
            {formattedSize}
          </span>

          {dimensions && (
            <span className="font-mono text-[9px] text-muted/70 hidden md:inline-block">
              {aspectRatio} · {megapixels}
            </span>
          )}
        </div>

        {/* Right: Backgrounds, Zoom, Transforms & Tools */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Background Modes */}
          <div className="flex items-center bg-cream/60 p-0.5 rounded border border-rule/50 gap-0.5">
            <button
              onClick={() => setBgMode("grid")}
              title="Theme Grid Background"
              className={`p-1 rounded-sm transition-colors ${
                bgMode === "grid" ? "bg-accent text-paper shadow-xs" : "text-muted hover:text-ink"
              }`}
            >
              <Grid size={11} />
            </button>
            <button
              onClick={() => setBgMode("checker")}
              title="Transparency Checkerboard (for PNG / WebP)"
              className={`px-1.5 py-0.5 text-[9px] uppercase font-bold rounded-sm transition-colors ${
                bgMode === "checker" ? "bg-accent text-paper shadow-xs" : "text-muted hover:text-ink"
              }`}
            >
              Alpha
            </button>
            <button
              onClick={() => setBgMode("paper")}
              title="Solid Theme Paper"
              className={`px-1.5 py-0.5 text-[9px] uppercase font-bold rounded-sm transition-colors ${
                bgMode === "paper" ? "bg-accent text-paper shadow-xs" : "text-muted hover:text-ink"
              }`}
            >
              Paper
            </button>
            <button
              onClick={() => setBgMode("dark")}
              title="Obsidian Dark Background"
              className={`p-1 rounded-sm transition-colors ${
                bgMode === "dark" ? "bg-accent text-paper shadow-xs" : "text-muted hover:text-ink"
              }`}
            >
              <Moon size={11} />
            </button>
            <button
              onClick={() => setBgMode("light")}
              title="Pure White Background"
              className={`p-1 rounded-sm transition-colors ${
                bgMode === "light" ? "bg-accent text-paper shadow-xs" : "text-muted hover:text-ink"
              }`}
            >
              <Sun size={11} />
            </button>
          </div>

          {/* Crisp Pixelated Toggle (Great for Pixel Art & Zoom Inspection) */}
          <button
            onClick={() => setIsPixelated((prev) => !prev)}
            title={isPixelated ? "Crisp Pixelated Mode: ON (Nearest-Neighbor)" : "Crisp Pixelated Mode: OFF (Smooth Bilinear)"}
            className={`p-1 rounded border transition-colors flex items-center gap-1 text-[10px] font-mono ${
              isPixelated 
                ? "bg-accent text-paper border-accent shadow-xs font-bold" 
                : "bg-cream/60 border-rule/50 text-muted hover:text-ink hover:bg-cream"
            }`}
          >
            <Box size={11} />
            <span className="hidden lg:inline text-[9px] uppercase">Crisp</span>
          </button>

          {/* Eyedropper / Color Picker Mode */}
          <button
            onClick={() => {
              const next = !isEyedropperActive;
              setIsEyedropperActive(next);
              if (next) {
                ensureOffscreenCanvas();
                showToast("Eyedropper active: hover & click to copy color");
              }
            }}
            title="Eyedropper: Inspect and copy hex color (Key: I)"
            className={`p-1 rounded border transition-colors flex items-center gap-1 text-[10px] ${
              isEyedropperActive 
                ? "bg-accent text-paper border-accent shadow-xs font-bold ring-1 ring-accent/30" 
                : "bg-cream/60 border-rule/50 text-muted hover:text-ink hover:bg-cream"
            }`}
          >
            <Pipette size={11} />
            <span className="hidden lg:inline text-[9px] uppercase">Pick</span>
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center bg-cream/60 p-0.5 rounded border border-rule/50 gap-0.5 font-mono text-[10px] relative">
            <button
              onClick={handleZoomOut}
              title="Zoom Out (Ctrl + -)"
              className="p-1 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
            >
              <ZoomOut size={11} />
            </button>

            {/* Zoom Percentage Dropdown Trigger */}
            <div className="relative">
              <button
                onClick={() => setShowPresetsMenu((prev) => !prev)}
                title="Click for Zoom Presets"
                className="px-1.5 py-0.5 text-center min-w-10.5 hover:text-accent font-semibold transition-colors flex items-center justify-center gap-0.5"
              >
                <span>{zoomPercent}%</span>
                <ChevronDown size={8} className="opacity-60" />
              </button>

              {/* Zoom Presets Dropdown Menu */}
              {showPresetsMenu && (
                <div 
                  className="absolute top-full mt-1 left-1/2 -translate-x-1/2 w-28 bg-paper border border-rule shadow-xl rounded-sm py-1 z-50 font-sans-meta text-xs"
                  onMouseLeave={() => setShowPresetsMenu(false)}
                >
                  <div className="px-2 py-1 text-[9px] uppercase font-bold text-muted border-b border-light-rule/50">
                    Zoom Presets
                  </div>
                  {[
                    { label: "Fit to View", action: handleFitToView },
                    { label: "100% (1:1)", action: handleActualSize },
                    { label: "25%", action: () => { setZoom(0.25); setIsFitMode(false); } },
                    { label: "50%", action: () => { setZoom(0.5); setIsFitMode(false); } },
                    { label: "200%", action: () => { setZoom(2); setIsFitMode(false); } },
                    { label: "400%", action: () => { setZoom(4); setIsFitMode(false); } },
                    { label: "800%", action: () => { setZoom(8); setIsFitMode(false); } },
                  ].map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        item.action();
                        setShowPresetsMenu(false);
                      }}
                      className="w-full text-left px-2.5 py-1 hover:bg-cream text-ink text-[11px] font-mono flex items-center justify-between"
                    >
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleZoomIn}
              title="Zoom In (Ctrl + +)"
              className="p-1 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
            >
              <ZoomIn size={11} />
            </button>

            <button
              onClick={handleFitToView}
              title="Fit to View (Ctrl + 0)"
              className={`p-1 rounded-sm transition-colors ${
                isFitMode ? "text-accent font-bold" : "text-muted hover:text-ink hover:bg-cream"
              }`}
            >
              <Maximize2 size={11} />
            </button>
          </div>

          {/* Orientation Controls (Rotate & Flip) */}
          <div className="flex items-center bg-cream/60 p-0.5 rounded border border-rule/50 gap-0.5">
            <button
              onClick={handleRotateCW}
              title="Rotate 90° Clockwise (Key: R)"
              className="p-1 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
            >
              <RotateCw size={11} />
            </button>
            <button
              onClick={handleToggleFlipH}
              title="Flip Horizontal (Key: H)"
              className={`p-1 rounded-sm transition-colors ${
                flipH ? "bg-accent text-paper shadow-xs" : "text-muted hover:text-ink hover:bg-cream"
              }`}
            >
              <FlipHorizontal2 size={11} />
            </button>
            <button
              onClick={handleToggleFlipV}
              title="Flip Vertical (Key: V)"
              className={`p-1 rounded-sm transition-colors ${
                flipV ? "bg-accent text-paper shadow-xs" : "text-muted hover:text-ink hover:bg-cream"
              }`}
            >
              <FlipVertical2 size={11} />
            </button>
            <button
              onClick={handleResetAll}
              title="Reset All Transforms & Zoom"
              className="p-1 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
            >
              <RotateCcw size={11} />
            </button>
          </div>

          {/* Quick Actions (Copy, Reveal, Download, Toggle Info) */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopyImage}
              title="Copy Image to System Clipboard"
              className="p-1.5 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors flex items-center gap-1 text-[10px] font-sans-meta uppercase font-semibold"
            >
              {isImageCopied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
              <span className="hidden xl:inline">{isImageCopied ? "Copied" : "Copy"}</span>
            </button>

            {filePath && (
              <button
                onClick={handleRevealInExplorer}
                title="Reveal File in Native OS Explorer"
                className="p-1.5 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
              >
                <FolderOpen size={11} />
              </button>
            )}

            <button
              onClick={handleDownload}
              title="Download Image"
              className="p-1.5 rounded-sm hover:bg-cream text-muted hover:text-ink transition-colors"
            >
              <Download size={11} />
            </button>

            <button
              onClick={() => setShowInspector((prev) => !prev)}
              title="Toggle Bottom Metadata Inspector"
              className={`p-1.5 rounded-sm transition-colors ${
                showInspector ? "text-accent bg-cream" : "text-muted hover:text-ink hover:bg-cream"
              }`}
            >
              <Info size={11} />
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
        onClick={handleCanvasClick}
        onDoubleClick={handleDoubleClick}
        style={getBgStyle()}
        className={`flex-1 relative overflow-hidden flex items-center justify-center ${
          isEyedropperActive 
            ? "cursor-crosshair" 
            : isPanning 
              ? "cursor-grabbing" 
              : "cursor-grab"
        }`}
      >
        {src ? (
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
              transformOrigin: "center center",
              transition: isPanning ? "none" : "transform 0.12s ease-out",
            }}
            className="inline-block p-4 select-none pointer-events-none"
          >
            <div className="relative shadow-2xl rounded-sm border border-light-rule/40 overflow-hidden bg-transparent">
              <img
                ref={imageRef}
                src={src}
                alt={fileName}
                draggable={false}
                onLoad={handleImageLoad}
                style={{
                  display: "block",
                  imageRendering: isPixelated ? "pixelated" : "auto",
                  maxWidth: "none",
                  maxHeight: "none",
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-muted gap-2">
            <Info size={24} className="text-muted/60" />
            <span className="font-sans-meta text-xs">No image source loaded</span>
          </div>
        )}

        {/* Eyedropper Floating Loupe / Color Chip following cursor */}
        {isEyedropperActive && hoveredColor && (
          <div
            style={{
              left: `${cursorPos.x + 16}px`,
              top: `${cursorPos.y + 16}px`,
            }}
            className="fixed pointer-events-none z-50 bg-paper/95 backdrop-blur-md border border-rule shadow-xl rounded-md p-2 flex items-center gap-2.5 font-mono text-[11px] text-ink"
          >
            <span
              className="w-5 h-5 rounded-full border border-rule shadow-inner shrink-0"
              style={{ backgroundColor: hoveredColor.hex }}
            />
            <div className="flex flex-col">
              <span className="font-bold font-mono tracking-tight">{hoveredColor.hex}</span>
              <span className="text-[9px] text-muted">
                X: {hoveredColor.x}, Y: {hoveredColor.y}
              </span>
            </div>
          </div>
        )}

        {/* Pan / Zoom Shortcut Hint in bottom-right */}
        <div className="absolute bottom-3 right-3 px-2 py-1 bg-paper/85 backdrop-blur-xs border border-rule/50 rounded text-[9px] font-sans-meta text-muted flex items-center gap-1.5 pointer-events-none opacity-60 hover:opacity-100 transition-opacity z-10">
          <Move size={9} />
          <span>Drag to pan · Scroll to zoom · Double-click to toggle Fit / 100%</span>
        </div>

        {/* Transient Action Toast Notification */}
        {toast && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-paper/95 backdrop-blur-md border border-accent/40 shadow-xl px-3.5 py-1.5 rounded-full flex items-center gap-2 text-ink font-sans-meta text-xs font-semibold animate-in fade-in slide-in-from-top-2 duration-150">
            {toast.icon || <CheckCircle2 size={13} className="text-accent" />}
            <span>{toast.message}</span>
          </div>
        )}
      </div>

      {/* Bottom Metadata & Status Inspector Bar (Collapsible) */}
      {showInspector && (
        <div className="px-4 py-2 bg-cream/25 border-t border-rule flex flex-wrap items-center justify-between font-sans-meta text-[11px] text-muted gap-x-6 gap-y-1.5 shrink-0 z-20">
          {/* Left Metadata Grid */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-accent uppercase text-[9px]">File</span>
              <span className="text-ink font-mono font-medium truncate max-w-55" title={fileName}>
                {fileName}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-accent uppercase text-[9px]">Resolution</span>
              <span className="text-ink font-mono font-semibold">
                {dimensions ? `${dimensions.width} × ${dimensions.height} px` : "Detecting..."}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-accent uppercase text-[9px]">Aspect</span>
              <span className="text-ink font-mono">{aspectRatio}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-accent uppercase text-[9px]">Size</span>
              <span className="text-ink font-mono font-semibold">{formattedSize}</span>
            </div>

            {rotation !== 0 && (
              <div className="flex items-center gap-1 text-accent font-mono text-[10px] font-semibold bg-accent/10 px-1.5 py-0.5 rounded">
                <span>Rotated {rotation}°</span>
              </div>
            )}

            {(flipH || flipV) && (
              <div className="flex items-center gap-1 text-accent font-mono text-[10px] font-semibold bg-accent/10 px-1.5 py-0.5 rounded">
                <span>Flipped {flipH && flipV ? "H+V" : flipH ? "H" : "V"}</span>
              </div>
            )}
          </div>

          {/* Right Path & Coordinates */}
          <div className="flex items-center gap-3 ml-auto">
            {hoveredColor ? (
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-ink bg-cream/70 px-2 py-0.5 rounded border border-rule/40">
                <span 
                  className="w-2.5 h-2.5 rounded-full border border-paper inline-block shadow-xs" 
                  style={{ backgroundColor: hoveredColor.hex }} 
                />
                <span>{hoveredColor.hex}</span>
                <span className="text-muted">({hoveredColor.x}, {hoveredColor.y})</span>
              </div>
            ) : (
              <span className="font-mono text-[10px] text-muted/80">
                Zoom: {zoomPercent}% {isFitMode ? "(Fit)" : ""}
              </span>
            )}

            {filePath && (
              <div 
                onClick={handleCopyPath}
                title="Click to copy full path"
                className="flex items-center gap-1 cursor-pointer text-ink/70 hover:text-accent transition-colors group"
              >
                <span className="truncate max-w-70 font-mono text-[10px]">
                  {filePath}
                </span>
                {isPathCopied ? (
                  <Check size={11} className="text-emerald-600 shrink-0" />
                ) : (
                  <Copy size={11} className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImagePreview;
