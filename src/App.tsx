import React, { useState, useEffect, useCallback } from "react";
import {
  House, Folder, Settings as SettingsIcon,
  RefreshCw, Sun, Moon, Minus, Square, X,
  HardDrive, ArrowUpCircle, Download, Search,
  Clock, ChevronDown, Sparkles,
} from "lucide-react";

import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppConfig } from "./types";
import { openWorkspaceDir, removeRecentWorkspace } from "./lib/api";
import {
  applyThemeToDocument,
  migrateLegacyThemeConfig,
  QUANTUM_DARK_OVERRIDES,
  QUANTUM_LIGHT_OVERRIDES,
  THEME_VERSION,
} from "./utils/theme";
import { Onboarding } from "./components/Onboarding";
import { CommandPalette } from "./components/CommandPalette";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { WorktreeProvider } from "./lib/WorktreeContext";
import { WorktreeSwitcher } from "./components/WorktreeManager";
import { DirtyStateProvider } from "./lib/DirtyStateContext";
import GhostFibers from "./components/GhostFibers";
import { ComposerLogo } from "./components/ComposerLogo";

// Page Components (Code-split with React.lazy for instant startup)
const Home           = React.lazy(() => import("./components/Home").then(m => ({ default: m.Home })));
const Explorer       = React.lazy(() => import("./components/Explorer").then(m => ({ default: m.Explorer })));
const Settings       = React.lazy(() => import("./components/Settings").then(m => ({ default: m.Settings })));

// ─────────────────────────────────────────────
// Valid Pages
// ─────────────────────────────────────────────
const VALID_PAGES = ["Home", "Explorer", "Settings"];

// ─────────────────────────────────────────────
// Navigation definition
// ─────────────────────────────────────────────
const NAV_ITEMS = [
  { name: "Home",     label: "Overview",        icon: <House        size={14} className="nav-icon-home"     /> },
  { name: "Explorer", label: "Files",           icon: <Folder       size={14} className="nav-icon-explorer" /> },
  { name: "Settings", label: "Settings",        icon: <SettingsIcon size={14} className="nav-icon-settings" /> },
];

// ─────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────

// PERF-7: leaf component — the 15s telemetry poll re-renders only these circular rings,
// not the whole app tree (Explorer's file list, Home, etc.)
function CircularUsageMeter({
  label,
  value,
  baseColor,
  updatedAt,
}: {
  label: string;
  value: number;
  baseColor: string;
  updatedAt?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const visualPct = clamped > 0 ? Math.max(4, clamped) : 0;
  const r = 6.5;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - visualPct / 100);
  const strokeColor =
    clamped >= 88
      ? "#EF4444"
      : clamped >= 68
        ? "#F59E0B"
        : baseColor;

  return (
    <span
      className="inline-flex items-center gap-1.5 select-none"
      title={updatedAt ? `${label} Utilization: ${clamped}% (Updated ${updatedAt})` : `${label} Utilization: ${clamped}%`}
      aria-label={`${label} Utilization: ${clamped}%`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 18 18"
        className="shrink-0"
        aria-hidden="true"
      >
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="2.4"
        />
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 9 9)"
          style={{
            transition: "stroke-dashoffset 450ms cubic-bezier(0.23, 1, 0.32, 1), stroke 250ms ease",
          }}
        />
        <circle
          cx="9"
          cy="9"
          r="1.5"
          fill={strokeColor}
          fillOpacity="0.85"
        />
      </svg>
      <span className="font-mono text-[10px] font-medium tracking-wide text-[var(--text-muted)]">
        {label}
      </span>
    </span>
  );
}

const TELEMETRY_INTERVAL_MS = 15000;

function SystemResourceMeters() {
  const [cpuPct, setCpuPct] = useState<number>(0);
  const [ramPct, setRamPct] = useState<number>(0);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let lastFetchMs = 0;

    const fetchStats = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const [cpuRes, ramRes] = await Promise.allSettled([
          invoke<number>("get_system_cpu_usage"),
          invoke<number>("get_system_ram_usage"),
        ]);
        if (cancelled) return;
        let updated = false;
        if (cpuRes.status === "fulfilled" && typeof cpuRes.value === "number") {
          setCpuPct(cpuRes.value);
          updated = true;
        }
        if (ramRes.status === "fulfilled" && typeof ramRes.value === "number") {
          setRamPct(ramRes.value);
          updated = true;
        }
        if (updated) {
          lastFetchMs = Date.now();
          setUpdatedAt(new Date().toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }));
        }
      } catch {
        /* ignore telemetry errors */
      } finally {
        inFlight = false;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastFetchMs >= 10000) {
        fetchStats();
      }
    };

    fetchStats();
    const timer = setInterval(fetchStats, TELEMETRY_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <span className="inline-flex items-center gap-2.5">
      <CircularUsageMeter
        label="CPU"
        value={cpuPct}
        baseColor="var(--accent-rose, #00D4FF)"
        updatedAt={updatedAt}
      />
      <CircularUsageMeter
        label="RAM"
        value={ramPct}
        baseColor="var(--accent-text, var(--accent))"
        updatedAt={updatedAt}
      />
    </span>
  );
}

function App() {
  const [activePage,  setActivePage]  = useState<string>("Home");
  const [config,      setConfig]      = useState<AppConfig | null>(null);
  const normalizeNavLayout = (layout?: string): "top_navbar" | "bottom_navbar" => {
    return layout === "bottom_navbar" ? "bottom_navbar" : "top_navbar";
  };
  const [navLayout,   setNavLayout]   = useState<"top_navbar" | "bottom_navbar">("top_navbar");
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [isWorkspaceSwitcherOpen, setIsWorkspaceSwitcherOpen] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const hasAppliedLaunchPageRef = React.useRef<boolean>(false);

  type LoadingPhase = "loading" | "reveal-app" | "done";
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("loading");

  // null = not yet determined, true = show onboarding, false = skip
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [installPath, setInstallPath] = useState<string>("");
  const [cachePath,   setCachePath]   = useState<string>("");

  // ── Auto-Update State on Launch ─────────────
  interface LaunchUpdateInfo {
    version: string;
    body?: string;
    updateObj: any;
  }
  const [launchUpdateInfo, setLaunchUpdateInfo] = useState<LaunchUpdateInfo | null>(null);
  const [isUpdatingFromToast, setIsUpdatingFromToast] = useState<boolean>(false);


  // ── Apply theme from config ─────────────────
  const applyTheme = (cfg: AppConfig) => {
    applyThemeToDocument(
      cfg.theme?.ui_overrides ?? {},
      cfg.theme?.font_family_ui,
      cfg.theme?.theme_preset
    );
  };

  // ── Load config on boot ─────────────────────
  const loadConfig = async () => {
    try {
      const rawCfg    = await invoke<AppConfig>("get_app_config");
      const { cfg, changed } = migrateLegacyThemeConfig(rawCfg);
      if (changed) {
        invoke("save_app_config", { config: cfg }).catch(() => {});
      }
      const iPath     = await invoke<string>("get_app_install_path");
      const cPath     = await invoke<string>("get_cache_path");
      setConfig(cfg);
      setInstallPath(iPath);
      setCachePath(cPath);
      setNavLayout(normalizeNavLayout(cfg.theme.nav_layout));
      if (!hasAppliedLaunchPageRef.current) {
        hasAppliedLaunchPageRef.current = true;
        setActivePage(prev => {
          if (prev === "Home" && cfg.general.launch_page) {
            return VALID_PAGES.includes(cfg.general.launch_page) ? cfg.general.launch_page : "Home";
          }
          return prev;
        });
      }
      applyTheme(cfg);

      // ── Onboarding guard (must happen BEFORE reveal-app) ──
      if (!cfg.general.onboarding_completed) {
        setShowOnboarding(true);
        // Reveal the onboarding screen (still over app shell)
        setTimeout(() => setLoadingPhase("reveal-app"), 180);
        setTimeout(() => setLoadingPhase("done"), 420);
      } else {
        setShowOnboarding(false);
        setTimeout(() => setLoadingPhase("reveal-app"), 480);
        setTimeout(() => setLoadingPhase("done"), 820);
      }

      // ── Silent auto-update check on launch if enabled in config ──
      if (cfg.general.auto_update) {
        setTimeout(async () => {
          try {
            const { check } = await import("@tauri-apps/plugin-updater");
            const update = await check();
            if (update) {
              setLaunchUpdateInfo({
                version: update.version,
                body: update.body || "",
                updateObj: update,
              });
            }
          } catch (e) {
            console.warn("Silent background update check:", e);
          }
        }, 2000);
      }
    } catch (err) {

      console.error("loadConfig error:", err);
      // On error fall through to app with no onboarding
      setShowOnboarding(false);
      setTimeout(() => setLoadingPhase("reveal-app"), 200);
      setTimeout(() => setLoadingPhase("done"), 380);
    }
  };

  // ── Called when user finishes onboarding ────
  const handleOnboardingComplete = (updatedConfig: AppConfig) => {
    setConfig(updatedConfig);
    applyTheme(updatedConfig);
    setNavLayout(normalizeNavLayout(updatedConfig.theme.nav_layout));
    setShowOnboarding(false);
    // Notify Explorer (and any other listeners) that the workspace path changed
    emit("config_updated");
  };

  // ── Toggle dark / light (Quantum Blue Default Theme) ─────────
  const isDarkMode = config?.theme?.theme_preset !== "light";

  const toggleThemeMode = async () => {
    if (!config) return;
    const nextPreset = isDarkMode ? "light" : "dark";
    const curOv = config.theme.ui_overrides || {};
    const baseModeOv = isDarkMode ? QUANTUM_LIGHT_OVERRIDES : QUANTUM_DARK_OVERRIDES;
    const nextOv: Record<string, string> = {
      ...curOv,
      ...baseModeOv,
      ghost_fiber_glow: curOv.ghost_fiber_glow || baseModeOv.ghost_fiber_glow,
      ghost_fiber_secondary: curOv.ghost_fiber_secondary || baseModeOv.ghost_fiber_secondary,
      ghost_fiber_line: curOv.ghost_fiber_line || baseModeOv.ghost_fiber_line,
      ghost_fiber_opacity: curOv.ghost_fiber_opacity || baseModeOv.ghost_fiber_opacity,
      ghost_fiber_style: curOv.ghost_fiber_style || baseModeOv.ghost_fiber_style,
      ghost_fiber_enabled: curOv.ghost_fiber_enabled || baseModeOv.ghost_fiber_enabled,
      navbar_edge_smoothness: curOv.navbar_edge_smoothness || "8px",
      ui_edge_smoothness: curOv.ui_edge_smoothness || "8px",
      theme_version: THEME_VERSION,
    };

    const nextConfig = {
      ...config,
      theme: {
        ...config.theme,
        theme_preset: nextPreset,
        accent_color: "#2457FF",
        ui_overrides: nextOv,
      },
    };
    setConfig(nextConfig);
    applyTheme(nextConfig);
    await invoke("save_app_config", { config: nextConfig }).catch(() => {});
    await emit("config_updated", nextConfig);
  };

  // ── Ghost Fiber settings from theme config (Quantum Blue Default) ─
  const ghostFiberGlow = config?.theme?.ui_overrides?.ghost_fiber_glow || "#2457FF";
  const ghostFiberSecondary = config?.theme?.ui_overrides?.ghost_fiber_secondary || "#00D4FF";
  const ghostFiberLine = config?.theme?.ui_overrides?.ghost_fiber_line || "#DFF7FF";
  const ghostFiberOpacity = parseFloat(config?.theme?.ui_overrides?.ghost_fiber_opacity || "0.45");
  const ghostFiberStyle = (config?.theme?.ui_overrides?.ghost_fiber_style as "dots" | "dashes" | "lines") || "dots";
  const ghostFiberEnabled = config?.theme?.ui_overrides?.ghost_fiber_enabled !== "false";

  // ── Home Action Handlers & Workspace Handlers ─────────────────
  const handleOpenRecentFile = useCallback((path: string, name: string) => {
    setActivePage("Explorer");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("composer:open-file", { detail: { path, name } }));
    }, 40);
  }, []);

  const handleNewFile = useCallback(() => {
    setActivePage("Explorer");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("composer:home-action", { detail: "file" }));
    }, 40);
  }, []);

  const handleNewFolder = useCallback(() => {
    setActivePage("Explorer");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("composer:home-action", { detail: "folder" }));
    }, 40);
  }, []);

  const handleImport = useCallback(() => {
    setActivePage("Explorer");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("composer:home-action", { detail: "import-file" }));
    }, 40);
  }, []);

  const handleNavigate = useCallback((page: string) => setActivePage(page), []);

  const handleSelectWorkspace = useCallback(async (path: string) => {
    try {
      const updatedConfig = await openWorkspaceDir(path);
      setConfig(updatedConfig);
      applyTheme(updatedConfig);
      await emit("config_updated", updatedConfig);
    } catch (err: any) {
      alert("Failed to switch workspace: " + (err?.toString() || "Unknown error"));
    }
  }, []);

  const handleRemoveRecentWorkspace = useCallback(async (path: string) => {
    try {
      const updatedConfig = await removeRecentWorkspace(path);
      setConfig(updatedConfig);
      await emit("config_updated", updatedConfig);
    } catch (err: any) {
      console.error("Failed to remove recent workspace:", err);
    }
  }, []);

  const handleOpenProject = useCallback(async () => {
    try {
      const chosen: string | null = await invoke("pick_directory");
      if (chosen) {
        await handleSelectWorkspace(chosen);
      }
    } catch (err) {
      console.error("Failed to select workspace directory:", err);
    }
  }, [handleSelectWorkspace]);

  // ── Effects ─────────────────────────────────
  useEffect(() => {
    loadConfig();

    // Block native browser context menu
    const noCtx = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", noCtx);

    const configUnsub = listen<AppConfig | null>("config_updated", e => {
      if (e.payload) {
        const cfg = e.payload;
        setConfig(cfg);
        setNavLayout(normalizeNavLayout(cfg.theme.nav_layout));
        applyTheme(cfg);
      } else {
        loadConfig();
      }
    });
    const layoutUnsub = listen<string>("nav_layout_changed", e => setNavLayout(normalizeNavLayout(e.payload)));

    return () => {
      document.removeEventListener("contextmenu", noCtx);
      configUnsub.then(fn  => fn());
      layoutUnsub.then(fn  => fn());
    };
  }, []);

  useEffect(() => {
    const handleUnsavedStatus = (e: any) => {
      if (e.detail && typeof e.detail.hasUnsaved === "boolean") {
        setHasUnsavedChanges(e.detail.hasUnsaved);
      }
    };
    window.addEventListener("composer:unsaved-changed", handleUnsavedStatus);
    return () => window.removeEventListener("composer:unsaved-changed", handleUnsavedStatus);
  }, []);

  // Wire global custom events from context menus / quick actions
  useEffect(() => {
    const handleOpenWorkspaceSwitcher = () => setIsWorkspaceSwitcherOpen(true);
    const handleOpenAsWorkspace = (e: any) => {
      if (e.detail?.path) handleSelectWorkspace(e.detail.path);
    };
    // composer:create-worktree → open the WorktreeSwitcher dropdown by toggling a flag
    // The WorktreeSwitcher will listen to this event and open its "Create" dialog.
    const handleCreateWorktree = () => {
      window.dispatchEvent(new CustomEvent("composer:worktree-open-create"));
    };
    window.addEventListener("composer:open-workspace-switcher", handleOpenWorkspaceSwitcher);
    window.addEventListener("composer:open-as-workspace",       handleOpenAsWorkspace);
    window.addEventListener("composer:create-worktree",         handleCreateWorktree);
    return () => {
      window.removeEventListener("composer:open-workspace-switcher", handleOpenWorkspaceSwitcher);
      window.removeEventListener("composer:open-as-workspace",       handleOpenAsWorkspace);
      window.removeEventListener("composer:create-worktree",         handleCreateWorktree);
    };
  }, [handleSelectWorkspace]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        window.location.reload();
      }

      if (e.key === "F11") {
        e.preventDefault();
        getCurrentWindow().isFullscreen().then(isFS => {
          getCurrentWindow().setFullscreen(!isFS);
        }).catch(() => {});
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (target?.closest(".monaco-editor")) return;
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        if (target?.closest(".monaco-editor")) return;
        e.preventDefault();
        if (activePage === "Explorer") {
          const input = document.getElementById("explorer-search-input");
          if (input) { input.focus(); (input as HTMLInputElement).select(); }
        } else if (activePage === "Home") {
          const input = document.getElementById("home-search-input");
          if (input) { input.focus(); (input as HTMLInputElement).select(); }
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [activePage]);

  // Mouse side-button navigation
  useEffect(() => {
    const block    = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) e.preventDefault(); };
    const navigate = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      const pages = NAV_ITEMS.map(i => i.name);
      const cur   = pages.indexOf(activePage);
      if (cur === -1) return;
      setActivePage(e.button === 3
        ? pages[(cur - 1 + pages.length) % pages.length]
        : pages[(cur + 1) % pages.length]
      );
    };
    window.addEventListener("mousedown", block);
    window.addEventListener("mouseup",   navigate);
    return () => {
      window.removeEventListener("mousedown", block);
      window.removeEventListener("mouseup",   navigate);
    };
  }, [activePage]);

  // ── Helpers ──────────────────────────────────
  const iconOnly = config?.theme?.ui_overrides?.nav_icon_only === "true";

  const renderPages = () => (
    <React.Suspense
      fallback={
        <div className="flex-1 flex flex-col items-center justify-center h-full" style={{ color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "12px" }}>
          <RefreshCw size={18} style={{ color: "var(--accent)", marginBottom: "8px" }} className="animate-spin" />
          <span>Loading workspace...</span>
        </div>
      }
    >
      {/* Inactive pages unmount so React.lazy only fetches their chunks on demand.
          Explorer stays mounted (hidden) so open tabs and drafts survive navigation. */}
      {activePage === "Home" && (
        <div className="h-full w-full">
          <Home
            key={config?.storage?.workspace_path || "empty"}
            workspacePath={config?.storage?.workspace_path || ""}
            onNavigate={handleNavigate}
            onOpenRecentFile={handleOpenRecentFile}
            onNewFile={handleNewFile}
            onNewFolder={handleNewFolder}
            onImport={handleImport}
            onOpenProject={() => setIsWorkspaceSwitcherOpen(true)}
            recentWorkspaces={config?.storage?.recent_workspaces || []}
            onSelectWorkspace={handleSelectWorkspace}
            onRemoveRecentWorkspace={handleRemoveRecentWorkspace}
          />
        </div>
      )}
      <div className={`h-full w-full ${activePage === "Explorer" ? "block" : "hidden"}`}>
        <Explorer />
      </div>
      {activePage === "Settings" && (
        <div className="h-full w-full">
          <Settings />
        </div>
      )}
    </React.Suspense>
  );

  // ─────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────
  return (
    <DirtyStateProvider>
    <WorktreeProvider workspacePath={config?.storage?.workspace_path || ""}>
    <div className="relative h-screen w-screen overflow-hidden" style={{ backgroundColor: "var(--bg-app, #0B0F19)" }}>
      {/* ── Global Ambient Background GhostFibers (Entire App) ── */}
      {ghostFiberEnabled && (
        <div
          className="fixed inset-0 pointer-events-none overflow-hidden transition-opacity duration-700"
          style={{
            zIndex: 0,
            opacity: loadingPhase !== "done" ? Math.max(ghostFiberOpacity, 0.85) : ghostFiberOpacity,
          }}
        >
          <GhostFibers
            glowColor={ghostFiberGlow}
            secondaryColor={ghostFiberSecondary}
            lineColor={ghostFiberLine}
            layers={3}
            twist={1.2}
            threads={72}
            fiberStyle={ghostFiberStyle}
            depthOfField={0.85}
            hoverEffect="focus"
            intro={true}
            mouseInteraction={true}
            lightMode={!isDarkMode}
          />
        </div>
      )}

      {/* Main Application Container */}
      <div
        className={`c2-app relative z-10 transition-opacity duration-500 ease-out ${
          (loadingPhase === "reveal-app" || loadingPhase === "done") ? "opacity-100" : "opacity-0"
        }`}
      >

        {/* ── Custom OS Title Bar ─────────────────────────────── */}
        <div
          className="c2-titlebar"
          data-tauri-drag-region
          onMouseDown={async (e) => {
            if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
              try { await getCurrentWindow().startDragging(); }
              catch (err) { console.error("Failed to drag window:", err); }
            }
          }}
        >
          {/* Brand */}
          <div className="c2-titlebar-brand" data-tauri-drag-region>
            <ComposerLogo size={16} />
            <span className="c2-titlebar-brand-text">Composer</span>
          </div>

          {/* Drag fill & Quick search trigger */}
          <div className="c2-titlebar-drag flex items-center justify-center" data-tauri-drag-region>
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="c2-titlebar-search-btn"
              title="Command Palette & Quick Search (Ctrl+K)"
            >
              <Search size={13} style={{ color: "var(--accent)" }} className="shrink-0" />
              <span className="truncate">Search or jump to...</span>
              <kbd className="c2-titlebar-kbd">Ctrl K</kbd>
            </button>
          </div>

          {/* Window controls */}
          <div className="c2-titlebar-controls">
            <button
              onClick={() => getCurrentWindow().minimize()}
              className="c2-winbtn"
              title="Minimize"
            >
              <Minus size={10} />
            </button>
            <button
              onClick={() => getCurrentWindow().toggleMaximize()}
              className="c2-winbtn"
              title="Maximize / Restore"
            >
              <Square size={9} />
            </button>
            <button
              onClick={() => getCurrentWindow().close()}
              className="c2-winbtn c2-winbtn--close"
              title="Close"
            >
              <X size={11} />
            </button>
          </div>
        </div>

        {/* ── Redesigned Top Navbar (v0.4) ─────────────────────────── */}
        {navLayout === "top_navbar" && (
          <header className="c2-topnav">
            {/* Left: Workspace Selector & Worktree */}
            <div className="flex items-center gap-2 justify-self-start">
              <button
                onClick={() => setIsWorkspaceSwitcherOpen(true)}
                className="c2-nav-glass-btn flex items-center gap-2 px-3 h-[32px] rounded-lg text-[12px] text-[var(--text-primary)] transition-all cursor-pointer group"
                title="Switch workspace"
              >
                <Folder size={14} className="text-[var(--accent)] shrink-0" />
                <span className="font-medium text-[12px] max-w-[140px] truncate text-[var(--text-primary)]">
                  {config?.storage?.workspace_path?.split(/[\\\/]/).filter(Boolean).pop() || "Select Workspace"}
                </span>
                <ChevronDown size={12} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-transform shrink-0" />
              </button>

              {config?.storage?.workspace_path && (
                <WorktreeSwitcher
                  workspacePath={config.storage.workspace_path}
                  workspaceId={config.storage.workspace_path}
                />
              )}
            </div>

            {/* Center: Navigation Pill Group */}
            <nav className="c2-topnav-pill-group justify-self-center" aria-label="Main Navigation">
              {NAV_ITEMS.map(item => {
                const isActive = activePage === item.name;
                return (
                  <button
                    key={item.name}
                    onClick={() => setActivePage(item.name)}
                    className={`c2-topnav-pill ${isActive ? "active" : ""}`}
                    title={item.label}
                  >
                    {React.cloneElement(item.icon, {
                      size: 13,
                      className: isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]",
                    })}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Right: Theme toggle */}
            <div className="flex items-center gap-2 justify-self-end">
              <button
                onClick={toggleThemeMode}
                className="c2-nav-glass-btn h-[30px] w-[30px] flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {isDarkMode ? (
                  <Sun size={13} style={{ color: "var(--accent-text, var(--accent))" }} />
                ) : (
                  <Moon size={13} style={{ color: "var(--accent)" }} />
                )}
              </button>
            </div>
          </header>
        )}

        {/* ── Main Viewport Area (Full-Width, No Sidebars) ──────── */}
        <div className="c2-body">
          <div className="c2-viewport select-text">
            {renderPages()}
          </div>
        </div>

        {/* ── Bottom Navbar / Status Bar ────────────────────────────── */}
        {navLayout === "bottom_navbar" ? (
          <footer className="c2-bottomnav">
            {/* Left: Workspace Selector & Worktree */}
            <div className="flex items-center gap-2 justify-self-start">
              <button
                onClick={() => setIsWorkspaceSwitcherOpen(true)}
                className="c2-nav-glass-btn flex items-center gap-2 px-3 h-[32px] rounded-lg text-[12px] text-[var(--text-primary)] transition-all cursor-pointer group"
                title="Switch workspace"
              >
                <Folder size={14} className="text-[var(--accent)] shrink-0" />
                <span className="font-medium text-[12px] max-w-[140px] truncate text-[var(--text-primary)]">
                  {config?.storage?.workspace_path?.split(/[\\\/]/).filter(Boolean).pop() || "Select Workspace"}
                </span>
                <ChevronDown size={12} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-transform shrink-0" />
              </button>
              {config?.storage?.workspace_path && (
                <WorktreeSwitcher
                  workspacePath={config.storage.workspace_path}
                  workspaceId={config.storage.workspace_path}
                />
              )}
            </div>

            {/* Center: Navigation Pill Group */}
            <nav className="c2-topnav-pill-group justify-self-center" aria-label="Main Navigation">
              {NAV_ITEMS.map(item => {
                const isActive = activePage === item.name;
                return (
                  <button
                    key={item.name}
                    onClick={() => setActivePage(item.name)}
                    className={`c2-topnav-pill ${isActive ? "active" : ""}`}
                    title={item.label}
                  >
                    {React.cloneElement(item.icon, {
                      size: 13,
                      className: isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]",
                    })}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Right: CPU & RAM rings + Theme Toggle */}
            <div className="flex items-center gap-3 justify-self-end">
              <SystemResourceMeters />
              <button
                onClick={toggleThemeMode}
                className="c2-nav-glass-btn h-[28px] w-[28px] flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {isDarkMode ? (
                  <Sun size={12} style={{ color: "var(--accent-text, var(--accent))" }} />
                ) : (
                  <Moon size={12} style={{ color: "var(--accent)" }} />
                )}
              </button>
            </div>
          </footer>
        ) : (
          /* Sleek modern bottom status bar when navLayout === 'top_navbar' */
          <footer className="c2-statusbar">
            {/* Left: Active workspace path & worktree info */}
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="flex items-center gap-1 font-mono text-[10.5px] truncate max-w-[280px]" title={config?.storage?.workspace_path || "No workspace selected"}>
                <Folder size={11} className="text-[var(--accent)] shrink-0" />
                <span className="truncate">{config?.storage?.workspace_path || "No workspace opened"}</span>
              </span>
              {hasUnsavedChanges && (
                <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-[9.5px] bg-[rgba(245,158,11,0.12)] text-[#f59e0b] border border-[rgba(245,158,11,0.25)] font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] animate-pulse" />
                  Unsaved Changes
                </span>
              )}
            </div>

            {/* Center: Keyboard hints */}
            <div className="flex items-center gap-3 text-[10.5px] text-[var(--text-muted)] hidden sm:flex">
              <span><kbd className="px-1 py-0.2 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] font-mono text-[9px]">Ctrl+K</kbd> Command Palette</span>
              <span><kbd className="px-1 py-0.2 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] font-mono text-[9px]">Ctrl+S</kbd> Save</span>
            </div>

            {/* Right: Sandbox status, CPU & RAM circular meters & version */}
            <div className="flex items-center gap-2.5 text-[10.5px]">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                Sandboxed
              </span>
              <span>·</span>
              <SystemResourceMeters />
              <span>·</span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">v0.4.0</span>
            </div>
          </footer>
        )}

      </div>

      {/* Onboarding overlay — rendered after loading phase clears */}
      {showOnboarding === true && loadingPhase === "done" && config && (
        <Onboarding
          config={config}
          installPath={installPath}
          cachePath={cachePath}
          onComplete={handleOnboardingComplete}
        />
      )}

      {/* Loading Overlay (transparent smoked glass so GhostFibers shows through behind it) */}
      {loadingPhase !== "done" && (
        <div
          className={`absolute inset-0 z-50 flex flex-col items-center justify-center select-none loading-bg-fadein transition-opacity duration-500 ease-out ${
            loadingPhase === "reveal-app" ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"
          }`}
          style={{
            background: isDarkMode
              ? "radial-gradient(circle at center, rgba(11, 15, 25, 0.16) 0%, rgba(11, 15, 25, 0.52) 100%)"
              : "radial-gradient(circle at center, rgba(240, 244, 248, 0.22) 0%, rgba(240, 244, 248, 0.56) 100%)",
          }}
        >
          <div className="mb-4">
            <ComposerLogo size={54} />
          </div>
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "24px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "var(--accent)",
            }}
          >
            Composer
          </span>
          <div className="mt-7">
            <svg className="w11-spinner-svg" viewBox="0 0 50 50" style={{ width: 34, height: 34 }}>
              <circle
                className="w11-spinner-path"
                cx="25" cy="25" r="20"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      )}

      {/* ── Auto-Update Toast on Launch ──────────────────────────── */}
      {launchUpdateInfo && (

        <div style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 9999,
          backgroundColor: "var(--bg-surface-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-md, 8px)",
          padding: "12px 16px",
          boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          maxWidth: "340px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <ArrowUpCircle size={15} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
                Update Available: v{launchUpdateInfo.version}
              </span>
            </div>
            <button
              onClick={() => setLaunchUpdateInfo(null)}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "2px" }}
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.4 }}>
            A newer version of Composer is available. Update now to get the latest features.
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <button
              disabled={isUpdatingFromToast}
              onClick={async () => {
                try {
                  setIsUpdatingFromToast(true);
                  await launchUpdateInfo.updateObj.downloadAndInstall();
                  const { relaunch } = await import("@tauri-apps/plugin-process");
                  await relaunch();
                } catch (e) {
                  console.error("Toast update error:", e);
                  setIsUpdatingFromToast(false);
                }
              }}
              style={{
                flex: 1,
                padding: "6px 10px",
                backgroundColor: "var(--accent)",
                color: "#FFFFFF",
                fontWeight: 600,
                fontSize: "11px",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "5px",
              }}
            >
              {isUpdatingFromToast ? (
                <>
                  <RefreshCw size={11} className="animate-spin" />
                  <span>Updating…</span>
                </>
              ) : (
                <>
                  <Download size={11} />
                  <span>Update Now</span>
                </>
              )}
            </button>
            <button
              onClick={() => {
                setActivePage("Settings");
                setLaunchUpdateInfo(null);
              }}
              style={{
                padding: "6px 10px",
                backgroundColor: "var(--bg-surface-elevated)",
                border: "1px solid var(--border-default)",
                color: "var(--text-secondary)",
                borderRadius: "4px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              View
            </button>
          </div>
        </div>
      )}

      {/* ── Command Palette (Ctrl+K) ─────────────────────────── */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={setActivePage}
        onOpenFile={handleOpenRecentFile}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
        onImport={handleImport}
        onOpenProject={handleOpenProject}
        onToggleTheme={toggleThemeMode}
        isDarkMode={isDarkMode}
        onRefreshIndex={async () => {
          await invoke("invalidate_workspace_index");
          emit("config_updated");
        }}
      />

      {/* ── Workspace Switcher Dialog ─────────────────────────── */}
      <WorkspaceSwitcher
        isOpen={isWorkspaceSwitcherOpen}
        onClose={() => setIsWorkspaceSwitcherOpen(false)}
        currentWorkspace={config?.storage?.workspace_path || ""}
        recentWorkspaces={config?.storage?.recent_workspaces || []}
        onSelectWorkspace={handleSelectWorkspace}
        onOpenDirectory={handleOpenProject}
        onRemoveRecent={handleRemoveRecentWorkspace}
        hasUnsavedChanges={hasUnsavedChanges}
      />

    </div>
    </WorktreeProvider>
    </DirtyStateProvider>
  );

}

export default App;
