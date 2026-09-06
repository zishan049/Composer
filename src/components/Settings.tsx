// @ts-nocheck
import React, { useState, useEffect } from "react";
import { Sliders, RefreshCw, ChevronDown, Save, Dices, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { AppConfig } from "../types";
import { useCustomContextMenu } from "./ContextMenu";
import { FONT_PRESETS, getFontPreset, applyTypographyToRoot } from "../utils/fonts";

// ─────────────────────────────────────────────────────────────
// Constants (identical to original)
// ─────────────────────────────────────────────────────────────

const DEFAULT_THEME = {
  theme_preset: "dark",
  accent_color: "#FFFFFF",
  background_override: "",
  font_family_ui: "Inter",
  font_size_ui: 14,
  compact_mode: false,
  reduce_motion: false,
  nav_layout: "sidebar",
  nav_sidebar_width: 240,
  nav_show_app_label: true,
  nav_show_status_bar: true,
  nav_separator_line: true,
  nav_separator_color: "rgba(255,255,255,0.08)",
  nav_glass_effect: false,
  ui_overrides: {
    nav_background: "#000000",
    content_background: "#000000",
    card_background: "#0F0F0F",
    card_border: "rgba(255,255,255,0.12)",
    text_color: "#FFFFFF",
    border_accent: "#FFFFFF",
    navbar_edge_smoothness: "4px",
  }
};

const PRESETS: Record<string, string[]> = {
  nav_background: ["#000000", "#0A0A0A", "#121212", "#18181B", "#F4F4F5", "#FAFAFA", "#FFFFFF"],
  text_color:     ["#FFFFFF", "#F4F4F5", "#E4E4E7", "#A1A1AA", "#71717A", "#27272A", "#000000"],
  card_background:["#0F0F0F", "#171717", "#27272A", "#E4E4E7", "#F4F4F5", "#FAFAFA", "#FFFFFF"],
  border_accent:  ["#FFFFFF", "#E4E4E7", "#A1A1AA", "#71717A", "#3F3F46", "#18181B", "#000000"],
};

// ─────────────────────────────────────────────────────────────
// Animated Hex Input (identical to original — preserved)
// ─────────────────────────────────────────────────────────────
const AnimatedHexInput: React.FC<{
  value: string;
  onChange: (val: string) => void;
  className?: string;
}> = ({ value, onChange, className }) => {
  const [displayed, setDisplayed] = React.useState(value);
  const timersRef = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const isUserRef = React.useRef(false);

  React.useEffect(() => {
    if (isUserRef.current) { setDisplayed(value); return; }
    if (displayed === value) return;
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];
    const chars = value.split("");
    const newTimers = chars.map((_, i) => setTimeout(() => setDisplayed(value.slice(0, i + 1)), i * 28));
    timersRef.current = newTimers;
    return () => newTimers.forEach(t => clearTimeout(t));
  }, [value]);

  return (
    <input
      type="text"
      value={displayed}
      onFocus={() => { isUserRef.current = true; setDisplayed(value); }}
      onBlur={() => { isUserRef.current = false; }}
      onChange={e => { setDisplayed(e.target.value); onChange(e.target.value); }}
      className={className}
    />
  );
};

// ─────────────────────────────────────────────────────────────
// Main Settings Component
// ─────────────────────────────────────────────────────────────
export const Settings: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeColorKey, setActiveColorKey] = useState<string | null>(null);
  const [layoutDropdownOpen, setLayoutDropdownOpen] = useState(false);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const { showContextMenu, ContextMenuComponent } = useCustomContextMenu();

  const [customPresets, setCustomPresets] = useState<{ name: string; path: string; colors: Record<string, string> }[]>([]);
  const [selectedPresetName, setSelectedPresetName] = useState<string>("custom_select");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [rollDegrees, setRollDegrees] = useState(0);
  const [presetsDropdownOpen, setPresetsDropdownOpen] = useState(false);

  const [localGlowBrightness, setLocalGlowBrightness] = useState<number>(1.0);
  const [localUiSmoothness, setLocalUiSmoothness] = useState<number>(4);
  const [localNavSmoothness, setLocalNavSmoothness] = useState<number>(4);

  // ── ALL LOGIC BELOW IS 100% IDENTICAL TO ORIGINAL ─────────────────────────

  const handleSliderDrag = (key: string, val: string) => {
    if (!config) return;
    const overrides = { ...config.theme.ui_overrides, [key]: val };
    applyTheme(overrides, config.theme.font_family_ui);
    patchOverrideDebounced(key, val);
  };

  const handleRandomizeTheme = async () => {
    if (!config) return;
    setRollDegrees(prev => prev + 360);
    const RANDOM_PALETTES = [
      { nav_background: "#1b222c", text_color: "#e5ecef", card_background: "#222a36", card_border: "#2e3b4e", border_accent: "#88c0d0" },
      { nav_background: "#141c16", text_color: "#e1ebd8", card_background: "#1c261e", card_border: "#243328", border_accent: "#80b686" },
      { nav_background: "#0c0a12", text_color: "#eceaf0", card_background: "#151221", card_border: "#2a1e3d", border_accent: "#ff007f" },
      { nav_background: "#0f111a", text_color: "#e6e8f2", card_background: "#161826", card_border: "#20233b", border_accent: "#7582ff" },
      { nav_background: "#1d1d1f", text_color: "#f5f5f7", card_background: "#272729", card_border: "#333336", border_accent: "#86868b" },
      { nav_background: "#120e0c", text_color: "#f0e6e1", card_background: "#1c1714", card_border: "#2b211d", border_accent: "#d4a373" },
      { nav_background: "#0a1128", text_color: "#e2eafd", card_background: "#101f42", card_border: "#1a2c5a", border_accent: "#00b4d8" },
      { nav_background: "#002b36", text_color: "#93a1a1", card_background: "#073642", card_border: "#0b4f60", border_accent: "#cb4b16" },
      { nav_background: "#0d1117", text_color: "#c9d1d9", card_background: "#161b22", card_border: "#21262d", border_accent: "#58a6ff" },
      { nav_background: "#1a0a2e", text_color: "#e8d5ff", card_background: "#250d40", card_border: "#3a1460", border_accent: "#bf5af2" },
      { nav_background: "#0b1a1a", text_color: "#d0ede0", card_background: "#0f2420", card_border: "#153528", border_accent: "#00e5bc" },
      { nav_background: "#18110c", text_color: "#ffe9cc", card_background: "#241808", card_border: "#3a2410", border_accent: "#ff9d00" },
      { nav_background: "#100d1a", text_color: "#dcd8f0", card_background: "#17132a", card_border: "#221b3e", border_accent: "#9f7dff" },
      { nav_background: "#0e1a0e", text_color: "#b3ffb3", card_background: "#122012", card_border: "#1a2e1a", border_accent: "#39ff14" },
      { nav_background: "#1a0d0d", text_color: "#ffe5e5", card_background: "#261212", card_border: "#3d1a1a", border_accent: "#ff3d3d" },
      { nav_background: "#12161c", text_color: "#cdd6f4", card_background: "#1e2230", card_border: "#2a3146", border_accent: "#89b4fa" },
      { nav_background: "#faf4f4", text_color: "#2a1e1e", card_background: "#f2e6e6", card_border: "#e2cbcb", border_accent: "#b87070" },
      { nav_background: "#f4f6f0", text_color: "#222a1d", card_background: "#e6ebdc", card_border: "#d2d9c8", border_accent: "#6b8e23" },
      { nav_background: "#fff5f6", text_color: "#382426", card_background: "#fde2e4", card_border: "#f7c5c8", border_accent: "#ffb5a7" },
      { nav_background: "#fcf8f2", text_color: "#2d1607", card_background: "#f5ebd9", card_border: "#e8d1b7", border_accent: "#c36a2d" },
      { nav_background: "#fbf0d9", text_color: "#433422", card_background: "#f3e1bf", card_border: "#e6ce9c", border_accent: "#8c5623" },
      { nav_background: "#f0f4ff", text_color: "#1a2052", card_background: "#e4eaff", card_border: "#c8d4ff", border_accent: "#3a5bff" },
      { nav_background: "#f5fff8", text_color: "#0d2e18", card_background: "#e4f6ea", card_border: "#c5e6d0", border_accent: "#1e8c45" },
      { nav_background: "#fffbf0", text_color: "#2e2000", card_background: "#fef3d0", card_border: "#f9e09a", border_accent: "#d4a200" },
      { nav_background: "#fdf6ff", text_color: "#2a1040", card_background: "#f4e8ff", card_border: "#e5c8ff", border_accent: "#9240d4" },
      { nav_background: "#f0fbff", text_color: "#062030", card_background: "#ddf4ff", card_border: "#b8e8ff", border_accent: "#0094cc" },
      { nav_background: "#fff0f3", text_color: "#350018", card_background: "#ffe0e8", card_border: "#ffc5d4", border_accent: "#e0125e" },
      { nav_background: "#f8f6f0", text_color: "#2a2210", card_background: "#eee9d8", card_border: "#ddd3bc", border_accent: "#7a6540" },
    ];
    const EXCLUDED_BACKGROUNDS = new Set(["#f6f2ea", "#181410", "#141310", "#000000", "#0e1117"]);
    customPresets.forEach(p => { if (p.colors?.nav_background) EXCLUDED_BACKGROUNDS.add(p.colors.nav_background.toLowerCase()); });
    const currentPaper = (config.theme.ui_overrides.nav_background || "#000000").toLowerCase();
    EXCLUDED_BACKGROUNDS.add(currentPaper);
    const available = RANDOM_PALETTES.filter(p => !EXCLUDED_BACKGROUNDS.has(p.nav_background.toLowerCase()));
    const pool = available.length > 0 ? available : RANDOM_PALETTES.filter(p => p.nav_background.toLowerCase() !== currentPaper);
    const randomPalette = pool[Math.floor(Math.random() * pool.length)] || RANDOM_PALETTES[0];
    const targetColors = {
      nav_background: randomPalette.nav_background,
      content_background: randomPalette.nav_background,
      card_background: randomPalette.card_background,
      card_border: randomPalette.card_border,
      text_color: randomPalette.text_color,
      border_accent: randomPalette.border_accent,
    };
    const overrides = { ...config.theme.ui_overrides, ...targetColors };
    const next = { ...config, theme: { ...config.theme, ui_overrides: overrides } };
    await saveConfig(next);
  };

  const loadCustomPresets = async (rootPath?: string) => {
    const activeRoot = rootPath || config?.storage?.root_path;
    if (!activeRoot) return;
    try {
      const separator = activeRoot.includes("/") ? "/" : "\\";
      const usersDir = `${activeRoot}${separator}users`;
      const entries = await invoke<any[]>("list_directory_contents", { dirPath: usersDir });
      const loaded: any[] = [];
      for (const entry of entries) {
        if (!entry.is_dir && entry.name.endsWith(".json")) {
          try {
            const content = await invoke<string>("read_text_file", { filePath: entry.path });
            const parsed = JSON.parse(content);
            if (parsed && parsed.name) {
              loaded.push({ name: parsed.name, path: entry.path, colors: parsed.colors || parsed });
            }
          } catch (e) { console.error("Failed to read theme file:", entry.path, e); }
        }
      }
      setCustomPresets(loaded);
    } catch (err) { setCustomPresets([]); }
  };

  const handleSelectPreset = async (presetName: string) => {
    if (!config) return;
    setSelectedPresetName(presetName);
    let targetColors: Record<string, string> = {};
    if (presetName === "system_default_bw") {
      targetColors = {
        nav_background: "#000000",
        content_background: "#000000",
        card_background: "#0F0F0F",
        card_border: "rgba(255,255,255,0.12)",
        text_color: "#FFFFFF",
        border_accent: "#FFFFFF",
      };
    } else if (presetName === "system_default_wb") {
      targetColors = {
        nav_background: "#FFFFFF",
        content_background: "#FFFFFF",
        card_background: "#F4F4F5",
        card_border: "rgba(0,0,0,0.12)",
        text_color: "#000000",
        border_accent: "#000000",
      };
    } else {
      const preset = customPresets.find(p => p.name === presetName);
      if (preset) targetColors = preset.colors;
      else return;
    }
    const overrides = { ...config.theme.ui_overrides, ...targetColors };
    const next = { ...config, theme: { ...config.theme, ui_overrides: overrides } };
    await saveConfig(next);
  };

  useEffect(() => {
    if (!config) return;
    const ov = config.theme.ui_overrides || {};
    const bg = (ov.nav_background || "#000000").trim().toLowerCase();
    const isWb = bg === "#ffffff" || bg === "#fafafa" || bg === "#f4f4f5" || ov.text_color === "#000000";
    if (isWb) { setSelectedPresetName("system_default_wb"); return; }
    const isBw = (bg === "#000000" || bg === "#0a0a0a") || ov.text_color === "#FFFFFF" || ov.border_accent === "#FFFFFF";
    if (isBw) { setSelectedPresetName("system_default_bw"); return; }
    const matchedCustom = customPresets.find(p =>
      p.colors?.nav_background?.toLowerCase() === ov.nav_background?.toLowerCase() &&
      p.colors?.text_color?.toLowerCase() === ov.text_color?.toLowerCase() &&
      p.colors?.card_background?.toLowerCase() === ov.card_background?.toLowerCase() &&
      p.colors?.border_accent?.toLowerCase() === ov.border_accent?.toLowerCase()
    );
    setSelectedPresetName(matchedCustom ? matchedCustom.name : "custom_select");
  }, [config?.theme?.ui_overrides, customPresets]);

  const loadAll = async () => {
    try {
      const cfg: AppConfig = await invoke("get_app_config");
      setConfig(cfg);
      applyTheme(cfg.theme.ui_overrides, cfg.theme.font_family_ui);
      setLocalGlowBrightness(parseFloat(cfg.theme.ui_overrides.accent_glow_brightness || "1.0"));
      setLocalUiSmoothness(parseInt(cfg.theme.ui_overrides.ui_edge_smoothness || "4"));
      setLocalNavSmoothness(parseInt(cfg.theme.ui_overrides.navbar_edge_smoothness || "4"));
      await loadCustomPresets(cfg.storage.root_path);
    } catch (e) { console.error(e); }
  };

  const applyTheme = (overrides: Record<string, string>, fontFamily?: string) => {
    const r = document.documentElement;
    const paperColor  = overrides.nav_background || "#000000";
    const inkColor    = overrides.text_color || "#FFFFFF";
    const creamColor  = overrides.card_background || "#0F0F0F";
    const ruleColor   = overrides.card_border || "rgba(255,255,255,0.10)";
    const accentColor = overrides.border_accent || "#FFFFFF";

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

    r.style.setProperty("--theme-paper",  paperColor);
    r.style.setProperty("--theme-ink",    inkColor);
    r.style.setProperty("--theme-cream",  creamColor);
    r.style.setProperty("--theme-rule",   ruleColor);
    r.style.setProperty("--theme-accent", accentColor);
    r.style.setProperty("--bg-app",              paperColor);
    r.style.setProperty("--bg-sidebar",          paperColor);
    r.style.setProperty("--bg-surface",          creamColor);
    r.style.setProperty("--bg-surface-elevated", elevatedBg);
    r.style.setProperty("--bg-titlebar",         paperColor);
    r.style.setProperty("--text-primary",        inkColor);
    r.style.setProperty("--text-secondary",      textSec);
    r.style.setProperty("--text-muted",          textMut);
    r.style.setProperty("--theme-muted",         textMut);
    r.style.setProperty("--text-faint",          textFnt);
    r.style.setProperty("--accent",              accentColor);
    r.style.setProperty("--border-subtle",       borderSubtle);
    r.style.setProperty("--border-default",      borderDefault);
    r.style.setProperty("--border-strong",       borderStrong);
    r.style.setProperty("--accent-soft",         accentSoft);
    r.style.setProperty("--sidebar-nav-hover-bg", navHoverBg);
    r.style.setProperty("--sidebar-nav-active-bg", navActiveBg);

    const glowEnabled = overrides.accent_glow === "true";
    const brightness = parseFloat(overrides.accent_glow_brightness || "1.0");
    const accentColorVal = overrides.border_accent || "#E5B45F";
    const borderGlowRadius = Math.round(10 * brightness);
    const textGlowRadius = Math.round(5 * brightness);
    const baseAlpha = Math.min(1.0, brightness);
    const borderAlphaHex = Math.round(baseAlpha * 255).toString(16).padStart(2, "0");
    const textAlphaHex = Math.round(baseAlpha * 0.5 * 255).toString(16).padStart(2, "0");
    const borderGlowColor = accentColorVal.startsWith("#") && accentColorVal.length === 7 ? `${accentColorVal}${borderAlphaHex}` : accentColorVal;
    const textGlowColor = accentColorVal.startsWith("#") && accentColorVal.length === 7 ? `${accentColorVal}${textAlphaHex}` : `${accentColorVal}80`;
    r.style.setProperty("--theme-accent-glow",      glowEnabled ? `0 0 ${borderGlowRadius}px ${borderGlowColor}` : "none");
    r.style.setProperty("--theme-accent-text-glow", glowEnabled ? `0 0 ${textGlowRadius}px ${textGlowColor}` : "none");

    // Typography System
    applyTypographyToRoot(r, fontFamily);
    // Smoothness / Border Radius
    const navSmooth = overrides.navbar_edge_smoothness !== undefined && overrides.navbar_edge_smoothness !== ""
      ? overrides.navbar_edge_smoothness
      : "4px";
    const uiSmooth = overrides.ui_edge_smoothness !== undefined && overrides.ui_edge_smoothness !== ""
      ? overrides.ui_edge_smoothness
      : "4px";
    r.style.setProperty("--navbar-edge-smoothness", navSmooth);
    r.style.setProperty("--ui-edge-smoothness",     uiSmooth);
  };

  useEffect(() => {
    loadAll();
    const configUnsub = listen<AppConfig | null>("config_updated", (e) => {
      const cfg = e.payload;
      if (cfg && cfg.theme) {
        setConfig(cfg);
        applyTheme(cfg.theme.ui_overrides, cfg.theme.font_family_ui);
        setLocalGlowBrightness(parseFloat(cfg.theme.ui_overrides.accent_glow_brightness || "1.0"));
        setLocalUiSmoothness(parseInt(cfg.theme.ui_overrides.ui_edge_smoothness || "4"));
        setLocalNavSmoothness(parseInt(cfg.theme.ui_overrides.navbar_edge_smoothness || "4"));
      } else {
        invoke<AppConfig>("get_app_config").then(fresh => {
          setConfig(fresh);
          applyTheme(fresh.theme.ui_overrides, fresh.theme.font_family_ui);
          setLocalGlowBrightness(parseFloat(fresh.theme.ui_overrides.accent_glow_brightness || "1.0"));
          setLocalUiSmoothness(parseInt(fresh.theme.ui_overrides.ui_edge_smoothness || "4"));
          setLocalNavSmoothness(parseInt(fresh.theme.ui_overrides.navbar_edge_smoothness || "4"));
        }).catch(() => {});
      }
    });
    return () => {
      configUnsub.then(fn => fn());
      if (saveTimeoutRef.current)  clearTimeout(saveTimeoutRef.current);
      if (colorDebounceRef.current) clearTimeout(colorDebounceRef.current);
    };
  }, []);

  const saveConfig = async (next: AppConfig) => {
    setConfig(next);
    await invoke("save_app_config", { config: next });
    applyTheme(next.theme.ui_overrides, next.theme.font_family_ui);
    await emit("config_updated", next);
  };

  const patchOverride = async (key: string, val: string) => {
    if (!config) return;
    const overrides = { ...config.theme.ui_overrides, [key]: val };
    const next = { ...config, theme: { ...config.theme, ui_overrides: overrides } };
    setConfig(next);
    applyTheme(overrides, config.theme.font_family_ui);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      await invoke("save_app_config", { config: next });
      await emit("config_updated", next);
    }, 200);
  };

  const patchOverrideDebounced = (key: string, val: string) => {
    if (!config) return;
    const overrides = { ...config.theme.ui_overrides, [key]: val };
    const next = { ...config, theme: { ...config.theme, ui_overrides: overrides } };
    if (colorDebounceRef.current) clearTimeout(colorDebounceRef.current);
    colorDebounceRef.current = setTimeout(async () => {
      setConfig(next);
      await invoke("save_app_config", { config: next });
      await emit("config_updated", next);
    }, 120);
  };

  const resetTheme = async () => {
    if (!config) return;
    const next = { ...config, theme: DEFAULT_THEME };
    await saveConfig(next);
    await emit("nav_layout_changed", DEFAULT_THEME.nav_layout);
  };

  const handleBlankRightClick = (e: React.MouseEvent) => {
    showContextMenu(e, [
      { label: "Reset Theme Settings", onClick: resetTheme },
      { label: "", isSeparator: true },
      { label: "Refresh Configuration", onClick: loadAll },
    ]);
  };

  // ── LOADING STATE ─────────────────────────────────────────────
  if (!config) {
    return (
      <div className="stt-root" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>Loading configuration…</span>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // JSX — New Dark Warm Fluent layout
  // ─────────────────────────────────────────────────────────────
  return (
    <div
      className="stt-root"
      onContextMenu={handleBlankRightClick}
    >

      {/* ── Page Header ───────────────────────────────────────── */}
      <div className="stt-header">
        <div>
          <div className="stt-page-title">Settings</div>
          <div className="stt-page-subtitle">Workspace configuration and visual preferences</div>
        </div>
        <div className="stt-header-actions">
          <button
            onClick={resetTheme}
            className="stt-btn-secondary"
            title="Reset theme settings back to default"
          >
            <RefreshCw size={12} /> Reset Theme
          </button>
        </div>
      </div>

      {/* ── Page Content ─────────────────────────────────────── */}
      <div className="stt-content">
        <div className="stt-grid">

          {/* ── LEFT COLUMN: General & Storage ─────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

            {/* Card: General & Storage */}
            <div className="stt-section">
              <div className="stt-section-title">
                <Sliders size={12} />
                General &amp; Storage
              </div>

              <div className="stt-field">
                <span className="stt-label">Installation Storage Root</span>
                <div className="stt-field-row" style={{ gap: "8px" }}>
                  <input
                    type="text"
                    value={config.storage.root_path}
                    onChange={e => saveConfig({ ...config, storage: { ...config.storage, root_path: e.target.value } })}
                    className="stt-input stt-input-mono"
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={async () => {
                      const chosen: string | null = await invoke("pick_directory");
                      if (chosen) saveConfig({ ...config, storage: { ...config.storage, root_path: chosen } });
                    }}
                    className="stt-browse-btn"
                  >
                    Browse…
                  </button>
                </div>
              </div>

              <div className="stt-field">
                <span className="stt-label">Workspace Directory</span>
                <div className="stt-field-row" style={{ gap: "8px" }}>
                  <input
                    type="text"
                    value={config.storage.workspace_path || ""}
                    placeholder="Same as storage root (fallback)"
                    onChange={e => saveConfig({ ...config, storage: { ...config.storage, workspace_path: e.target.value } })}
                    className="stt-input stt-input-mono"
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={async () => {
                      const chosen: string | null = await invoke("pick_directory");
                      if (chosen) saveConfig({ ...config, storage: { ...config.storage, workspace_path: chosen } });
                    }}
                    className="stt-browse-btn"
                  >
                    Browse…
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div className="stt-field">
                  <span className="stt-label">Launch Page</span>
                  <select
                    value={config.general.launch_page}
                    onChange={e => saveConfig({ ...config, general: { ...config.general, launch_page: e.target.value } })}
                    className="stt-select"
                  >
                    <option value="Home">Home</option>
                    <option value="Explorer">Explorer</option>
                    <option value="Settings">Settings</option>
                  </select>
                </div>

                <div className="stt-field" style={{ position: "relative" }}>
                  <span className="stt-label">Nav Layout</span>
                  <button
                    onClick={() => setLayoutDropdownOpen(!layoutDropdownOpen)}
                    className="stt-dropdown-trigger"
                  >
                    <span>
                      {config.theme.nav_layout === "sidebar"               && "Left Sidebar"}
                      {config.theme.nav_layout === "right_sidebar"         && "Right Sidebar"}
                      {config.theme.nav_layout === "vertical_pills"        && "Left Vertical Pill"}
                      {config.theme.nav_layout === "right_vertical_pills"  && "Right Vertical Pill"}
                      {config.theme.nav_layout === "top_navbar"            && "Top Navbar"}
                      {config.theme.nav_layout === "bottom_navbar"         && "Bottom Navbar"}
                    </span>
                    <ChevronDown size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  </button>

                  {layoutDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setLayoutDropdownOpen(false)} />
                      <div className="stt-dropdown-menu">
                        {[
                          { value: "sidebar",               label: "Left Sidebar"          },
                          { value: "right_sidebar",         label: "Right Sidebar"         },
                          { value: "vertical_pills",        label: "Left Vertical Pill"    },
                          { value: "right_vertical_pills",  label: "Right Vertical Pill"   },
                          { value: "top_navbar",            label: "Top Navbar"            },
                          { value: "bottom_navbar",         label: "Bottom Navbar"         },
                        ].map(opt => (
                          <button
                            key={opt.value}
                            onClick={async () => {
                              setLayoutDropdownOpen(false);
                              await emit("nav_layout_changed", opt.value);
                              const next = { ...config, theme: { ...config.theme, nav_layout: opt.value } };
                              await saveConfig(next);
                              await emit("config_updated", next);
                            }}
                            className={`stt-dropdown-item ${config.theme.nav_layout === opt.value ? "active" : ""}`}
                          >
                            <span>{opt.label}</span>
                            {config.theme.nav_layout === opt.value && <span style={{ fontSize: "10px" }}>✓</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Card: Edge Smoothness */}
            <div className="stt-section">
              <div className="stt-section-title">Edge Smoothness</div>

              <div className="stt-field">
                <div className="stt-field-row">
                  <span className="stt-label">UI Edge Smoothness</span>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{localUiSmoothness}px</span>
                </div>
                <div className="stt-field-row" style={{ gap: "8px" }}>
                  <input
                    type="range" min="0" max="24" step="2"
                    value={localUiSmoothness}
                    onChange={e => {
                      const val = parseInt(e.target.value);
                      setLocalUiSmoothness(val);
                      handleSliderDrag("ui_edge_smoothness", `${val}px`);
                    }}
                    className="stt-slider"
                  />
                  <button className="stt-btn-ghost" style={{ fontSize: "10px", padding: "3px 8px" }}
                    onClick={() => { setLocalUiSmoothness(0); handleSliderDrag("ui_edge_smoothness", "0px"); }}>
                    Sharp
                  </button>
                  <button className="stt-btn-ghost" style={{ fontSize: "10px", padding: "3px 8px" }}
                    onClick={() => { setLocalUiSmoothness(24); handleSliderDrag("ui_edge_smoothness", "24px"); }}>
                    Smooth
                  </button>
                </div>
              </div>

              <div className="stt-divider" />

              <div className="stt-field">
                <div className="stt-field-row">
                  <span className="stt-label">Navbar Edge Smoothness</span>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{localNavSmoothness}px</span>
                </div>
                <div className="stt-field-row" style={{ gap: "8px" }}>
                  <input
                    type="range" min="0" max="24" step="2"
                    value={localNavSmoothness}
                    onChange={e => {
                      const val = parseInt(e.target.value);
                      setLocalNavSmoothness(val);
                      handleSliderDrag("navbar_edge_smoothness", `${val}px`);
                    }}
                    className="stt-slider"
                  />
                  <button className="stt-btn-ghost" style={{ fontSize: "10px", padding: "3px 8px" }}
                    onClick={() => { setLocalNavSmoothness(0); handleSliderDrag("navbar_edge_smoothness", "0px"); }}>
                    Sharp
                  </button>
                  <button className="stt-btn-ghost" style={{ fontSize: "10px", padding: "3px 8px" }}
                    onClick={() => { setLocalNavSmoothness(24); handleSliderDrag("navbar_edge_smoothness", "24px"); }}>
                    Smooth
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* ── RIGHT COLUMN: Visual Palette ──────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

            {/* Card: Visual Palette Overrides */}
            <div className="stt-section" style={{ position: "relative", zIndex: activeColorKey ? 30 : 10 }}>
              <div className="stt-section-title">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <Sliders size={12} /> Visual Palette Overrides
                  </span>
                  <button
                    onClick={handleRandomizeTheme}
                    className="stt-btn-ghost"
                    style={{ fontSize: "10px", display: "flex", alignItems: "center", gap: "5px" }}
                    title="Roll a random editorial theme palette"
                  >
                    <Dices
                      size={12}
                      style={{ transform: `rotate(${rollDegrees}deg)`, transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                    />
                    <span>Randomize</span>
                  </button>
                </div>
              </div>

              {/* Preset selector */}
              <div style={{ display: "flex", gap: "8px" }}>
                <select
                  value={selectedPresetName}
                  onChange={e => handleSelectPreset(e.target.value)}
                  className="stt-select"
                  style={{ flex: 1 }}
                >
                  <option value="system_default_bw">Minimalist B&W (Dark)</option>
                  <option value="system_default_wb">Minimalist W&B (Light)</option>
                  {customPresets.map(p => (
                    <option key={p.name} value={p.name}>Preset: {p.name}</option>
                  ))}
                  <option value="custom_select" disabled>— Custom overrides active —</option>
                </select>
                <button
                  onClick={() => setShowSaveModal(true)}
                  className="stt-btn-secondary"
                  title="Save current colors as a custom preset"
                  style={{ whiteSpace: "nowrap" }}
                >
                  <Save size={12} /> Save Preset
                </button>
              </div>

              {/* Color swatch overrides */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", paddingTop: "4px" }}>
                {[
                  { key: "nav_background",  label: "Paper / Nav Background" },
                  { key: "card_background", label: "Card / Panel Surface"   },
                  { key: "card_border",     label: "Card Border & Rule"      },
                  { key: "border_accent",   label: "Accent Highlight Color"  },
                  { key: "text_color",      label: "Main Typography Color"   },
                ].map(({ key, label }) => {
                  const currentVal = config.theme.ui_overrides[key] || (DEFAULT_THEME.ui_overrides as any)[key] || "#000000";
                  const isOpen = activeColorKey === key;
                  return (
                    <div key={key} style={{ display: "flex", flexDirection: "column", gap: "4px", position: "relative" }}>
                      <span className="stt-label" style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
                      <div className="stt-color-row">
                        <button
                          type="button"
                          onClick={() => setActiveColorKey(isOpen ? null : key)}
                          className="stt-color-swatch"
                          style={{ backgroundColor: currentVal }}
                        />
                        <AnimatedHexInput
                          value={currentVal}
                          onChange={val => patchOverride(key, val)}
                          className="stt-hex-input"
                        />
                      </div>

                      {/* Color palette popover */}
                      {isOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setActiveColorKey(null)} />
                          <div className="stt-palette-popover">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                              <span style={{ fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)" }}>Palette presets</span>
                              <button onClick={() => setActiveColorKey(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={12} /></button>
                            </div>
                            <div className="stt-palette-grid">
                              {(PRESETS[key] || PRESETS.border_accent).map(hex => (
                                <button
                                  key={hex}
                                  onClick={() => { patchOverride(key, hex); setActiveColorKey(null); }}
                                  className="stt-palette-swatch"
                                  style={{ backgroundColor: hex }}
                                  title={hex}
                                />
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Typography System */}
              <div className="stt-field" style={{ paddingTop: "8px", borderTop: "1px solid var(--border-subtle)" }}>
                <span className="stt-label">Typography System</span>
                <select
                  value={getFontPreset(config.theme.font_family_ui).id}
                  onChange={e => {
                    const font = e.target.value;
                    const next = { ...config, theme: { ...config.theme, font_family_ui: font } };
                    saveConfig(next);
                  }}
                  className="stt-select"
                >
                  {FONT_PRESETS.map(f => (
                    <option key={f.id} value={f.id}>{f.label} — {f.desc}</option>
                  ))}
                </select>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Save Custom Preset Modal ──────────────────────────── */}
      {showSaveModal && (
        <div className="dlg-overlay">
          <div className="dlg-panel dlg-panel--sm">
            <div className="dlg-header">
              <div className="dlg-title-group">
                <span className="dlg-title">Save Custom Preset</span>
              </div>
              <button className="dlg-close-btn" onClick={() => setShowSaveModal(false)}><X size={14} /></button>
            </div>
            <div className="dlg-body">
              <div className="dlg-field">
                <span className="dlg-label">Preset Name</span>
                <input
                  type="text"
                  placeholder="e.g. Vintage Amber"
                  value={newThemeName}
                  onChange={e => setNewThemeName(e.target.value)}
                  className="dlg-input"
                  autoFocus
                />
                {saveError && <span style={{ fontSize: "11px", color: "#F87171" }}>{saveError}</span>}
              </div>
            </div>
            <div className="dlg-footer">
              <button className="dlg-btn-cancel" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button
                className="dlg-btn-confirm"
                onClick={async () => {
                  if (!newThemeName.trim()) { setSaveError("Please enter a theme name"); return; }
                  if (!config) return;
                  try {
                    const themeName = newThemeName.trim();
                    const separator = config.storage.root_path.includes("/") ? "/" : "\\";
                    const fileName = `${themeName.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.json`;
                    const filePath = `${config.storage.root_path}${separator}users${separator}${fileName}`;
                    const payload = {
                      name: themeName,
                      colors: {
                        nav_background:  config.theme.ui_overrides.nav_background  || "#000000",
                        text_color:      config.theme.ui_overrides.text_color      || "#FFFFFF",
                        card_background: config.theme.ui_overrides.card_background || "#0F0F0F",
                        border_accent:   config.theme.ui_overrides.border_accent   || "#FFFFFF",
                      }
                    };
                    await invoke("write_text_file", { filePath, content: JSON.stringify(payload, null, 2) });
                    await loadCustomPresets(config.storage.root_path);
                    setSelectedPresetName(themeName);
                    setShowSaveModal(false);
                    setNewThemeName("");
                    setSaveError("");
                  } catch (err: any) {
                    setSaveError(err.toString() || "Failed to save theme file");
                  }
                }}
              >
                Save Preset
              </button>
            </div>
          </div>
        </div>
      )}

      {ContextMenuComponent}
    </div>
  );
};
