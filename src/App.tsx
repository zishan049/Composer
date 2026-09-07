import React, { useState, useEffect } from "react";
import {
  House, Folder, Settings as SettingsIcon,
  RefreshCw, Sun, Moon, Minus, Square, X,
  HardDrive, ArrowUpCircle, Download
} from "lucide-react";

import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppConfig } from "./types";
import { applyTypographyToRoot } from "./utils/fonts";
import { Onboarding } from "./components/Onboarding";

// Page Components (Code-split with React.lazy for instant startup)
const Home     = React.lazy(() => import("./components/Home").then(m => ({ default: m.Home })));
const Explorer = React.lazy(() => import("./components/Explorer").then(m => ({ default: m.Explorer })));
const Settings = React.lazy(() => import("./components/Settings").then(m => ({ default: m.Settings })));

// ─────────────────────────────────────────────
// Valid Pages
// ─────────────────────────────────────────────
const VALID_PAGES = ["Home", "Explorer", "Settings"];

// ─────────────────────────────────────────────
// Navigation definition (Home, Explorer, Settings)
// ─────────────────────────────────────────────
const NAV_ITEMS = [
  { name: "Home",     label: "Home",     icon: <House        size={14} className="nav-icon-home"     /> },
  { name: "Explorer", label: "Explorer", icon: <Folder       size={14} className="nav-icon-explorer" /> },
  { name: "Settings", label: "Settings", icon: <SettingsIcon size={14} className="nav-icon-settings" /> },
];

// ─────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────
function App() {
  const [activePage,  setActivePage]  = useState<string>("Home");
  const [config,      setConfig]      = useState<AppConfig | null>(null);
  const [navLayout,   setNavLayout]   = useState<string>("sidebar");
  const [sysRamUsage, setSysRamUsage] = useState<number>(0);

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
    const root = document.documentElement;
    const ov   = cfg.theme.ui_overrides ?? {};

    // Map user-customized colors to CSS variables
    const paperColor  = ov.nav_background     || "#000000";
    const inkColor    = ov.text_color         || "#FFFFFF";
    const creamColor  = ov.card_background    || "#0F0F0F";
    const ruleColor   = ov.card_border        || "rgba(255,255,255,0.10)";
    const accentColor = ov.border_accent      || "#FFFFFF";

    root.style.setProperty("--theme-paper",  paperColor);
    root.style.setProperty("--theme-ink",    inkColor);
    root.style.setProperty("--theme-cream",  creamColor);
    root.style.setProperty("--theme-rule",   ruleColor);
    root.style.setProperty("--theme-accent", accentColor);

    // Also update the new token variables so new CSS classes pick them up
    root.style.setProperty("--bg-app",              paperColor);
    root.style.setProperty("--bg-sidebar",          paperColor);
    root.style.setProperty("--bg-surface",          creamColor);
    const isLight = (paperColor === "#FFFFFF" || paperColor === "#ffffff" || paperColor === "#FAFAFA" || paperColor === "#fafafa" || paperColor.toLowerCase().startsWith("#f") || inkColor === "#000000");

    const textSec = isLight ? "#27272A" : "#D4D4D8";
    const textMut = isLight ? "#52525B" : "#A1A1AA";
    const textFnt = isLight ? "#71717A" : "#71717A";
    const elevatedBg = isLight ? "#E4E4E7" : (creamColor === "#0F0F0F" ? "#171717" : creamColor);
    const borderSubtle = isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.07)";
    const borderDefault = isLight ? "rgba(0, 0, 0, 0.14)" : "rgba(255, 255, 255, 0.12)";
    const borderStrong = isLight ? "rgba(0, 0, 0, 0.24)" : "rgba(255, 255, 255, 0.20)";
    const accentSoft = isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.10)";
    const navHoverBg = isLight ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.05)";
    const navActiveBg = isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.10)";

    root.style.setProperty("--bg-surface-elevated", elevatedBg);
    root.style.setProperty("--text-secondary",      textSec);
    root.style.setProperty("--text-muted",          textMut);
    root.style.setProperty("--theme-muted",         textMut);
    root.style.setProperty("--text-faint",          textFnt);
    root.style.setProperty("--border-subtle",       borderSubtle);
    root.style.setProperty("--border-default",      borderDefault);
    root.style.setProperty("--border-strong",       borderStrong);
    root.style.setProperty("--accent-soft",         accentSoft);
    root.style.setProperty("--sidebar-nav-hover-bg", navHoverBg);
    root.style.setProperty("--sidebar-nav-active-bg", navActiveBg);
    root.style.setProperty("--bg-titlebar",         paperColor);
    root.style.setProperty("--text-primary",        inkColor);
    root.style.setProperty("--accent",              accentColor);

    const lightRuleColor = ruleColor.startsWith("#") && ruleColor.length === 7
      ? `${ruleColor}3a`
      : ruleColor;
    root.style.setProperty("--theme-light-rule", lightRuleColor);

    // Glow
    const glowOn     = ov.accent_glow === "true";
    const brightness = parseFloat(ov.accent_glow_brightness || "1.0");
    const accentClr  = ov.border_accent || "#FFFFFF";
    const borderGlowRadius = Math.round(10 * brightness);
    const textGlowRadius   = Math.round(5  * brightness);
    const baseAlpha        = Math.min(1.0, brightness);
    const borderAlphaHex   = Math.round(baseAlpha * 255).toString(16).padStart(2, "0");
    const textAlphaHex     = Math.round(baseAlpha * 0.5 * 255).toString(16).padStart(2, "0");
    const borderGlowColor  = accentClr.startsWith("#") && accentClr.length === 7 ? `${accentClr}${borderAlphaHex}` : accentClr;
    const textGlowColor    = accentClr.startsWith("#") && accentClr.length === 7 ? `${accentClr}${textAlphaHex}` : `${accentClr}80`;
    root.style.setProperty("--theme-accent-glow",      glowOn ? `0 0 ${borderGlowRadius}px ${borderGlowColor}` : "none");
    root.style.setProperty("--theme-accent-text-glow", glowOn ? `0 0 ${textGlowRadius}px ${textGlowColor}` : "none");

    // Typography System
    applyTypographyToRoot(root, cfg.theme.font_family_ui);

    // Smoothness / Border Radius
    const navSmooth = ov.navbar_edge_smoothness !== undefined && ov.navbar_edge_smoothness !== ""
      ? ov.navbar_edge_smoothness
      : "4px";
    const uiSmooth = ov.ui_edge_smoothness !== undefined && ov.ui_edge_smoothness !== ""
      ? ov.ui_edge_smoothness
      : "4px";
    root.style.setProperty("--navbar-edge-smoothness", navSmooth);
    root.style.setProperty("--ui-edge-smoothness",     uiSmooth);
  };

  // ── Load config on boot ─────────────────────
  const loadConfig = async () => {
    try {
      const cfg       = await invoke<AppConfig>("get_app_config");
      const iPath     = await invoke<string>("get_app_install_path");
      const cPath     = await invoke<string>("get_cache_path");
      setConfig(cfg);
      setInstallPath(iPath);
      setCachePath(cPath);
      setNavLayout(cfg.theme.nav_layout || "sidebar");
      setActivePage(prev => {
        if (prev === "Home" && cfg.general.launch_page) {
          return VALID_PAGES.includes(cfg.general.launch_page) ? cfg.general.launch_page : "Home";
        }
        return prev;
      });
      applyTheme(cfg);

      // ── Onboarding guard (must happen BEFORE reveal-app) ──
      if (!cfg.general.onboarding_completed) {
        setShowOnboarding(true);
        // Reveal the onboarding screen (still over app shell)
        setTimeout(() => setLoadingPhase("reveal-app"), 80);
        setTimeout(() => setLoadingPhase("done"), 260);
      } else {
        setShowOnboarding(false);
        setTimeout(() => setLoadingPhase("reveal-app"), 200);
        setTimeout(() => setLoadingPhase("done"), 380);
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
    setNavLayout(updatedConfig.theme.nav_layout || "sidebar");
    setShowOnboarding(false);
    // Notify Explorer (and any other listeners) that the workspace path changed
    emit("config_updated");
  };

  // ── Toggle dark / light ─────────────────────
  const isDarkMode = (() => {
    const bg = (config?.theme?.ui_overrides?.nav_background ?? "#000000").trim().toLowerCase();
    if (bg === "#ffffff" || bg === "#fafafa" || bg === "#f4f4f5" || bg === "#f5f1eb" || bg === "#f6f2ea") return false;
    const ink = (config?.theme?.ui_overrides?.text_color ?? "#FFFFFF").trim().toLowerCase();
    return !(ink === "#000000" || ink === "#18140f" || ink === "#1a1510" || ink.startsWith("#0") || ink.startsWith("#1") || ink.startsWith("#2") || ink.startsWith("#3"));
  })();

  const toggleThemeMode = async () => {
    if (!config) return;
    const nextOv = isDarkMode
      ? {
          ...config.theme.ui_overrides,
          nav_background:     "#FFFFFF",
          content_background: "#FFFFFF",
          card_background:    "#F4F4F5",
          card_border:        "rgba(0, 0, 0, 0.12)",
          text_color:         "#000000",
          border_accent:      "#000000",
        }
      : {
          ...config.theme.ui_overrides,
          nav_background:     "#000000",
          content_background: "#000000",
          card_background:    "#0F0F0F",
          card_border:        "rgba(255, 255, 255, 0.12)",
          text_color:         "#FFFFFF",
          border_accent:      "#FFFFFF",
        };

    const nextConfig = { ...config, theme: { ...config.theme, ui_overrides: nextOv } };
    setConfig(nextConfig);
    applyTheme(nextConfig);
    await invoke("save_app_config", { config: nextConfig });
    await emit("config_updated", nextConfig);
  };

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
        setNavLayout(cfg.theme.nav_layout || "sidebar");
        applyTheme(cfg);
      } else {
        loadConfig();
      }
    });
    const layoutUnsub = listen<string>("nav_layout_changed", e => setNavLayout(e.payload));

    // RAM polling every 2s
    const fetchRam = async () => {
      try { const pct: number = await invoke("get_system_ram_usage"); setSysRamUsage(pct); }
      catch { /* ignore */ }
    };
    fetchRam();
    const ramTimer = setInterval(fetchRam, 2000);

    return () => {
      document.removeEventListener("contextmenu", noCtx);
      configUnsub.then(fn  => fn());
      layoutUnsub.then(fn  => fn());
      clearInterval(ramTimer);
    };
  }, []);

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
        if (activePage !== "Home") {
          setActivePage("Home");
        }
        setTimeout(() => {
          const input = document.getElementById("home-search-input");
          if (input) { input.focus(); (input as HTMLInputElement).select(); }
        }, 50);
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

  // ── Home Action Handlers ───────────────────────
  const handleOpenRecentFile = (path: string, name: string) => {
    setActivePage("Explorer");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("composer:open-file", { detail: { path, name } }));
    }, 40);
  };

  const handleNewFile = () => {
    setActivePage("Explorer");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("composer:home-action", { detail: "file" }));
    }, 40);
  };

  const handleNewFolder = () => {
    setActivePage("Explorer");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("composer:home-action", { detail: "folder" }));
    }, 40);
  };

  const handleImport = () => {
    setActivePage("Explorer");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("composer:home-action", { detail: "import-file" }));
    }, 40);
  };

  const handleOpenProject = async () => {
    try {
      const chosen: string | null = await invoke("pick_directory");
      if (chosen) {
        const cfg: AppConfig = await invoke("get_app_config");
        const nextConfig: AppConfig = {
          ...cfg,
          storage: {
            ...cfg.storage,
            workspace_path: chosen,
          },
        };
        await invoke("save_app_config", { config: nextConfig });
        await emit("config_updated", nextConfig);
        setActivePage("Explorer");
      }
    } catch (err) {
      console.error("Failed to select workspace directory:", err);
    }
  };

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
      <div className={`h-full w-full ${activePage === "Home" ? "block" : "hidden"}`}>
        <Home
          onNavigate={(page) => setActivePage(page)}
          onOpenRecentFile={handleOpenRecentFile}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onImport={handleImport}
          onOpenProject={handleOpenProject}
        />
      </div>
      <div className={`h-full w-full ${activePage === "Explorer" ? "block" : "hidden"}`}>
        <Explorer />
      </div>
      <div className={`h-full w-full ${activePage === "Settings" ? "block" : "hidden"}`}>
        <Settings />
      </div>
    </React.Suspense>
  );

  // ─────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Main Application Container */}
      <div
        className={`c2-app transition-opacity duration-500 ease-out ${
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
            <img src="/icon.ico" alt="Composer" draggable={false} />
            <span className="c2-titlebar-brand-text">Composer</span>
          </div>

          {/* Drag fill */}
          <div className="c2-titlebar-drag" data-tauri-drag-region />

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

        {/* ── Top Navbar layout ─────────────────────────────── */}
        <div
          className="c2-topnav"
          style={{
            height:            navLayout === "top_navbar" ? "44px" : "0px",
            opacity:           navLayout === "top_navbar" ? 1 : 0,
            borderBottomWidth: navLayout === "top_navbar" ? "1px" : "0px",
            pointerEvents:     navLayout === "top_navbar" ? "auto" : "none",
          }}
        >
          {/* Brand */}
          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--accent)" }}>Composer</span>

          {/* Nav pills */}
          <div className="c2-topnav-pill-group">
            {NAV_ITEMS.map(item => {
              const ico = React.cloneElement(item.icon, { size: 13 });
              return (
                <button
                  key={item.name}
                  onClick={() => setActivePage(item.name)}
                  className={`c2-topnav-pill ${activePage === item.name ? "active" : ""}`}
                  title={item.label}
                >
                  {ico}
                  {!iconOnly && <span style={{ fontSize: "12px" }}>{item.label}</span>}
                </button>
              );
            })}
            <div style={{ width: "1px", height: "14px", backgroundColor: "var(--border-default)", margin: "0 3px" }} />
            <button
              onClick={toggleThemeMode}
              className="c2-topnav-pill"
              title="Toggle Light / Dark"
            >
              {isDarkMode ? <Sun size={13} style={{ color: "var(--accent)" }} /> : <Moon size={13} style={{ color: "var(--accent)" }} />}
            </button>
          </div>

          {/* RAM */}
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>{sysRamUsage}%</span> RAM
          </span>
        </div>

        {/* ── Main layout frame ────────────────────────────── */}
        <div
          className="c2-body"
          style={{
            paddingLeft:  navLayout === "vertical_pills"       ? "2px" : "0px",
            paddingRight: navLayout === "right_vertical_pills" ? "2px" : "0px",
            transition: "padding 0.25s ease",
          }}
        >

          {/* Left Fixed Sidebar */}
          <div
            className="c2-sidebar"
            style={{
              width:         navLayout === "sidebar" ? "var(--sidebar-width)" : "0px",
              opacity:       navLayout === "sidebar" ? 1 : 0,
              pointerEvents: navLayout === "sidebar" ? "auto" : "none",
            }}
          >
            {/* Brand */}
            <div className="c2-sidebar-brand">
              <img src="/icon.ico" alt="" draggable={false} />
              <span className="c2-sidebar-brand-text">Composer</span>
            </div>

            {/* Navigation */}
            <nav className="c2-sidebar-nav">
              {NAV_ITEMS.map(item => (
                <button
                  key={item.name}
                  onClick={() => setActivePage(item.name)}
                  className={`c2-nav-item ${activePage === item.name ? "active" : ""}`}
                  title={item.label}
                >
                  <span className="c2-nav-item-icon">{item.icon}</span>
                  {!iconOnly && <span className="c2-nav-item-label">{item.label}</span>}
                </button>
              ))}
            </nav>

            {/* Spacer */}
            <div className="c2-sidebar-spacer" />

            {/* Footer */}
            <div className="c2-sidebar-footer">
              <button
                onClick={toggleThemeMode}
                className="c2-theme-toggle"
                title="Toggle Light / Dark"
              >
                <span className="c2-nav-item-icon">
                  {isDarkMode
                    ? <Sun  size={13} style={{ color: "var(--accent)" }} />
                    : <Moon size={13} style={{ color: "var(--accent)" }} />}
                </span>
                {!iconOnly && <span className="c2-nav-item-label">Appearance</span>}
              </button>

              <div className="c2-sidebar-divider" />

              <div className="c2-workspace-status">
                <HardDrive size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <div className="c2-workspace-status-info">
                  <span className="c2-workspace-label">Workspace</span>
                  <span className="c2-workspace-online">
                    <span className="c2-online-dot" />
                    Online · {sysRamUsage}% RAM
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Content viewport — always full remaining width */}
          <div className="c2-viewport select-text">
            {renderPages()}
          </div>

          {/* Right Fixed Sidebar */}
          <div
            className="c2-sidebar"
            style={{
              width:        navLayout === "right_sidebar" ? "var(--sidebar-width)" : "0px",
              opacity:      navLayout === "right_sidebar" ? 1 : 0,
              pointerEvents: navLayout === "right_sidebar" ? "auto" : "none",
              borderRight:  "none",
              borderLeft:   "1px solid var(--border-subtle)",
            }}
          >
            <div className="c2-sidebar-brand">
              <img src="/icon.ico" alt="" draggable={false} />
              <span className="c2-sidebar-brand-text">Composer</span>
            </div>
            <nav className="c2-sidebar-nav">
              {NAV_ITEMS.map(item => (
                <button
                  key={item.name}
                  onClick={() => setActivePage(item.name)}
                  className={`c2-nav-item ${activePage === item.name ? "active" : ""}`}
                  title={item.label}
                >
                  <span className="c2-nav-item-icon">{item.icon}</span>
                  {!iconOnly && <span className="c2-nav-item-label">{item.label}</span>}
                </button>
              ))}
            </nav>
            <div className="c2-sidebar-spacer" />
            <div className="c2-sidebar-footer">
              <button onClick={toggleThemeMode} className="c2-theme-toggle" title="Toggle Light / Dark">
                <span className="c2-nav-item-icon">
                  {isDarkMode ? <Sun size={13} style={{ color: "var(--accent)" }} /> : <Moon size={13} style={{ color: "var(--accent)" }} />}
                </span>
                {!iconOnly && <span className="c2-nav-item-label">Appearance</span>}
              </button>
              <div className="c2-sidebar-divider" />
              <div className="c2-workspace-status">
                <HardDrive size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <div className="c2-workspace-status-info">
                  <span className="c2-workspace-label">Workspace</span>
                  <span className="c2-workspace-online">
                    <span className="c2-online-dot" />
                    Online · {sysRamUsage}% RAM
                  </span>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* ── Floating Left Pill Bar (position:fixed, over content) ─ */}
        {(navLayout === "vertical_pills") && (
          <div className="c2-pillbar c2-pillbar--left">
            {NAV_ITEMS.map(item => (
              <button
                key={item.name}
                onClick={() => setActivePage(item.name)}
                className={`c2-pill-item ${activePage === item.name ? "active" : ""}`}
              >
                {item.icon}
                <span className="c2-pill-tooltip">{item.label}</span>
              </button>
            ))}
            <div className="c2-pill-divider" />
            <button
              onClick={toggleThemeMode}
              className="c2-pill-item"
            >
              {isDarkMode
                ? <Sun  size={13} style={{ color: "var(--accent)" }} />
                : <Moon size={13} style={{ color: "var(--accent)" }} />}
              <span className="c2-pill-tooltip">Appearance</span>
            </button>
          </div>
        )}

        {/* ── Floating Right Pill Bar (position:fixed, over content) ─ */}
        {(navLayout === "right_vertical_pills") && (
          <div className="c2-pillbar c2-pillbar--right">
            {NAV_ITEMS.map(item => (
              <button
                key={item.name}
                onClick={() => setActivePage(item.name)}
                className={`c2-pill-item ${activePage === item.name ? "active" : ""}`}
              >
                {item.icon}
                <span className="c2-pill-tooltip">{item.label}</span>
              </button>
            ))}
            <div className="c2-pill-divider" />
            <button
              onClick={toggleThemeMode}
              className="c2-pill-item"
            >
              {isDarkMode
                ? <Sun  size={13} style={{ color: "var(--accent)" }} />
                : <Moon size={13} style={{ color: "var(--accent)" }} />}
              <span className="c2-pill-tooltip">Appearance</span>
            </button>
          </div>
        )}



        {/* ── Bottom Navbar layout ───────────────────────────── */}
        <div
          className="c2-topnav"
          style={{
            height:         navLayout === "bottom_navbar" ? "44px" : "0px",
            opacity:        navLayout === "bottom_navbar" ? 1 : 0,
            borderTopWidth: navLayout === "bottom_navbar" ? "1px" : "0px",
            borderBottom:   "none",
            borderTop:      navLayout === "bottom_navbar" ? "1px solid var(--border-default)" : "none",
            pointerEvents:  navLayout === "bottom_navbar" ? "auto" : "none",
          }}
        >
          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--accent)" }}>Composer</span>
          <div className="c2-topnav-pill-group">
            {NAV_ITEMS.map(item => {
              const ico = React.cloneElement(item.icon, { size: 13 });
              return (
                <button
                  key={item.name}
                  onClick={() => setActivePage(item.name)}
                  className={`c2-topnav-pill ${activePage === item.name ? "active" : ""}`}
                  title={item.label}
                >
                  {ico}
                  {!iconOnly && <span style={{ fontSize: "12px" }}>{item.label}</span>}
                </button>
              );
            })}
            <div style={{ width: "1px", height: "14px", backgroundColor: "var(--border-default)", margin: "0 3px" }} />
            <button onClick={toggleThemeMode} className="c2-topnav-pill" title="Toggle Appearance">
              {isDarkMode ? <Sun size={13} style={{ color: "var(--accent)" }} /> : <Moon size={13} style={{ color: "var(--accent)" }} />}
            </button>
          </div>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>{sysRamUsage}%</span> RAM
          </span>
        </div>

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

      {/* Loading Overlay */}
      {loadingPhase !== "done" && (
        <div
          className={`absolute inset-0 z-50 flex flex-col items-center justify-center select-none loading-bg-fadein transition-opacity duration-500 ease-out ${
            loadingPhase === "reveal-app" ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"
          }`}
          style={{ backgroundColor: "var(--bg-app)" }}
        >
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
          <div className="mt-8">
            <svg className="w11-spinner-svg" viewBox="0 0 50 50" style={{ width: 36, height: 36 }}>
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
          backgroundColor: "var(--bg-surface)",
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
                color: "#000000",
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

    </div>
  );

}

export default App;
