import React, { useState, useEffect } from "react";
import {
  Folder, Settings as SettingsIcon,
  RefreshCw, Sun, Moon, Minus, Square, X,
  HardDrive
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppConfig } from "./types";

// Page Components (Code-split with React.lazy for instant startup)
const Explorer = React.lazy(() => import("./components/Explorer").then(m => ({ default: m.Explorer })));
const Settings = React.lazy(() => import("./components/Settings").then(m => ({ default: m.Settings })));

// ─────────────────────────────────────────────
// Font presets (must match Settings.tsx)
// ─────────────────────────────────────────────
const FONT_PRESETS = [
  { id: "editorial",    text: '"Inter", sans-serif',        display: '"Inter", sans-serif',         sans: '"Inter", sans-serif' },
  { id: "neo_classical",text: '"Inter", sans-serif',        display: '"Inter", sans-serif',         sans: '"Inter", sans-serif' },
  { id: "inter",        text: '"Inter", sans-serif',        display: '"Inter", sans-serif',         sans: '"Inter", sans-serif' },
  { id: "modern_sans",  text: '"Inter", sans-serif',        display: '"Inter", sans-serif',         sans: '"Inter", sans-serif' },
  { id: "monospace",    text: '"JetBrains Mono", monospace',display: '"JetBrains Mono", monospace', sans: '"JetBrains Mono", monospace' },
  { id: "retro_serif",  text: '"Georgia", serif',           display: '"Georgia", serif',             sans: '"Georgia", serif' },
  { id: "outfit",       text: '"Outfit", sans-serif',       display: '"Outfit", sans-serif',         sans: '"Outfit", sans-serif' },
  { id: "spacemono",    text: '"Space Mono", monospace',    display: '"Space Mono", monospace',      sans: '"Space Mono", monospace' },
  { id: "firacode",     text: '"Fira Code", monospace',     display: '"Fira Code", monospace',       sans: '"Fira Code", monospace' },
  { id: "lexend",       text: '"Lexend", sans-serif',       display: '"Lexend", sans-serif',         sans: '"Lexend", sans-serif' },
];

// ─────────────────────────────────────────────
// Navigation definition  (AI / Scheduler removed)
// ─────────────────────────────────────────────
const NAV_ITEMS = [
  { name: "Explorer", label: "Explorer", icon: <Folder     size={14} className="nav-icon-explorer"  /> },
  { name: "Settings", label: "Settings", icon: <SettingsIcon size={14} className="nav-icon-settings"/> },
];

// ─────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────
function App() {
  const [activePage,  setActivePage]  = useState<string>("Explorer");
  const [config,      setConfig]      = useState<AppConfig | null>(null);
  const [navLayout,   setNavLayout]   = useState<string>("sidebar");
  const [sysRamUsage, setSysRamUsage] = useState<number>(0);

  type LoadingPhase = "loading" | "reveal-app" | "done";
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("loading");

  // ── Snappy Launch Sequence ──────────────────
  useEffect(() => {
    const timer1 = setTimeout(() => setLoadingPhase("reveal-app"), 200);
    const timer2 = setTimeout(() => setLoadingPhase("done"), 380);
    return () => { clearTimeout(timer1); clearTimeout(timer2); };
  }, []);

  // ── Apply theme from config ─────────────────
  const applyTheme = (cfg: AppConfig) => {
    const root = document.documentElement;
    const ov   = cfg.theme.ui_overrides ?? {};

    // Map user-customized colors to CSS variables
    const paperColor  = ov.nav_background     || "#141310";
    const inkColor    = ov.text_color         || "#F3EFE8";
    const creamColor  = ov.card_background    || "#1B1814";
    const ruleColor   = ov.card_border        || "rgba(255,255,255,0.08)";
    const accentColor = ov.border_accent      || "#E5B45F";

    root.style.setProperty("--theme-paper",  paperColor);
    root.style.setProperty("--theme-ink",    inkColor);
    root.style.setProperty("--theme-cream",  creamColor);
    root.style.setProperty("--theme-rule",   ruleColor);
    root.style.setProperty("--theme-accent", accentColor);

    // Also update the new token variables so new CSS classes pick them up
    root.style.setProperty("--bg-app",              paperColor);
    root.style.setProperty("--bg-sidebar",          paperColor);
    root.style.setProperty("--bg-surface",          creamColor);
    root.style.setProperty("--bg-surface-elevated", creamColor);
    root.style.setProperty("--text-primary",        inkColor);
    root.style.setProperty("--accent",              accentColor);

    const lightRuleColor = ruleColor.startsWith("#") && ruleColor.length === 7
      ? `${ruleColor}3a`
      : ruleColor;
    root.style.setProperty("--theme-light-rule", lightRuleColor);

    const mutedColor = inkColor.startsWith("#") && inkColor.length === 7
      ? `${inkColor}90`
      : "#71685E";
    root.style.setProperty("--theme-muted", mutedColor);
    root.style.setProperty("--text-muted",  mutedColor);

    // Glow
    const glowOn     = ov.accent_glow === "true";
    const brightness = parseFloat(ov.accent_glow_brightness || "1.0");
    const accentClr  = ov.border_accent || "#E5B45F";
    const borderGlowRadius = Math.round(10 * brightness);
    const textGlowRadius   = Math.round(5  * brightness);
    const baseAlpha        = Math.min(1.0, brightness);
    const borderAlphaHex   = Math.round(baseAlpha * 255).toString(16).padStart(2, "0");
    const textAlphaHex     = Math.round(baseAlpha * 0.5 * 255).toString(16).padStart(2, "0");
    const borderGlowColor  = accentClr.startsWith("#") && accentClr.length === 7 ? `${accentClr}${borderAlphaHex}` : accentClr;
    const textGlowColor    = accentClr.startsWith("#") && accentClr.length === 7 ? `${accentClr}${textAlphaHex}` : `${accentClr}80`;
    root.style.setProperty("--theme-accent-glow",      glowOn ? `0 0 ${borderGlowRadius}px ${borderGlowColor}` : "none");
    root.style.setProperty("--theme-accent-text-glow", glowOn ? `0 0 ${textGlowRadius}px ${textGlowColor}` : "none");

    // Font
    const font = FONT_PRESETS.find(f => f.id === (cfg.theme.font_family_ui || "inter")) || FONT_PRESETS[2];
    root.style.setProperty("--theme-font-text",    font.text);
    root.style.setProperty("--theme-font-display", font.display);
    root.style.setProperty("--theme-font-sans",    font.sans);

    root.style.setProperty("--navbar-edge-smoothness", ov.navbar_edge_smoothness || "4px");
    root.style.setProperty("--ui-edge-smoothness",     ov.ui_edge_smoothness     || "4px");
  };

  // ── Load config on boot ─────────────────────
  const loadConfig = async () => {
    try {
      const cfg: AppConfig = await invoke("get_app_config");
      setConfig(cfg);
      setNavLayout(cfg.theme.nav_layout || "sidebar");
      setActivePage(prev => {
        if (prev === "Explorer" && cfg.general.launch_page) {
          // Scheduler was removed — fall back to Explorer if config references it
          return cfg.general.launch_page === "Scheduler" ? "Explorer" : cfg.general.launch_page;
        }
        return prev;
      });
      applyTheme(cfg);
    } catch (err) {
      console.error("loadConfig error:", err);
    }
  };

  // ── Toggle dark / light ─────────────────────
  const isDarkMode = (() => {
    const ink = config?.theme?.ui_overrides?.text_color ?? "#F3EFE8";
    const inkLower = ink.trim().toLowerCase();
    // Light mode if the text color is dark (i.e. dark ink on light paper)
    return !(inkLower === "#18140f" || inkLower === "#1a1510" || inkLower.startsWith("#1") || inkLower.startsWith("#2") || inkLower.startsWith("#3"));
  })();

  const toggleThemeMode = async () => {
    if (!config) return;
    const nextOv = isDarkMode
      ? {
          ...config.theme.ui_overrides,
          nav_background:     "#F5F1EB",
          content_background: "#F5F1EB",
          card_background:    "#E8E2D8",
          card_border:        "#D4CEC6",
          text_color:         "#1A1510",
          border_accent:      "#C47A20",
        }
      : {
          ...config.theme.ui_overrides,
          nav_background:     "#141310",
          content_background: "#141310",
          card_background:    "#1B1814",
          card_border:        "rgba(255,255,255,0.08)",
          text_color:         "#F3EFE8",
          border_accent:      "#E5B45F",
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
    const taskUnsub   = listen("task_status_changed",  () => {});
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
      taskUnsub.then(fn    => fn());
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

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        if (target?.closest(".monaco-editor")) return;
        e.preventDefault();
        if (activePage === "Explorer") {
          const input = document.getElementById("explorer-search-input");
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

    </div>
  );
}

export default App;
