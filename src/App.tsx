import React, { useState, useEffect } from "react";
import {
  Folder, MessageSquare, Code, History, Settings as SettingsIcon,
  Cpu, RefreshCw, Sun, Moon, Minus, Square, X
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppConfig } from "./types";

// Page Components
import { Explorer } from "./components/Explorer";
import { Chat } from "./components/Chat";
import { Skills } from "./components/Skills";
import { Scheduler } from "./components/Scheduler";
import { Settings } from "./components/Settings";

// ─────────────────────────────────────────────
// Font presets (must match Settings.tsx)
// ─────────────────────────────────────────────
const FONT_PRESETS = [
  { id: "editorial",  text: '"EB Garamond", serif',   display: '"Playfair Display", serif', sans: '"Inter", sans-serif' },
  { id: "neo_classical", text: '"EB Garamond", serif', display: '"EB Garamond", serif',     sans: '"Inter", sans-serif' },
  { id: "inter",      text: '"Inter", sans-serif',     display: '"Inter", sans-serif',       sans: '"Inter", sans-serif' },
  { id: "lexend",     text: '"Lexend", sans-serif',    display: '"Lexend", sans-serif',       sans: '"Lexend", sans-serif' },
];

// ─────────────────────────────────────────────
// Navigation definition
// ─────────────────────────────────────────────
const NAV_ITEMS = [
  { name: "Explorer",  label: "Explorer",    icon: <Folder      size={14} className="nav-icon-explorer"  /> },
  { name: "Chat",      label: "Assistant",   icon: <MessageSquare size={14} className="nav-icon-chat"   /> },
  { name: "Skills",    label: "AI Skills",   icon: <Code        size={14} className="nav-icon-skills"   /> },
  { name: "Scheduler", label: "Automation",  icon: <History     size={14} className="nav-icon-scheduler"/> },
  { name: "Settings",  label: "System",      icon: <SettingsIcon size={14} className="nav-icon-settings"/> },
];

// ─────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────
function App() {
  const [activePage,  setActivePage]  = useState<string>("Explorer");
  const [config,      setConfig]      = useState<AppConfig | null>(null);
  const [navLayout,   setNavLayout]   = useState<string>("sidebar");
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [sysRamUsage, setSysRamUsage] = useState<number>(0);
  const [welcomeText, setWelcomeText] = useState("");
  const WELCOME_MSG = "Welcome back! 👋";

  // Delayed typewriter welcome message in sidebars
  useEffect(() => {
    const delay = setTimeout(() => {
      let i = 0;
      const iv = setInterval(() => {
        if (i < WELCOME_MSG.length) {
          setWelcomeText(WELCOME_MSG.substring(0, i + 1));
          i++;
        } else {
          clearInterval(iv);
        }
      }, 55);
      return () => clearInterval(iv);
    }, 1200);
    return () => clearTimeout(delay);
  }, []);


  type LoadingPhase = "loading" | "exit-spinner" | "exit-text" | "reveal-app" | "done";
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("loading");
  const [typedText, setTypedText] = useState("");
  const fullText = "Composer";

  // ── 10s Loading Screen sequence ──
  useEffect(() => {
    // Start typing after a short delay so the background can fade in first
    const typeDelay = setTimeout(() => {
      let index = 0;
      const typeInterval = setInterval(() => {
        if (index < fullText.length) {
          setTypedText(fullText.substring(0, index + 1));
          index++;
        } else {
          clearInterval(typeInterval);
        }
      }, 150);
      return () => clearInterval(typeInterval);
    }, 800); // 800ms delay for background fade-in

    // 10.0s: Hide spinner
    const timer1 = setTimeout(() => {
      setLoadingPhase("exit-spinner");
    }, 10000);

    // 10.4s: Hide text
    const timer2 = setTimeout(() => {
      setLoadingPhase("exit-text");
    }, 10400);

    // 10.8s: Reveal app (fade out overlay, fade in app)
    const timer3 = setTimeout(() => {
      setLoadingPhase("reveal-app");
    }, 10800);

    // 11.3s: Fully done, unmount overlay
    const timer4 = setTimeout(() => {
      setLoadingPhase("done");
    }, 11300);

    return () => {
      clearTimeout(typeDelay);
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
    };
  }, []);

  // ── Apply theme from config ───────────────
  const applyTheme = (cfg: AppConfig) => {
    const root = document.documentElement;
    const ov   = cfg.theme.ui_overrides ?? {};

    const paperColor = ov.nav_background || "#f6f2ea";
    const inkColor   = ov.text_color || "#18140f";
    const creamColor = ov.card_background || "#ede8dc";
    const ruleColor  = ov.card_border || "#c9bfab";
    const accentColor = ov.border_accent || "#b8440c";

    root.style.setProperty("--theme-paper",  paperColor);
    root.style.setProperty("--theme-ink",    inkColor);
    root.style.setProperty("--theme-cream",  creamColor);
    root.style.setProperty("--theme-rule",   ruleColor);
    root.style.setProperty("--theme-accent", accentColor);

    // Dynamic light rule (soft dividers) and text-muted based on hex colors
    const lightRuleColor = ruleColor.startsWith("#") && ruleColor.length === 7
      ? `${ruleColor}3a` // ~23% opacity
      : ruleColor;
    root.style.setProperty("--theme-light-rule", lightRuleColor);

    const mutedColor = inkColor.startsWith("#") && inkColor.length === 7
      ? `${inkColor}90` // ~56% opacity
      : "#8a7f6e";
    root.style.setProperty("--theme-muted", mutedColor);

    const glowOn     = ov.accent_glow === "true";
    const brightness = parseFloat(ov.accent_glow_brightness || "1.0");
    const accentClr  = ov.border_accent || "#b8440c";

    const borderGlowRadius = Math.round(10 * brightness);
    const textGlowRadius = Math.round(5 * brightness);

    const baseAlpha = Math.min(1.0, brightness);
    const borderAlphaHex = Math.round(baseAlpha * 255).toString(16).padStart(2, "0");
    const textAlphaHex = Math.round(baseAlpha * 0.5 * 255).toString(16).padStart(2, "0");

    const borderGlowColor = accentClr.startsWith("#") && accentClr.length === 7
      ? `${accentClr}${borderAlphaHex}`
      : accentClr;
    const textGlowColor = accentClr.startsWith("#") && accentClr.length === 7
      ? `${accentClr}${textAlphaHex}`
      : `${accentClr}80`;

    root.style.setProperty("--theme-accent-glow",      glowOn ? `0 0 ${borderGlowRadius}px ${borderGlowColor}` : "none");
    root.style.setProperty("--theme-accent-text-glow", glowOn ? `0 0 ${textGlowRadius}px ${textGlowColor}` : "none");

    const font = FONT_PRESETS.find(f => f.id === (cfg.theme.font_family_ui || "editorial")) || FONT_PRESETS[0];
    root.style.setProperty("--theme-font-text",    font.text);
    root.style.setProperty("--theme-font-display", font.display);
    root.style.setProperty("--theme-font-sans",    font.sans);

    root.style.setProperty("--navbar-edge-smoothness", ov.navbar_edge_smoothness || "0px");
    root.style.setProperty("--ui-edge-smoothness", ov.ui_edge_smoothness || "4px");
  };

  // ── Load config on boot ───────────────────
  const loadConfig = async () => {
    try {
      const cfg: AppConfig = await invoke("get_app_config");
      setConfig(cfg);
      setNavLayout(cfg.theme.nav_layout || "sidebar");
      setActivePage(prev =>
        prev === "Explorer" && cfg.general.launch_page ? cfg.general.launch_page : prev
      );
      applyTheme(cfg);
      const model: string | null = await invoke("get_loaded_model");
      setActiveModel(model);
    } catch (err) {
      console.error("loadConfig error:", err);
    }
  };

  // ── Toggle dark / light ───────────────────
  const toggleThemeMode = async () => {
    if (!config) return;
    const isDark    = (config.theme.ui_overrides?.text_color ?? "#18140f") === "#ffffff";
    const nextOv    = isDark
      ? {
          ...config.theme.ui_overrides,
          nav_background:     "#f6f2ea",
          content_background: "#f6f2ea",
          card_background:    "#ede8dc",
          card_border:        "#c9bfab",
          text_color:         "#18140f",
        }
      : {
          ...config.theme.ui_overrides,
          nav_background:     "#181410",
          content_background: "#181410",
          card_background:    "#221e1a",
          card_border:        "#3c352a",
          text_color:         "#ffffff",
        };

    const nextConfig = { ...config, theme: { ...config.theme, ui_overrides: nextOv } };
    setConfig(nextConfig);
    applyTheme(nextConfig);
    await invoke("save_app_config", { config: nextConfig });
    await emit("config_updated", nextConfig);
  };

  // ── isDark helper (derived, not state) ───
  const isDarkMode = (config?.theme?.ui_overrides?.text_color ?? "#18140f") === "#ffffff";

  // ── Effects ───────────────────────────────
  useEffect(() => {
    loadConfig();

    // Block native browser context menu
    const noCtx = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", noCtx);

    // Tauri event subscriptions
    const configUnsub  = listen<AppConfig | null>("config_updated", e => {
      if (e.payload) {
        const cfg = e.payload;
        setConfig(cfg);
        setNavLayout(cfg.theme.nav_layout || "sidebar");
        applyTheme(cfg);
      } else {
        loadConfig();
      }
    });
    const taskUnsub    = listen("task_status_changed",  () => {});
    const layoutUnsub  = listen<string>("nav_layout_changed", e => setNavLayout(e.payload));

    // Real-time RAM polling every 2 s
    const fetchRam = async () => {
      try {
        const pct: number = await invoke("get_system_ram_usage");
        setSysRamUsage(pct);
      } catch { /* ignore */ }
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

  // Global browser/Windows keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      // F5 or Ctrl+R: Reload the window
      if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        window.location.reload();
      }

      // F11: Toggle fullscreen mode
      if (e.key === "F11") {
        e.preventDefault();
        getCurrentWindow().isFullscreen().then(isFS => {
          getCurrentWindow().setFullscreen(!isFS);
        }).catch(() => {});
      }

      // Ctrl + F: Page-contextual search routing
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        // Let Monaco handle its own search widget internally
        if (target?.closest(".monaco-editor")) {
          return;
        }
        
        e.preventDefault();
        if (activePage === "Explorer") {
          const input = document.getElementById("explorer-search-input");
          if (input) {
            input.focus();
            (input as HTMLInputElement).select();
          }
        } else if (activePage === "Chat") {
          const textarea = document.getElementById("chat-message-textarea");
          if (textarea) {
            textarea.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [activePage]);

  // Mouse side-button page navigation
  useEffect(() => {
    const block = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) e.preventDefault(); };
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

  // ── Helpers ───────────────────────────────
  const iconOnly = config?.theme?.ui_overrides?.nav_icon_only === "true";

  const ThemeToggle = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
    <button
      onClick={toggleThemeMode}
      className={`flex items-center justify-center text-muted hover:text-ink transition-colors duration-200 cursor-pointer ${className}`}
      title="Toggle Light / Dark"
    >
      {isDarkMode
        ? <Sun  size={size} className="text-accent" />
        : <Moon size={size} className="text-accent" />}
    </button>
  );

  const renderPage = () => {
    const map: Record<string, React.ReactNode> = {
      Explorer:  <Explorer />,
      Chat:      <Chat />,
      Skills:    <Skills />,
      Scheduler: <Scheduler />,
      Settings:  <Settings />,
    };
    return (
      <div key={activePage} className="page-transition h-full w-full">
        {map[activePage] ?? <Explorer />}
      </div>
    );
  };

  // ─────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Main Application Container */}
      <div 
        className={`h-full w-full flex flex-col overflow-hidden bg-paper text-ink selection:bg-accent selection:text-paper transition-opacity duration-500 ease-out ${
          (loadingPhase === "reveal-app" || loadingPhase === "done") ? "opacity-100" : "opacity-0"
        }`}
      >

      {/* ── Custom OS Title Bar ───────────────────── */}
      <div
        className="app-navbar w-full h-8 bg-paper flex items-center justify-between shrink-0 select-none cursor-default"
        data-tauri-drag-region
        onMouseDown={async (e) => {
          // Only trigger drag on left-click and if not clicking a control button
          if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
            try {
              await getCurrentWindow().startDragging();
            } catch (err) {
              console.error("Failed to drag window:", err);
            }
          }
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2 px-3 pointer-events-none" data-tauri-drag-region>
          <img
            src="/icon.ico"
            alt="Composer"
            className="w-4 h-4 object-contain shrink-0"
            draggable={false}
          />
          <span className="font-serif-display font-black text-xs tracking-wider text-accent italic">
            Composer
          </span>
        </div>

        {/* Drag region fill */}
        <div className="flex-1 h-full" data-tauri-drag-region />

        {/* Window controls */}
        <div className="flex items-center h-full shrink-0">
          <button
            onClick={() => getCurrentWindow().minimize()}
            className="w-10 h-full flex items-center justify-center text-muted hover:bg-cream hover:text-ink transition-colors duration-150 cursor-pointer"
            title="Minimize"
          >
            <Minus size={11} />
          </button>
          <button
            onClick={() => getCurrentWindow().toggleMaximize()}
            className="w-10 h-full flex items-center justify-center text-muted hover:bg-cream hover:text-ink transition-colors duration-150 cursor-pointer"
            title="Maximize / Restore"
          >
            <Square size={9} />
          </button>
          <button
            onClick={() => getCurrentWindow().close()}
            className="w-10 h-full flex items-center justify-center text-muted hover:bg-red-600 hover:text-white transition-colors duration-150 cursor-pointer"
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ── Top Navbar layout ────────────────────── */}
      <div
        className="app-navbar w-full bg-cream/35 flex items-center justify-between px-6 select-none font-sans-meta border-rule/60 shrink-0 transition-all duration-300 ease-out overflow-hidden"
        style={{
          height:            navLayout === "top_navbar" ? "48px" : "0px",
          opacity:           navLayout === "top_navbar" ? 1 : 0,
          borderBottomWidth: navLayout === "top_navbar" ? "2px" : "0px",
          pointerEvents:     navLayout === "top_navbar" ? "auto" : "none",
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-serif-display font-black text-lg tracking-wider text-accent italic">
            Composer
          </span>
        </div>

        {/* Nav pills + theme toggle */}
        <div
          className="flex items-center bg-cream p-1 border border-rule/60 text-[10.5px] uppercase font-bold tracking-wider shrink-0"
          style={{ borderRadius: "var(--navbar-edge-smoothness, 0px)" }}
        >
          {NAV_ITEMS.map(item => {
            const ico = React.cloneElement(item.icon, { size: 15 });
            return (
              <button
                key={item.name}
                onClick={() => setActivePage(item.name)}
                className={`transition-all duration-300 relative flex items-center justify-center overflow-hidden px-3.5 py-1.5
                  ${activePage === item.name
                    ? "bg-ink text-paper z-10 font-extrabold"
                    : "text-muted hover:text-ink hover:bg-cream/30 z-0"}`}
                style={{
                  borderRadius: "calc(var(--navbar-edge-smoothness, 0px) - 1px)",
                  boxShadow:    activePage === item.name ? "0 3px 8px rgba(0,0,0,.2)" : "none",
                }}
                title={item.label}
              >
                {ico}
                <span
                  className="transition-all duration-300 ease-out overflow-hidden inline-block whitespace-nowrap"
                  style={{
                    maxWidth:   iconOnly ? "0px" : "80px",
                    opacity:    iconOnly ? 0 : 1,
                    marginLeft: iconOnly ? "0px" : "6px",
                  }}
                >
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* Divider + theme toggle inline with pills */}
          <div className="w-px h-4 bg-rule/35 mx-1 shrink-0" />
          <ThemeToggle
            size={15}
            className="px-3 py-1.5"
          />
        </div>

        {/* Active model badge */}
        <div className="flex items-center gap-3 text-[10.5px] shrink-0">
          <span className="text-muted flex items-center gap-1 font-bold">
            <Cpu size={12} className="text-accent" />
            <span className="truncate max-w-[120px]">{activeModel || "No model loaded"}</span>
          </span>
        </div>
      </div>

      {/* ── Main layout frame ────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left Vertical Pills sidebar */}
        <div
          className="app-navbar h-full bg-cream/45 flex flex-col items-center justify-center relative select-none transition-all duration-300 ease-out overflow-hidden shrink-0 border-r"
          style={{
            width:            navLayout === "vertical_pills" ? "64px" : "0px",
            opacity:          navLayout === "vertical_pills" ? 1 : 0,
            borderRightWidth: navLayout === "vertical_pills" ? "2px" : "0px",
            borderColor:      "var(--theme-rule)",
            pointerEvents:    navLayout === "vertical_pills" ? "auto" : "none",
          }}
        >
          <div
            className="w-12 bg-paper/95 border border-rule shadow-md py-3 px-1 flex flex-col items-center gap-3.5 select-none font-sans-meta transition-all duration-300"
            style={{
              borderRadius: "var(--navbar-edge-smoothness, 0px)",
              transform:    navLayout === "vertical_pills" ? "scale(1)" : "scale(0.85)",
            }}
          >
            {/* Brand letter */}
            <span className="font-serif-display font-black text-accent text-sm italic border-b border-light-rule pb-1.5 shrink-0">
              C
            </span>

            {/* Nav icons */}
            {NAV_ITEMS.map(item => (
              <button
                key={item.name}
                onClick={() => setActivePage(item.name)}
                className={`p-2 transition-all flex items-center justify-center relative group shrink-0
                  ${activePage === item.name ? "bg-accent text-paper" : "text-muted hover:bg-cream hover:text-ink"}`}
                style={{ borderRadius: "calc(var(--navbar-edge-smoothness, 0px) - 2px)" }}
                title={item.label}
              >
                {item.icon}
                <span className="absolute left-14 bg-ink text-paper text-[9px] font-bold uppercase tracking-wider py-0.5 px-2 rounded-sm opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-100 whitespace-nowrap z-50">
                  {item.label}
                </span>
              </button>
            ))}

            {/* Divider + theme toggle */}
            <div className="w-8 h-px bg-rule/35 shrink-0" />
            <ThemeToggle
              size={13}
              className="p-2 hover:bg-cream/30 rounded-sm"
            />
          </div>
        </div>

        {/* Left Fixed Sidebar */}
        <div
          className="app-navbar h-full bg-cream/45 flex flex-col justify-between select-none font-sans-meta transition-all duration-300 ease-out overflow-hidden shrink-0 border-r"
          style={{
            width:            navLayout === "sidebar" ? "224px" : "0px",
            opacity:          navLayout === "sidebar" ? 1 : 0,
            borderRightWidth: navLayout === "sidebar" ? "2px" : "0px",
            borderColor:      "var(--theme-rule)",
            pointerEvents:    navLayout === "sidebar" ? "auto" : "none",
          }}
        >
          <div className="w-56 h-full flex flex-col shrink-0">
            {/* Header */}
            <div className="p-4 flex flex-col gap-1 border-b border-light-rule bg-paper shrink-0">
              <span className="font-serif-display font-black text-xl tracking-wider text-accent italic">
                Composer
              </span>
              <div className="text-[10px] font-semibold text-muted tracking-wide min-h-[14px]">
                {welcomeText}
              </div>
            </div>

            {/* Menu */}
            <div className="flex-1 py-4 px-2 overflow-y-auto flex flex-col justify-between">
              <div className="space-y-1">
                {NAV_ITEMS.map(item => (
                  <button
                    key={item.name}
                    onClick={() => setActivePage(item.name)}
                    className={`w-full px-3 py-2 flex items-center gap-2.5 rounded-sm transition-all text-xs font-semibold uppercase tracking-wider text-left shrink-0
                      ${activePage === item.name
                        ? "bg-ink text-paper font-bold"
                        : "text-muted hover:bg-cream hover:text-ink"}`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              {/* Theme toggle at bottom of menu */}
              <div className="pt-2 border-t border-rule/35 mt-2 px-1">
                <button
                  onClick={toggleThemeMode}
                  className="w-full px-3 py-2 flex items-center gap-2.5 rounded-sm transition-all text-xs font-semibold uppercase tracking-wider text-left text-muted hover:bg-cream hover:text-ink cursor-pointer"
                >
                  {isDarkMode
                    ? <Sun  size={13} className="text-accent" />
                    : <Moon size={13} className="text-accent" />}
                  <span>Toggle Appearance</span>
                </button>
              </div>
            </div>

            {/* Hardware status footer */}
            <div className="p-4 border-t border-light-rule bg-paper/60 space-y-3 text-[10px] shrink-0">
              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-bold text-muted uppercase text-[9px]">
                  <span>VRAM ALLOCATION</span>
                  <span className="text-accent font-semibold">{activeModel ? "LOADED" : "FREE"}</span>
                </div>
                <p className="font-mono text-ink/80 truncate font-bold">
                  {activeModel || "No model loaded"}
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-bold text-muted uppercase text-[9px]">
                  <span>LOCAL CPU RAM</span>
                  <span className="text-accent font-semibold">{sysRamUsage}%</span>
                </div>
                <div className="w-full bg-cream h-1 border border-rule/35 overflow-hidden">
                  <div
                    style={{ width: `${sysRamUsage}%` }}
                    className="bg-accent h-full transition-all duration-700"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content workspace */}
        <div className="flex-1 flex flex-col h-full overflow-hidden select-text">
          {renderPage()}
        </div>

        {/* Right Vertical Pills sidebar ("R Vertical Pill" with glowing text-shadow accent R) */}
        <div
          className="app-navbar h-full bg-cream/45 flex flex-col items-center justify-center relative select-none transition-all duration-300 ease-out overflow-hidden shrink-0 border-l"
          style={{
            width:           navLayout === "right_vertical_pills" ? "64px" : "0px",
            opacity:         navLayout === "right_vertical_pills" ? 1 : 0,
            borderLeftWidth: navLayout === "right_vertical_pills" ? "2px" : "0px",
            borderColor:     "var(--theme-rule)",
            pointerEvents:   navLayout === "right_vertical_pills" ? "auto" : "none",
          }}
        >
          <div
            className="w-12 bg-paper/95 border border-rule shadow-md py-3 px-1 flex flex-col items-center gap-3.5 select-none font-sans-meta transition-all duration-300"
            style={{
              borderRadius: "var(--navbar-edge-smoothness, 0px)",
              transform:    navLayout === "right_vertical_pills" ? "scale(1)" : "scale(0.85)",
            }}
          >
            {/* Brand letter glowing in accent color */}
            <span 
              className="font-serif-display font-black text-accent text-sm italic border-b border-light-rule pb-1.5 shrink-0 animate-pulse"
              style={{
                textShadow: "0 0 12px var(--theme-accent), 0 0 24px var(--theme-accent)",
                filter: "drop-shadow(0 0 6px var(--theme-accent))"
              }}
            >
              C
            </span>

            {/* Nav icons */}
            {NAV_ITEMS.map(item => (
              <button
                key={item.name}
                onClick={() => setActivePage(item.name)}
                className={`p-2 transition-all flex items-center justify-center relative group shrink-0
                  ${activePage === item.name ? "bg-accent text-paper" : "text-muted hover:bg-cream hover:text-ink"}`}
                style={{ borderRadius: "calc(var(--navbar-edge-smoothness, 0px) - 2px)" }}
                title={item.label}
              >
                {item.icon}
                <span className="absolute right-14 bg-ink text-paper text-[9px] font-bold uppercase tracking-wider py-0.5 px-2 rounded-sm opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-100 whitespace-nowrap z-50">
                  {item.label}
                </span>
              </button>
            ))}

            {/* Divider + theme toggle */}
            <div className="w-8 h-px bg-rule/35 shrink-0" />
            <ThemeToggle
              size={13}
              className="p-2 hover:bg-cream/30 rounded-sm"
            />
          </div>
        </div>

        {/* Right Fixed Sidebar */}
        <div
          className="app-navbar h-full bg-cream/45 flex flex-col justify-between select-none font-sans-meta transition-all duration-300 ease-out overflow-hidden shrink-0 border-l"
          style={{
            width:            navLayout === "right_sidebar" ? "224px" : "0px",
            opacity:          navLayout === "right_sidebar" ? 1 : 0,
            borderLeftWidth:  navLayout === "right_sidebar" ? "2px" : "0px",
            borderColor:      "var(--theme-rule)",
            pointerEvents:    navLayout === "right_sidebar" ? "auto" : "none",
          }}
        >
          <div className="w-56 h-full flex flex-col shrink-0">
            {/* Header */}
            <div className="p-4 flex flex-col gap-1 border-b border-light-rule bg-paper shrink-0">
              <span className="font-serif-display font-black text-xl tracking-wider text-accent italic">
                Composer
              </span>
              <div className="text-[10px] font-semibold text-muted tracking-wide min-h-[14px]">
                {welcomeText}
              </div>
            </div>

            {/* Menu */}
            <div className="flex-1 py-4 px-2 overflow-y-auto flex flex-col justify-between">
              <div className="space-y-1">
                {NAV_ITEMS.map(item => (
                  <button
                    key={item.name}
                    onClick={() => setActivePage(item.name)}
                    className={`w-full px-3 py-2 flex items-center gap-2.5 rounded-sm transition-all text-xs font-semibold uppercase tracking-wider text-left shrink-0
                      ${activePage === item.name
                        ? "bg-ink text-paper font-bold"
                        : "text-muted hover:bg-cream hover:text-ink"}`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              {/* Theme toggle at bottom of menu */}
              <div className="pt-2 border-t border-rule/35 mt-2 px-1">
                <button
                  onClick={toggleThemeMode}
                  className="w-full px-3 py-2 flex items-center gap-2.5 rounded-sm transition-all text-xs font-semibold uppercase tracking-wider text-left text-muted hover:bg-cream hover:text-ink cursor-pointer"
                >
                  {isDarkMode
                    ? <Sun  size={13} className="text-accent" />
                    : <Moon size={13} className="text-accent" />}
                  <span>Toggle Appearance</span>
                </button>
              </div>
            </div>

            {/* Hardware status footer */}
            <div className="p-4 border-t border-light-rule bg-paper/60 space-y-3 text-[10px] shrink-0">
              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-bold text-muted uppercase text-[9px]">
                  <span>VRAM ALLOCATION</span>
                  <span className="text-accent font-semibold">{activeModel ? "LOADED" : "FREE"}</span>
                </div>
                <p className="font-mono text-ink/80 truncate font-bold">
                  {activeModel || "No model loaded"}
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-bold text-muted uppercase text-[9px]">
                  <span>LOCAL CPU RAM</span>
                  <span className="text-accent font-semibold">{sysRamUsage}%</span>
                </div>
                <div className="w-full bg-cream h-1 border border-rule/35 overflow-hidden">
                  <div
                    style={{ width: `${sysRamUsage}%` }}
                    className="bg-accent h-full transition-all duration-700"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Bottom Navbar layout ─────────────────── */}
      <div
        className="app-navbar w-full bg-cream/35 flex items-center justify-between px-6 select-none font-sans-meta border-t border-rule/60 shrink-0 transition-all duration-300 ease-out overflow-hidden"
        style={{
          height:            navLayout === "bottom_navbar" ? "48px" : "0px",
          opacity:           navLayout === "bottom_navbar" ? 1 : 0,
          borderTopWidth:    navLayout === "bottom_navbar" ? "2px" : "0px",
          pointerEvents:     navLayout === "bottom_navbar" ? "auto" : "none",
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-serif-display font-black text-lg tracking-wider text-accent italic">
            Composer
          </span>
        </div>

        {/* Nav pills + theme toggle */}
        <div
          className="flex items-center bg-cream p-1 border border-rule/60 text-[10.5px] uppercase font-bold tracking-wider shrink-0"
          style={{ borderRadius: "var(--navbar-edge-smoothness, 0px)" }}
        >
          {NAV_ITEMS.map(item => {
            const ico = React.cloneElement(item.icon, { size: 15 });
            return (
              <button
                key={item.name}
                onClick={() => setActivePage(item.name)}
                className={`transition-all duration-300 relative flex items-center justify-center overflow-hidden px-3.5 py-1.5
                  ${activePage === item.name
                    ? "bg-ink text-paper z-10 font-extrabold"
                    : "text-muted hover:text-ink hover:bg-cream/30 z-0"}`}
                style={{
                  borderRadius: "calc(var(--navbar-edge-smoothness, 0px) - 1px)",
                  boxShadow:    activePage === item.name ? "0 3px 8px rgba(0,0,0,.2)" : "none",
                }}
                title={item.label}
              >
                {ico}
                <span
                  className="transition-all duration-300 ease-out overflow-hidden inline-block whitespace-nowrap"
                  style={{
                    maxWidth:   iconOnly ? "0px" : "80px",
                    opacity:    iconOnly ? 0 : 1,
                    marginLeft: iconOnly ? "0px" : "6px",
                  }}
                >
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* Divider + theme toggle inline with pills */}
          <div className="w-px h-4 bg-rule/35 mx-1 shrink-0" />
          <ThemeToggle
            size={15}
            className="px-3 py-1.5"
          />
        </div>

        {/* Active model badge */}
        <div className="flex items-center gap-3 text-[10.5px] shrink-0">
          <span className="text-muted flex items-center gap-1 font-bold">
            <Cpu size={12} className="text-accent" />
            <span className="truncate max-w-[120px]">{activeModel || "No model loaded"}</span>
          </span>
        </div>
      </div>

      </div>

      {/* 10s Loading Overlay Screen */}
      {loadingPhase !== "done" && (
        <div 
          className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-paper select-none transition-opacity duration-500 ease-out loading-bg-fadein ${
            loadingPhase === "reveal-app" ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"
          }`}
        >
          {/* Main content wrapper */}
          <div className="flex flex-col items-center justify-center">
            {/* Composer typed text */}
            <div 
              className={`transition-all duration-500 ease-in-out ${
                (loadingPhase === "loading" || loadingPhase === "exit-spinner") 
                  ? "opacity-100 scale-100" 
                  : "opacity-0 scale-95"
              }`}
            >
              <span className="font-serif-display font-black text-5xl tracking-widest text-accent italic active-text-accent-glow">
                {typedText}
              </span>
              {/* Typewriter cursor */}
              {typedText.length < fullText.length && (
                <span className="animate-pulse text-accent text-5xl font-light">|</span>
              )}
            </div>

            {/* Spinner Container */}
            <div 
              className={`mt-10 transition-all duration-400 ease-in-out ${
                loadingPhase === "loading" ? "opacity-100 scale-100" : "opacity-0 scale-75"
              }`}
            >
              {/* Windows 11 Spinner */}
              <svg className="w11-spinner-svg" viewBox="0 0 50 50" style={{ width: 44, height: 44 }}>
                <circle
                  className="w11-spinner-path"
                  cx="25"
                  cy="25"
                  r="20"
                  fill="none"
                  stroke="var(--theme-accent, #b8440c)"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
