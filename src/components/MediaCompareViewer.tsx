import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LayoutGrid,
  Layers,
  ArrowLeftRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Columns,
  Plus,
  X,
  Search,
  Check,
  Image as ImageIcon,
  ExternalLink,
  AlertTriangle,
  Eye,
  SlidersHorizontal,
} from "lucide-react";

export interface MediaCompareItem {
  path: string;
  name: string;
  fileType: "image" | "svg";
  srcOrContent: string;
  fileSize?: number;
}

export interface MediaCompareCandidate {
  path: string;
  name: string;
  fileType: "image" | "svg";
  fileSize?: number;
}

interface MediaCompareViewerProps {
  items: MediaCompareItem[];
  onRemoveItem: (path: string) => void;
  onAddItems?: (candidates: MediaCompareCandidate[]) => void;
  onOpenSingle?: (item: MediaCompareItem) => void;
  availableCandidates?: MediaCompareCandidate[];
}

type ViewerMode = "row" | "stack" | "board" | "split" | "overlay";
type BackdropMode = "checker" | "grid" | "dark" | "light" | "paper";
type BlendMode = "normal" | "difference" | "exclusion" | "multiply" | "screen";

interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

interface ResolvedMediaItem extends MediaCompareItem {
  renderUrl: string;
  isValidSvg: boolean;
  svgMeta: string | null;
  errorMsg: string | null;
}

const DEFAULT_VIEW: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
const MATCHED_BASE_HEIGHT = 560;

function formatFileSize(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "IMG";
}

function getBackdropStyle(mode: BackdropMode): React.CSSProperties {
  switch (mode) {
    case "checker":
      return {
        backgroundColor: "#141720",
        backgroundImage:
          "linear-gradient(45deg, rgba(255,255,255,0.055) 25%, transparent 25%), " +
          "linear-gradient(-45deg, rgba(255,255,255,0.055) 25%, transparent 25%), " +
          "linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.055) 75%), " +
          "linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.055) 75%)",
        backgroundSize: "20px 20px",
        backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
      };
    case "grid":
      return {
        backgroundColor: "#0e1118",
        backgroundImage:
          "linear-gradient(to right, rgba(36, 87, 255, 0.14) 1px, transparent 1px), " +
          "linear-gradient(to bottom, rgba(36, 87, 255, 0.14) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      };
    case "dark":
      return { backgroundColor: "#0b0d13" };
    case "light":
      return { backgroundColor: "#eef2f7" };
    case "paper":
      return { backgroundColor: "#fbf9f4" };
  }
}

export default function MediaCompareViewer({
  items,
  onRemoveItem,
  onAddItems,
  onOpenSingle,
  availableCandidates = [],
}: MediaCompareViewerProps) {
  const [viewerMode, setViewerMode] = useState<ViewerMode>("row");
  const [backdrop, setBackdrop] = useState<BackdropMode>("checker");
  const [matchScale, setMatchScale] = useState(true);
  const [gapPx, setGapPx] = useState<number>(16);
  const [showLabels, setShowLabels] = useState(true);
  const [crispPixels, setCrispPixels] = useState(false);

  // Single unified pan & zoom state for the entire shared viewer canvas
  const [view, setView] = useState<ViewTransform>(DEFAULT_VIEW);
  const [isAutoFit, setIsAutoFit] = useState(true);
  const [isPanning, setIsPanning] = useState(false);
  const [activePath, setActivePath] = useState<string>("");

  // Split & Overlay specific state
  const [slotAPath, setSlotAPath] = useState<string>("");
  const [slotBPath, setSlotBPath] = useState<string>("");
  const [splitPercent, setSplitPercent] = useState<number>(50);
  const [splitOrientation, setSplitOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [overlayOpacity, setOverlayOpacity] = useState<number>(50);
  const [blendMode, setBlendMode] = useState<BlendMode>("normal");

  // Natural pixel dimensions detected via <img> onLoad
  const [dimensionsMap, setDimensionsMap] = useState<Record<string, { w: number; h: number }>>({});

  // "+ Add Media" popover modal
  const [isAddPickerOpen, setIsAddPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);

  // Viewport & unified canvas stage refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    originPanX: number;
    originPanY: number;
  } | null>(null);
  const draggingSplitRef = useRef(false);

  // Keep slotA / slotB / activePath valid as items change
  useEffect(() => {
    if (items.length === 0) return;
    if (!items.some((i) => i.path === activePath)) {
      setActivePath(items[0].path);
    }
    if (!items.some((i) => i.path === slotAPath)) {
      setSlotAPath(items[0].path);
    }
    if (!items.some((i) => i.path === slotBPath)) {
      setSlotBPath((items[1] ?? items[0]).path);
    } else if (items.length > 1 && slotBPath === slotAPath) {
      const alt = items.find((i) => i.path !== slotAPath);
      if (alt) setSlotBPath(alt.path);
    }
  }, [items, activePath, slotAPath, slotBPath]);

  // Trigger auto-fit whenever item set, layout mode, scale mode, or gap changes
  const itemsSignature = useMemo(() => items.map((i) => i.path).join("|"), [items]);
  useEffect(() => {
    setIsAutoFit(true);
  }, [itemsSignature, viewerMode, matchScale, gapPx]);

  // Parse SVG content cleanly and create isolated Blob URLs with deterministic cleanup
  const resolvedItems = useMemo<{ list: ResolvedMediaItem[]; blobUrls: string[] }>(() => {
    const blobUrls: string[] = [];
    const list: ResolvedMediaItem[] = items.map((item) => {
      if (item.fileType === "image") {
        return {
          ...item,
          renderUrl: item.srcOrContent,
          isValidSvg: true,
          svgMeta: null,
          errorMsg: item.srcOrContent ? null : "Missing image source",
        };
      }

      try {
        const trimmed = item.srcOrContent.trim();
        if (!trimmed) {
          return {
            ...item,
            renderUrl: "",
            isValidSvg: false,
            svgMeta: null,
            errorMsg: "Empty SVG file",
          };
        }
        const parser = new DOMParser();
        const doc = parser.parseFromString(trimmed, "image/svg+xml");
        const parserErr = doc.querySelector("parsererror");
        const root = doc.documentElement;

        if (parserErr || !root || root.tagName.toLowerCase() !== "svg") {
          return {
            ...item,
            renderUrl: "",
            isValidSvg: false,
            svgMeta: null,
            errorMsg: "Invalid SVG markup",
          };
        }

        doc.querySelectorAll("script").forEach((el) => el.remove());

        const vb = root.getAttribute("viewBox");
        const wAttr = root.getAttribute("width");
        const hAttr = root.getAttribute("height");
        const metaParts: string[] = [];
        if (wAttr && hAttr) metaParts.push(`${wAttr}×${hAttr}`);
        if (vb) metaParts.push(`viewBox(${vb})`);

        const serialized = new XMLSerializer().serializeToString(doc);
        const url = URL.createObjectURL(
          new Blob([serialized], { type: "image/svg+xml;charset=utf-8" })
        );
        blobUrls.push(url);

        return {
          ...item,
          renderUrl: url,
          isValidSvg: true,
          svgMeta: metaParts.join(" · ") || null,
          errorMsg: null,
        };
      } catch (err) {
        return {
          ...item,
          renderUrl: "",
          isValidSvg: false,
          svgMeta: null,
          errorMsg: err instanceof Error ? err.message : "Failed to parse SVG",
        };
      }
    });

    return { list, blobUrls };
  }, [items]);

  useEffect(() => {
    return () => {
      resolvedItems.blobUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [resolvedItems]);

  const fitAllToViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) return;

    const pad = 44;
    if (viewerMode === "split" || viewerMode === "overlay") {
      const refItem = resolvedItems.list.find((i) => i.path === slotAPath) ?? resolvedItems.list[0];
      const dim = refItem ? dimensionsMap[refItem.path] : undefined;
      const targetH = matchScale ? MATCHED_BASE_HEIGHT : (dim?.h ?? MATCHED_BASE_HEIGHT);
      const targetW =
        dim && dim.h > 0
          ? matchScale
            ? (dim.w / dim.h) * MATCHED_BASE_HEIGHT
            : dim.w
          : targetH;
      const fitZoom = Math.max(0.05, Math.min(2, Math.min((cw - pad) / targetW, (ch - pad) / targetH)));
      setView({ zoom: fitZoom, panX: 0, panY: 0 });
      setIsAutoFit(true);
      return;
    }

    const stage = stageRef.current;
    if (!stage) return;
    const sw = stage.offsetWidth;
    const sh = stage.offsetHeight;
    if (sw <= 0 || sh <= 0) return;

    const scaleX = (cw - pad) / sw;
    const scaleY = (ch - pad) / sh;
    const fitZoom = Math.max(0.05, Math.min(2, Math.min(scaleX, scaleY)));
    setView({ zoom: fitZoom, panX: 0, panY: 0 });
    setIsAutoFit(true);
  }, [viewerMode, resolvedItems.list, slotAPath, dimensionsMap, matchScale]);

  // Re-run fit when images finish loading or viewport resizes while auto-fit is active
  const loadedCountKey = useMemo(
    () =>
      resolvedItems.list
        .map((i) => {
          const d = dimensionsMap[i.path];
          return d ? `${d.w}x${d.h}` : "pending";
        })
        .join(","),
    [resolvedItems.list, dimensionsMap]
  );

  useEffect(() => {
    if (!isAutoFit) return;
    const id = requestAnimationFrame(() => {
      fitAllToViewport();
    });
    return () => cancelAnimationFrame(id);
  }, [isAutoFit, viewerMode, loadedCountKey, matchScale, gapPx, fitAllToViewport]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (isAutoFit) fitAllToViewport();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [isAutoFit, fitAllToViewport]);

  const adjustZoom = useCallback((factor: number, anchor?: { clientX: number; clientY: number }) => {
    setIsAutoFit(false);
    setView((prev) => {
      const nextZoom = Math.min(16, Math.max(0.05, Number((prev.zoom * factor).toFixed(4))));
      if (!anchor || !containerRef.current) {
        return { ...prev, zoom: nextZoom };
      }
      const rect = containerRef.current.getBoundingClientRect();
      const mx = anchor.clientX - (rect.left + rect.width / 2);
      const my = anchor.clientY - (rect.top + rect.height / 2);
      const sx = (mx - prev.panX) / prev.zoom;
      const sy = (my - prev.panY) / prev.zoom;
      return {
        zoom: nextZoom,
        panX: mx - sx * nextZoom,
        panY: my - sy * nextZoom,
      };
    });
  }, []);

  const focusItemInCanvas = useCallback(
    (targetPath: string) => {
      setActivePath(targetPath);
      const stage = stageRef.current;
      const node = itemRefs.current[targetPath];
      if (!stage || !node) return;
      setIsAutoFit(false);
      // Node offset relative to stage center
      const stageCx = stage.offsetWidth / 2;
      const stageCy = stage.offsetHeight / 2;
      const nodeCx = node.offsetLeft + node.offsetWidth / 2;
      const nodeCy = node.offsetTop + node.offsetHeight / 2;
      setView((prev) => ({
        ...prev,
        panX: -(nodeCx - stageCx) * prev.zoom,
        panY: -(nodeCy - stageCy) * prev.zoom,
      }));
    },
    []
  );

  const handleCanvasWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      adjustZoom(factor, { clientX: e.clientX, clientY: e.clientY });
    },
    [adjustZoom]
  );

  const handlePanStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || draggingSplitRef.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsPanning(true);
      setIsAutoFit(false);
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originPanX: view.panX,
        originPanY: view.panY,
      };
    },
    [view.panX, view.panY]
  );

  const handlePanMove = useCallback((e: React.PointerEvent) => {
    const drag = panDragRef.current;
    if (!drag) return;
    setView((prev) => ({
      ...prev,
      panX: drag.originPanX + (e.clientX - drag.startX),
      panY: drag.originPanY + (e.clientY - drag.startY),
    }));
  }, []);

  const handlePanEnd = useCallback((e: React.PointerEvent) => {
    if (panDragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if already released
      }
      panDragRef.current = null;
    }
    setIsPanning(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (isAutoFit || Math.abs(view.zoom - 1) > 0.06) {
      setIsAutoFit(false);
      setView({ zoom: 1, panX: 0, panY: 0 });
    } else {
      fitAllToViewport();
    }
  }, [isAutoFit, view.zoom, fitAllToViewport]);

  // Split divider drag handlers
  const updateSplitFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box || box.width <= 0 || box.height <= 0) return;
      const pct =
        splitOrientation === "vertical"
          ? ((clientX - box.left) / box.width) * 100
          : ((clientY - box.top) / box.height) * 100;
      setSplitPercent(Math.max(2, Math.min(98, pct)));
    },
    [splitOrientation]
  );

  const boardCols = useMemo(() => {
    const n = resolvedItems.list.length;
    if (n <= 1) return 1;
    if (n <= 4) return 2;
    return Math.ceil(Math.sqrt(n));
  }, [resolvedItems.list.length]);

  const itemA = useMemo(
    () => resolvedItems.list.find((i) => i.path === slotAPath) ?? resolvedItems.list[0],
    [resolvedItems.list, slotAPath]
  );
  const itemB = useMemo(
    () =>
      resolvedItems.list.find((i) => i.path === slotBPath) ??
      resolvedItems.list[1] ??
      resolvedItems.list[0],
    [resolvedItems.list, slotBPath]
  );
  const activeItem = useMemo(
    () => resolvedItems.list.find((i) => i.path === activePath) ?? resolvedItems.list[0],
    [resolvedItems.list, activePath]
  );

  const existingPathSet = useMemo(() => new Set(items.map((i) => i.path)), [items]);
  const addableCandidates = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return availableCandidates.filter(
      (c) => !existingPathSet.has(c.path) && (!q || c.name.toLowerCase().includes(q))
    );
  }, [availableCandidates, existingPathSet, pickerSearch]);

  const handleToggleCandidate = (path: string) => {
    setPickerSelected((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const handleConfirmAdd = () => {
    if (!onAddItems || pickerSelected.length === 0) return;
    const chosen = availableCandidates.filter((c) => pickerSelected.includes(c.path));
    onAddItems(chosen);
    setPickerSelected([]);
    setPickerSearch("");
    setIsAddPickerOpen(false);
  };

  const backdropStyle = useMemo(() => getBackdropStyle(backdrop), [backdrop]);
  const zoomPct = Math.round(view.zoom * 100);
  const activeDim = activeItem ? dimensionsMap[activeItem.path] : undefined;

  return (
    <div className="flex flex-col w-full h-full overflow-hidden select-none relative">
      {/* ── Single Unified Viewer Toolbar ──────────────────────── */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 shrink-0 border-b"
        style={{
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--bg-surface-elevated)",
        }}
      >
        {/* Left: Layout & Compare Modes + Add Media */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div
            className="inline-flex items-center p-0.5 rounded-lg border"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "rgba(0,0,0,0.16)",
            }}
          >
            {(
              [
                { id: "row", label: "Row", icon: Columns, title: "Side-by-side in one canvas" },
                { id: "stack", label: "Stack", icon: Layers, title: "Continuous vertical sheet" },
                { id: "board", label: "Board", icon: LayoutGrid, title: "Multi-row canvas sheet" },
                { id: "split", label: "Split", icon: ArrowLeftRight, title: "Draggable A/B split swipe" },
                { id: "overlay", label: "Overlay", icon: Eye, title: "Onion-skin / pixel diff" },
              ] as const
            ).map(({ id, label, icon: Icon, title }) => {
              const active = viewerMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setViewerMode(id)}
                  title={title}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer"
                  style={{
                    backgroundColor: active ? "var(--accent)" : "transparent",
                    color: active ? "#FFFFFF" : "var(--text-secondary)",
                  }}
                >
                  <Icon size={12} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Uniform height vs true pixel ratio */}
          <button
            type="button"
            onClick={() => setMatchScale((v) => !v)}
            className="px-2 py-1 rounded-md text-[10.5px] font-medium border cursor-pointer transition-colors"
            style={{
              borderColor: matchScale ? "var(--accent)" : "var(--border-subtle)",
              backgroundColor: matchScale ? "var(--accent-soft)" : "transparent",
              color: matchScale ? "var(--accent)" : "var(--text-secondary)",
            }}
            title="Match visual height across images & SVGs vs true 1:1 pixel ratio"
          >
            {matchScale ? "Match Size" : "1:1 Scale"}
          </button>

          {viewerMode !== "split" && viewerMode !== "overlay" && (
            <>
              <div
                className="inline-flex items-center p-0.5 rounded-md border text-[10px]"
                style={{ borderColor: "var(--border-subtle)" }}
                title="Spacing between images on the canvas"
              >
                {[
                  { label: "0px", val: 0 },
                  { label: "16px", val: 16 },
                  { label: "36px", val: 36 },
                ].map((g) => {
                  const active = gapPx === g.val;
                  return (
                    <button
                      key={g.val}
                      type="button"
                      onClick={() => setGapPx(g.val)}
                      className="px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                      style={{
                        backgroundColor: active ? "var(--accent-soft)" : "transparent",
                        color: active ? "var(--accent)" : "var(--text-muted)",
                      }}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setShowLabels((v) => !v)}
                className="px-2 py-1 rounded-md text-[10.5px] font-medium border cursor-pointer transition-colors"
                style={{
                  borderColor: showLabels ? "var(--accent)" : "var(--border-subtle)",
                  backgroundColor: showLabels ? "var(--accent-soft)" : "transparent",
                  color: showLabels ? "var(--accent)" : "var(--text-secondary)",
                }}
                title="Toggle lightweight corner filename badges"
              >
                Labels
              </button>
            </>
          )}

          {onAddItems && (
            <button
              type="button"
              onClick={() => setIsAddPickerOpen((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors"
              style={{
                borderColor: "var(--accent)",
                backgroundColor: "var(--accent-soft)",
                color: "var(--accent)",
              }}
              title="Add more images or SVGs to this viewer"
            >
              <Plus size={12} />
              <span>Add ({items.length})</span>
            </button>
          )}
        </div>

        {/* Right: Zoom, Fit, Reset, Crisp, Backdrop */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div
            className="inline-flex items-center rounded-md border"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <button
              type="button"
              onClick={() => adjustZoom(1 / 1.25)}
              className="p-1.5 cursor-pointer hover:opacity-80"
              style={{ color: "var(--text-secondary)" }}
              title="Zoom Out"
            >
              <ZoomOut size={12} />
            </button>
            <button
              type="button"
              onClick={handleDoubleClick}
              className="px-2 text-[11px] font-mono tabular-nums cursor-pointer"
              style={{ color: "var(--text-primary)" }}
              title="Toggle Fit All / 100%"
            >
              {zoomPct}%
            </button>
            <button
              type="button"
              onClick={() => adjustZoom(1.25)}
              className="p-1.5 cursor-pointer hover:opacity-80"
              style={{ color: "var(--text-secondary)" }}
              title="Zoom In"
            >
              <ZoomIn size={12} />
            </button>
            <button
              type="button"
              onClick={fitAllToViewport}
              className="flex items-center gap-1 px-2 py-1 border-l text-[10.5px] font-medium cursor-pointer"
              style={{
                borderColor: "var(--border-subtle)",
                backgroundColor: isAutoFit ? "var(--accent-soft)" : "transparent",
                color: isAutoFit ? "var(--accent)" : "var(--text-secondary)",
              }}
              title="Fit all images inside viewer"
            >
              <Maximize2 size={11} />
              <span>Fit</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAutoFit(false);
                setView({ zoom: 1, panX: 0, panY: 0 });
              }}
              className="p-1.5 border-l cursor-pointer hover:opacity-80"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              title="Reset to 100% center"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setCrispPixels((v) => !v)}
            className="px-2 py-1 rounded-md text-[10px] font-medium border cursor-pointer transition-colors"
            style={{
              borderColor: crispPixels ? "var(--accent)" : "var(--border-subtle)",
              backgroundColor: crispPixels ? "var(--accent-soft)" : "transparent",
              color: crispPixels ? "var(--accent)" : "var(--text-secondary)",
            }}
            title="Pixel-exact nearest-neighbor rendering"
          >
            Crisp
          </button>

          <div
            className="inline-flex items-center p-0.5 rounded-md border text-[10px]"
            style={{ borderColor: "var(--border-subtle)" }}
            title="Viewer Canvas Backdrop"
          >
            {(["checker", "grid", "dark", "light", "paper"] as BackdropMode[]).map((bg) => {
              const active = backdrop === bg;
              return (
                <button
                  key={bg}
                  type="button"
                  onClick={() => setBackdrop(bg)}
                  className="px-1.5 py-0.5 rounded capitalize cursor-pointer transition-colors"
                  style={{
                    backgroundColor: active ? "var(--accent)" : "transparent",
                    color: active ? "#FFFFFF" : "var(--text-muted)",
                  }}
                >
                  {bg}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Secondary Bar for Split / Overlay A vs B Selection ─── */}
      {(viewerMode === "split" || viewerMode === "overlay") && resolvedItems.list.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5 border-b text-[11px] shrink-0"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "rgba(255,255,255,0.02)",
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] uppercase tracking-wider opacity-70">Base A:</span>
              {resolvedItems.list.map((it) => {
                const isA = itemA?.path === it.path;
                return (
                  <button
                    key={`slotA-${it.path}`}
                    type="button"
                    onClick={() => setSlotAPath(it.path)}
                    className="px-2 py-0.5 rounded border text-[11px] max-w-[140px] truncate cursor-pointer"
                    style={{
                      borderColor: isA ? "var(--accent)" : "var(--border-subtle)",
                      backgroundColor: isA ? "var(--accent)" : "transparent",
                      color: isA ? "#FFFFFF" : "var(--text-secondary)",
                    }}
                    title={it.name}
                  >
                    {it.name}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-1 ml-2">
              <span className="text-[10px] uppercase tracking-wider opacity-70">Compare B:</span>
              {resolvedItems.list.map((it) => {
                const isB = itemB?.path === it.path;
                return (
                  <button
                    key={`slotB-${it.path}`}
                    type="button"
                    onClick={() => setSlotBPath(it.path)}
                    className="px-2 py-0.5 rounded border text-[11px] max-w-[140px] truncate cursor-pointer"
                    style={{
                      borderColor: isB ? "var(--accent)" : "var(--border-subtle)",
                      backgroundColor: isB ? "var(--accent)" : "transparent",
                      color: isB ? "#FFFFFF" : "var(--text-secondary)",
                    }}
                    title={it.name}
                  >
                    {it.name}
                  </button>
                );
              })}
            </div>
          </div>

          {viewerMode === "split" ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setSplitOrientation((o) => (o === "vertical" ? "horizontal" : "vertical"))
                }
                className="flex items-center gap-1 px-2 py-0.5 rounded border cursor-pointer"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                <SlidersHorizontal size={11} />
                <span>{splitOrientation === "vertical" ? "Vertical Split" : "Horizontal Split"}</span>
              </button>
              <span className="font-mono text-[10px] opacity-75">{Math.round(splitPercent)}%</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <Eye size={12} style={{ color: "var(--text-secondary)" }} />
                <span className="text-[10px] uppercase tracking-wider opacity-75">B Opacity</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={overlayOpacity}
                  onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                  className="w-24 accent-[var(--accent)] cursor-pointer"
                />
                <span className="font-mono text-[10px] w-8 text-right">{overlayOpacity}%</span>
              </label>

              <div
                className="inline-flex items-center p-0.5 rounded border text-[10px]"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                {(["normal", "difference", "exclusion", "multiply", "screen"] as BlendMode[]).map(
                  (m) => {
                    const active = blendMode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setBlendMode(m)}
                        className="px-1.5 py-0.5 rounded capitalize cursor-pointer"
                        style={{
                          backgroundColor: active ? "var(--accent)" : "transparent",
                          color: active ? "#FFFFFF" : "var(--text-muted)",
                        }}
                      >
                        {m}
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Single Unified Image Viewer Canvas ─────────────────── */}
      <div
        ref={containerRef}
        className={`flex-1 relative overflow-hidden flex items-center justify-center ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={backdropStyle}
        onWheel={handleCanvasWheel}
        onPointerDown={(e) => {
          if (!draggingSplitRef.current) handlePanStart(e);
        }}
        onPointerMove={(e) => {
          if (draggingSplitRef.current) {
            updateSplitFromPointer(e.clientX, e.clientY);
          } else {
            handlePanMove(e);
          }
        }}
        onPointerUp={(e) => {
          if (draggingSplitRef.current) {
            draggingSplitRef.current = false;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              // Ignore
            }
          }
          handlePanEnd(e);
        }}
        onPointerCancel={(e) => {
          draggingSplitRef.current = false;
          handlePanEnd(e);
        }}
        onDoubleClick={handleDoubleClick}
      >
        {resolvedItems.list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center p-6">
            <ImageIcon size={36} style={{ color: "var(--text-muted)" }} />
            <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              No images or SVGs loaded in viewer
            </div>
            {onAddItems && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsAddPickerOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                style={{ backgroundColor: "var(--accent)", color: "#FFFFFF" }}
              >
                <Plus size={14} />
                <span>Add Images / SVGs</span>
              </button>
            )}
          </div>
        ) : viewerMode === "split" && itemA && itemB ? (
          /* ── SPLIT SWIPE A vs B ON SINGLE VIEWPORT ── */
          <>
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{
                clipPath:
                  splitOrientation === "vertical"
                    ? `inset(0 0 0 ${splitPercent}%)`
                    : `inset(${splitPercent}% 0 0 0)`,
              }}
            >
              {itemB.renderUrl && (
                <img
                  src={itemB.renderUrl}
                  alt={itemB.name}
                  draggable={false}
                  style={{
                    height: matchScale ? `${MATCHED_BASE_HEIGHT}px` : "auto",
                    width: "auto",
                    maxWidth: "none",
                    maxHeight: "none",
                    transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
                    imageRendering: crispPixels ? "pixelated" : "auto",
                  }}
                />
              )}
            </div>

            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{
                clipPath:
                  splitOrientation === "vertical"
                    ? `inset(0 ${100 - splitPercent}% 0 0)`
                    : `inset(0 0 ${100 - splitPercent}% 0)`,
              }}
            >
              {itemA.renderUrl && (
                <img
                  src={itemA.renderUrl}
                  alt={itemA.name}
                  draggable={false}
                  style={{
                    height: matchScale ? `${MATCHED_BASE_HEIGHT}px` : "auto",
                    width: "auto",
                    maxWidth: "none",
                    maxHeight: "none",
                    transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
                    imageRendering: crispPixels ? "pixelated" : "auto",
                  }}
                />
              )}
            </div>

            <div
              onPointerDown={(e) => {
                e.stopPropagation();
                draggingSplitRef.current = true;
                containerRef.current?.setPointerCapture(e.pointerId);
                updateSplitFromPointer(e.clientX, e.clientY);
              }}
              className="absolute z-20 flex items-center justify-center"
              style={
                splitOrientation === "vertical"
                  ? {
                      left: `${splitPercent}%`,
                      top: 0,
                      bottom: 0,
                      width: "20px",
                      transform: "translateX(-50%)",
                      cursor: "ew-resize",
                    }
                  : {
                      top: `${splitPercent}%`,
                      left: 0,
                      right: 0,
                      height: "20px",
                      transform: "translateY(-50%)",
                      cursor: "ns-resize",
                    }
              }
            >
              <div
                style={
                  splitOrientation === "vertical"
                    ? {
                        width: "2px",
                        height: "100%",
                        backgroundColor: "var(--accent)",
                        boxShadow: "0 0 12px rgba(36, 87, 255, 0.7)",
                      }
                    : {
                        height: "2px",
                        width: "100%",
                        backgroundColor: "var(--accent)",
                        boxShadow: "0 0 12px rgba(36, 87, 255, 0.7)",
                      }
                }
              />
              <div
                className="absolute px-1.5 py-1 rounded-full shadow-lg border"
                style={{
                  backgroundColor: "var(--accent)",
                  borderColor: "rgba(255,255,255,0.45)",
                  color: "#FFFFFF",
                }}
              >
                <ArrowLeftRight size={11} />
              </div>
            </div>
          </>
        ) : viewerMode === "overlay" && itemA && itemB ? (
          /* ── OVERLAY BLEND ON SINGLE VIEWPORT ── */
          <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
            {itemA.renderUrl && (
              <img
                src={itemA.renderUrl}
                alt={itemA.name}
                draggable={false}
                style={{
                  height: matchScale ? `${MATCHED_BASE_HEIGHT}px` : "auto",
                  width: "auto",
                  maxWidth: "none",
                  maxHeight: "none",
                  transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
                  imageRendering: crispPixels ? "pixelated" : "auto",
                }}
              />
            )}
            {itemB.renderUrl && (
              <img
                src={itemB.renderUrl}
                alt={itemB.name}
                draggable={false}
                className="absolute"
                style={{
                  height: matchScale ? `${MATCHED_BASE_HEIGHT}px` : "auto",
                  width: "auto",
                  maxWidth: "none",
                  maxHeight: "none",
                  opacity: overlayOpacity / 100,
                  mixBlendMode: blendMode,
                  transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
                  imageRendering: crispPixels ? "pixelated" : "auto",
                }}
              />
            )}
          </div>
        ) : (
          /* ── UNIFIED SINGLE-CANVAS STAGE (ROW / STACK / BOARD) ── */
          <div
            ref={stageRef}
            style={{
              position: "relative",
              transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
              transformOrigin: "center center",
              transition: isPanning ? "none" : "transform 0.09s ease-out",
              display: viewerMode === "board" ? "grid" : "flex",
              flexDirection: viewerMode === "stack" ? "column" : "row",
              gridTemplateColumns:
                viewerMode === "board" ? `repeat(${boardCols}, auto)` : undefined,
              alignItems: "center",
              justifyItems: "center",
              gap: `${gapPx}px`,
            }}
            className="shrink-0 select-none"
          >
            {resolvedItems.list.map((item, idx) => {
              const isSelected = activePath === item.path;
              const badge = idx < 26 ? String.fromCharCode(65 + idx) : `#${idx + 1}`;
              return (
                <div
                  key={item.path}
                  ref={(el) => {
                    itemRefs.current[item.path] = el;
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePath(item.path);
                  }}
                  className="group relative shrink-0"
                  style={{
                    outline: isSelected ? "2px solid var(--accent)" : "1px solid rgba(255,255,255,0.08)",
                    outlineOffset: "2px",
                    borderRadius: "3px",
                    boxShadow: "0 12px 36px rgba(0, 0, 0, 0.35)",
                  }}
                >
                  {item.errorMsg || !item.renderUrl ? (
                    <div
                      className="flex flex-col items-center justify-center gap-2 p-8 bg-black/40 text-center"
                      style={{ width: "260px", height: "260px" }}
                    >
                      <AlertTriangle size={24} className="text-amber-400" />
                      <span className="text-xs text-amber-300">
                        {item.errorMsg || "Unable to preview"}
                      </span>
                    </div>
                  ) : (
                    <img
                      src={item.renderUrl}
                      alt={item.name}
                      draggable={false}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                          setDimensionsMap((prev) => {
                            const existing = prev[item.path];
                            if (
                              existing &&
                              existing.w === img.naturalWidth &&
                              existing.h === img.naturalHeight
                            ) {
                              return prev;
                            }
                            return {
                              ...prev,
                              [item.path]: { w: img.naturalWidth, h: img.naturalHeight },
                            };
                          });
                        }
                      }}
                      style={{
                        display: "block",
                        height: matchScale && viewerMode !== "stack" ? `${MATCHED_BASE_HEIGHT}px` : "auto",
                        width: matchScale && viewerMode === "stack" ? `${MATCHED_BASE_HEIGHT}px` : "auto",
                        maxWidth: "none",
                        maxHeight: "none",
                        imageRendering: crispPixels ? "pixelated" : "auto",
                        pointerEvents: "none",
                      }}
                    />
                  )}

                  {/* Minimal floating corner badge & hover quick actions (counter-scaled gently or unobtrusive) */}
                  {(showLabels || isSelected) && (
                    <div
                      className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium backdrop-blur-md pointer-events-none"
                      style={{
                        backgroundColor: "rgba(11, 14, 22, 0.72)",
                        border: "1px solid rgba(255,255,255,0.16)",
                        color: "#FFFFFF",
                        transform: `scale(${Math.max(0.75, Math.min(1.6, 1 / view.zoom))})`,
                        transformOrigin: "top left",
                      }}
                    >
                      <span
                        className="px-1 rounded text-[10px] font-bold"
                        style={{ backgroundColor: "var(--accent)", color: "#FFFFFF" }}
                      >
                        {badge}
                      </span>
                      <span className="max-w-[180px] truncate">{item.name}</span>
                    </div>
                  )}

                  {/* Hover-only open standalone / remove controls */}
                  <div
                    className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      transform: `scale(${Math.max(0.75, Math.min(1.6, 1 / view.zoom))})`,
                      transformOrigin: "top right",
                    }}
                  >
                    {onOpenSingle && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSingle(item);
                        }}
                        className="p-1 rounded-md backdrop-blur-md cursor-pointer"
                        style={{
                          backgroundColor: "rgba(11, 14, 22, 0.8)",
                          border: "1px solid rgba(255,255,255,0.18)",
                          color: "#FFFFFF",
                        }}
                        title="Open in standalone tab"
                      >
                        <ExternalLink size={12} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveItem(item.path);
                      }}
                      className="p-1 rounded-md backdrop-blur-md cursor-pointer"
                      style={{
                        backgroundColor: "rgba(11, 14, 22, 0.8)",
                        border: "1px solid rgba(255,255,255,0.18)",
                        color: "#FFFFFF",
                      }}
                      title="Remove from viewer"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick Hint */}
        <div
          className="absolute bottom-3 right-3 px-2 py-1 rounded text-[10px] pointer-events-none opacity-65 backdrop-blur-md"
          style={{
            backgroundColor: "rgba(12, 14, 22, 0.65)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#D1D5DB",
          }}
        >
          Drag canvas to pan · Scroll to zoom at cursor · Double-click to Fit / 100%
        </div>

        {/* ── Add Media Picker Popover ── */}
        {isAddPickerOpen && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(8, 10, 16, 0.65)", backdropFilter: "blur(6px)" }}
            onClick={() => setIsAddPickerOpen(false)}
          >
            <div
              className="glass-card w-full max-w-md rounded-xl border p-4 flex flex-col gap-3 shadow-2xl"
              style={{
                backgroundColor: "var(--bg-surface-elevated)",
                borderColor: "var(--border-subtle)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Add Images / SVGs to Viewer
                </h3>
                <button
                  type="button"
                  onClick={() => setIsAddPickerOpen(false)}
                  className="p-1 rounded hover:bg-white/10 cursor-pointer"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <X size={14} />
                </button>
              </div>

              <div
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border"
                style={{ borderColor: "var(--border-subtle)", backgroundColor: "rgba(0,0,0,0.2)" }}
              >
                <Search size={13} style={{ color: "var(--text-muted)" }} />
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Filter workspace images & SVGs..."
                  className="w-full bg-transparent text-xs outline-none"
                  style={{ color: "var(--text-primary)" }}
                  autoFocus
                />
              </div>

              <div className="max-h-60 overflow-y-auto flex flex-col gap-1 pr-1">
                {addableCandidates.length === 0 ? (
                  <div className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                    {availableCandidates.length === items.length
                      ? "All images and SVGs in this folder are already in the viewer."
                      : "No matching images or SVGs found."}
                  </div>
                ) : (
                  addableCandidates.map((cand) => {
                    const checked = pickerSelected.includes(cand.path);
                    return (
                      <button
                        key={cand.path}
                        type="button"
                        onClick={() => handleToggleCandidate(cand.path)}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-left cursor-pointer transition-colors"
                        style={{
                          borderColor: checked ? "var(--accent)" : "var(--border-subtle)",
                          backgroundColor: checked ? "var(--accent-soft)" : "transparent",
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-4 h-4 rounded flex items-center justify-center border shrink-0"
                            style={{
                              borderColor: checked ? "var(--accent)" : "var(--border-subtle)",
                              backgroundColor: checked ? "var(--accent)" : "transparent",
                              color: "#FFFFFF",
                            }}
                          >
                            {checked && <Check size={10} />}
                          </span>
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase shrink-0"
                            style={{
                              backgroundColor: "rgba(255,255,255,0.06)",
                              color: "var(--accent)",
                            }}
                          >
                            {cand.fileType === "svg" ? "SVG" : getFileExtension(cand.name)}
                          </span>
                          <span
                            className="text-xs truncate"
                            style={{ color: "var(--text-primary)" }}
                            title={cand.path}
                          >
                            {cand.name}
                          </span>
                        </div>
                        {cand.fileSize != null && (
                          <span
                            className="text-[10px] font-mono shrink-0"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {formatFileSize(cand.fileSize)}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPickerSelected([]);
                    setIsAddPickerOpen(false);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs border cursor-pointer"
                  style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pickerSelected.length === 0}
                  onClick={handleConfirmAdd}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-45"
                  style={{ backgroundColor: "var(--accent)", color: "#FFFFFF" }}
                >
                  Add {pickerSelected.length > 0 ? `(${pickerSelected.length})` : ""}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Single Shared Bottom Strip (Jump Chips + Active File Info) ─ */}
      {resolvedItems.list.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-t text-[11px] shrink-0"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--bg-surface-elevated)",
          }}
        >
          <div className="flex items-center gap-1 overflow-x-auto max-w-full">
            {resolvedItems.list.map((it, idx) => {
              const selected = activeItem?.path === it.path;
              const badge = idx < 26 ? String.fromCharCode(65 + idx) : `#${idx + 1}`;
              return (
                <div
                  key={`chip-${it.path}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border shrink-0 transition-colors"
                  style={{
                    borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
                    backgroundColor: selected ? "var(--accent-soft)" : "transparent",
                    color: selected ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => focusItemInCanvas(it.path)}
                    className="inline-flex items-center gap-1.5 cursor-pointer"
                    title={`Focus ${it.name}`}
                  >
                    <span
                      className="px-1 rounded text-[9px] font-bold"
                      style={{
                        backgroundColor: selected ? "var(--accent)" : "rgba(255,255,255,0.08)",
                        color: selected ? "#FFFFFF" : "var(--text-secondary)",
                      }}
                    >
                      {badge}
                    </span>
                    <span className="max-w-[140px] truncate text-[10.5px]">{it.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveItem(it.path)}
                    className="opacity-60 hover:opacity-100 cursor-pointer ml-0.5"
                    title={`Remove ${it.name}`}
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
          </div>

          {activeItem && (
            <div
              className="flex items-center gap-2 text-[10.5px] font-mono shrink-0"
              style={{ color: "var(--text-muted)" }}
            >
              <span>{activeItem.fileType === "svg" ? "SVG" : getFileExtension(activeItem.name)}</span>
              {activeDim ? (
                <span>
                  {activeDim.w} × {activeDim.h}
                </span>
              ) : (
                activeItem.svgMeta && <span>{activeItem.svgMeta}</span>
              )}
              {activeItem.fileSize != null && <span>{formatFileSize(activeItem.fileSize)}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
