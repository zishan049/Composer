import React, { useState, useEffect } from "react";
import { Sliders, RefreshCw, Save, Dices, X, ArrowUpCircle, CheckCircle, AlertCircle, Download, Keyboard, Sparkles, Sun, Moon, Check } from "lucide-react";
import GlideSelect from "./GlideSelect";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { AppConfig } from "../types";
import { useCustomContextMenu } from "./ContextMenu";
import { FONT_PRESETS, getFontPreset } from "../utils/fonts";
import {
  applyThemeToDocument,
  QUANTUM_DARK_OVERRIDES,
  QUANTUM_LIGHT_OVERRIDES,
  QUANTUM_GHOST_FIBER_DEFAULTS,
  THEME_VERSION,
} from "../utils/theme";
import { useUpdater } from "../utils/useUpdater";


// ─────────────────────────────────────────────────────────────
// Constants (Quantum Blue Default Theme — Light & Dark)
// ─────────────────────────────────────────────────────────────

const DEFAULT_THEME = {
  theme_preset: "dark",
  accent_color: "#2457FF",
  background_override: "",
  font_family_ui: "modern_sans",
  font_size_ui: 14,
  compact_mode: false,
  reduce_motion: false,
  nav_layout: "top_navbar",
  nav_sidebar_width: 240,
  nav_show_app_label: true,
  nav_show_status_bar: true,
  nav_separator_line: true,
  nav_separator_color: "rgba(223, 247, 255, 0.08)",
  nav_glass_effect: false,
  ui_overrides: { ...QUANTUM_DARK_OVERRIDES },
};

const PRESETS: Record<string, string[]> = {
  nav_background: ["#0B0F19", "#121829", "#0D1117", "#18181B", "#F0F4F8", "#F8FAFC", "#FFFFFF"],
  text_color:     ["#F0F4F8", "#FFFFFF", "#CBD5E1", "#94A3B8", "#334155", "#0A1128", "#000000"],
  card_background:["#121829", "#161F33", "#1E293B", "#DFF7FF", "#F0F4F8", "#F8FAFC", "#FFFFFF"],
  border_accent:  ["#2457FF", "#00D4FF", "#DFF7FF", "#3B6CFF", "#60A5FA", "#1B45CC", "#0A1128"],
};

// ─────────────────────────────────────────────────────────────
// Keyboard shortcut reference (mirrors the handlers in App.tsx,
// Explorer.tsx, ImagePreview.tsx, MarkdownPreview.tsx, SvgPreview.tsx
// and Home.tsx — keep in sync when a shortcut changes)
// ─────────────────────────────────────────────────────────────
const SHORTCUT_GROUPS: { title: string; shortcuts: { keys: string[]; action: string }[] }[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["Ctrl", "K"],        action: "Jump to Home search" },
      { keys: ["Ctrl", "F"],        action: "Focus Explorer / Home search" },
      { keys: ["Ctrl", "R"],        action: "Reload app window" },
      { keys: ["F5"],                action: "Reload app window" },
      { keys: ["F11"],               action: "Toggle fullscreen" },
      { keys: ["Esc"],               action: "Close menus, dialogs & pickers" },
    ],
  },
  {
    title: "Explorer",
    shortcuts: [
      { keys: ["Ctrl", "S"],        action: "Save active tab" },
      { keys: ["Ctrl", "W"],        action: "Close active tab" },
      { keys: ["Ctrl", "N"],        action: "New file" },
      { keys: ["Ctrl", "A"],        action: "Select all files" },
      { keys: ["F2"],                action: "Rename selected item / active tab" },
      { keys: ["Del"],               action: "Delete selected items" },
      { keys: ["Enter"],             action: "Confirm name input" },
    ],
  },
  {
    title: "Image Viewer",
    shortcuts: [
      { keys: ["Ctrl", "+"],        action: "Zoom in" },
      { keys: ["Ctrl", "−"],        action: "Zoom out" },
      { keys: ["Ctrl", "0"],        action: "Fit to view" },
      { keys: ["Ctrl", "1"],        action: "Actual size (100%)" },
      { keys: ["R"],                 action: "Rotate clockwise" },
      { keys: ["Shift", "R"],       action: "Rotate counter-clockwise" },
      { keys: ["H"],                 action: "Flip horizontally" },
      { keys: ["V"],                 action: "Flip vertically" },
      { keys: ["I"],                 action: "Toggle eyedropper" },
    ],
  },
  {
    title: "Markdown Preview",
    shortcuts: [
      { keys: ["Ctrl", "P"],        action: "Open print & save dialog" },
    ],
  },
  {
    title: "SVG Viewer",
    shortcuts: [
      { keys: ["Ctrl", "Wheel"],    action: "Zoom in / out" },
    ],
  },
  {
    title: "Home Search",
    shortcuts: [
      { keys: ["↑"],                 action: "Select previous result" },
      { keys: ["↓"],                 action: "Select next result" },
      { keys: ["Enter"],             action: "Open selected result" },
      { keys: ["Esc"],               action: "Clear search" },
    ],
  },
  {
    title: "Mouse",
    shortcuts: [
      { keys: ["Back"],              action: "Previous page" },
      { keys: ["Fwd"],               action: "Next page" },
      { keys: ["R-Click"],           action: "Context menu" },
    ],
  },
];

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
  const updater = useUpdater();
  const [config, setConfig] = useState<AppConfig | null>(null);

  const [activeColorKey, setActiveColorKey] = useState<string | null>(null);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const { showContextMenu, ContextMenuComponent } = useCustomContextMenu();

  const [customPresets, setCustomPresets] = useState<{ name: string; path: string; colors: Record<string, string> }[]>([]);
  const [selectedPresetName, setSelectedPresetName] = useState<string>("custom_select");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [rollDegrees, setRollDegrees] = useState(0);

  const [localUiSmoothness, setLocalUiSmoothness] = useState<number>(4);
  const [localNavSmoothness, setLocalNavSmoothness] = useState<number>(4);

  // Debounced storage-path editing: the text inputs keep uncommitted drafts in
  // local state and only persist via saveConfig after the user pauses typing
  // (300 ms) or blurs the field – not on every keystroke.
  const [storageDraft, setStorageDraft] = useState<{ root_path?: string; workspace_path?: string }>({});
  const storageDraftRef = React.useRef<{ root_path?: string; workspace_path?: string }>({});
  const textSaveDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest config for callbacks (debounce timers / unmount flush) that must
  // not capture a stale render's `config`.
  const configRef = React.useRef<AppConfig | null>(null);

  React.useEffect(() => { configRef.current = config; }, [config]);

  // ── ALL LOGIC BELOW IS 100% IDENTICAL TO ORIGINAL ─────────────────────────

  const handleSliderDrag = (key: string, val: string) => {
    if (!config) return;
    const overrides = { ...config.theme.ui_overrides, [key]: val };
    applyTheme(overrides, config.theme.font_family_ui, config.theme.theme_preset);
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
    const currentPaper = (config.theme.ui_overrides.nav_background || "#0B0F19").toLowerCase();
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
      theme_version: THEME_VERSION,
    };
    const bgLower = randomPalette.nav_background.toLowerCase();
    const isLightBg = bgLower.startsWith("#f");
    const overrides = { ...config.theme.ui_overrides, ...targetColors };
    const next = {
      ...config,
      theme: {
        ...config.theme,
        theme_preset: isLightBg ? "light" : "dark",
        ui_overrides: overrides,
      },
    };
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

  const handleSetThemeMode = async (mode: "dark" | "light") => {
    if (!config) return;
    const baseOv = mode === "light" ? QUANTUM_LIGHT_OVERRIDES : QUANTUM_DARK_OVERRIDES;
    const curOv = config.theme.ui_overrides || {};
    const nextOverrides: Record<string, string> = {
      ...curOv,
      ...baseOv,
      ghost_fiber_glow: curOv.ghost_fiber_glow || baseOv.ghost_fiber_glow,
      ghost_fiber_secondary: curOv.ghost_fiber_secondary || baseOv.ghost_fiber_secondary,
      ghost_fiber_line: curOv.ghost_fiber_line || baseOv.ghost_fiber_line,
      ghost_fiber_opacity: curOv.ghost_fiber_opacity || baseOv.ghost_fiber_opacity,
      ghost_fiber_style: curOv.ghost_fiber_style || baseOv.ghost_fiber_style,
      ghost_fiber_enabled: curOv.ghost_fiber_enabled || baseOv.ghost_fiber_enabled,
      navbar_edge_smoothness: curOv.navbar_edge_smoothness || "8px",
      ui_edge_smoothness: curOv.ui_edge_smoothness || "8px",
      theme_version: THEME_VERSION,
    };
    const next = {
      ...config,
      theme: {
        ...config.theme,
        theme_preset: mode,
        accent_color: "#2457FF",
        ui_overrides: nextOverrides,
      },
    };
    await saveConfig(next);
  };

  const handleSelectPreset = async (presetName: string) => {
    if (!config) return;
    setSelectedPresetName(presetName);
    let targetColors: Record<string, string> = {};
    let nextPresetMode = config.theme.theme_preset;

    if (presetName === "system_default_quantum_dark") {
      nextPresetMode = "dark";
      targetColors = {
        ...QUANTUM_DARK_OVERRIDES,
        ghost_fiber_opacity: config.theme.ui_overrides?.ghost_fiber_opacity || "0.45",
        ghost_fiber_style: config.theme.ui_overrides?.ghost_fiber_style || "dots",
        ghost_fiber_enabled: config.theme.ui_overrides?.ghost_fiber_enabled || "true",
      };
    } else if (presetName === "system_default_quantum_light") {
      nextPresetMode = "light";
      targetColors = {
        ...QUANTUM_LIGHT_OVERRIDES,
        ghost_fiber_opacity: config.theme.ui_overrides?.ghost_fiber_opacity || "0.45",
        ghost_fiber_style: config.theme.ui_overrides?.ghost_fiber_style || "dots",
        ghost_fiber_enabled: config.theme.ui_overrides?.ghost_fiber_enabled || "true",
      };
    } else {
      const preset = customPresets.find(p => p.name === presetName);
      if (preset) targetColors = { ...preset.colors, theme_version: THEME_VERSION };
      else return;
    }
    const overrides = { ...config.theme.ui_overrides, ...targetColors };
    const next = {
      ...config,
      theme: {
        ...config.theme,
        theme_preset: nextPresetMode,
        accent_color: targetColors.border_accent || "#2457FF",
        ui_overrides: overrides,
      },
    };
    await saveConfig(next);
  };

  useEffect(() => {
    if (!config) return;
    const ov = config.theme.ui_overrides || {};
    const isLight = config.theme.theme_preset === "light";
    const bg = (ov.content_background || ov.nav_background || "").trim().toLowerCase();
    const accent = (ov.border_accent || "#2457FF").trim().toLowerCase();

    if (isLight && (bg === "#f0f4f8" || bg === "#ffffff" || bg === "") && accent === "#2457ff") {
      setSelectedPresetName("system_default_quantum_light");
      return;
    }
    if (!isLight && (bg === "#0b0f19" || bg === "") && accent === "#2457ff") {
      setSelectedPresetName("system_default_quantum_dark");
      return;
    }
    const matchedCustom = customPresets.find(p =>
      p.colors?.nav_background?.toLowerCase() === ov.nav_background?.toLowerCase() &&
      p.colors?.text_color?.toLowerCase() === ov.text_color?.toLowerCase() &&
      p.colors?.card_background?.toLowerCase() === ov.card_background?.toLowerCase() &&
      p.colors?.border_accent?.toLowerCase() === ov.border_accent?.toLowerCase()
    );
    setSelectedPresetName(matchedCustom ? matchedCustom.name : "custom_select");
  }, [config?.theme?.theme_preset, config?.theme?.ui_overrides, customPresets]);

  const loadAll = async () => {
    try {
      const cfg: AppConfig = await invoke("get_app_config");
      setConfig(cfg);
      applyTheme(cfg.theme.ui_overrides, cfg.theme.font_family_ui, cfg.theme.theme_preset);
      setLocalUiSmoothness(parseInt(cfg.theme.ui_overrides.ui_edge_smoothness || "8"));
      setLocalNavSmoothness(parseInt(cfg.theme.ui_overrides.navbar_edge_smoothness || "8"));
      await loadCustomPresets(cfg.storage.root_path);
    } catch (e) { console.error(e); }
  };

  const applyTheme = (overrides: Record<string, string>, fontFamily?: string, themePreset?: string) => {
    applyThemeToDocument(overrides, fontFamily, themePreset ?? configRef.current?.theme?.theme_preset);
  };

  useEffect(() => {
    loadAll();
    const configUnsub = listen<AppConfig | null>("config_updated", (e) => {
      const cfg = e.payload;
      if (cfg && cfg.theme) {
        setConfig(cfg);
        applyTheme(cfg.theme.ui_overrides, cfg.theme.font_family_ui, cfg.theme.theme_preset);
        setLocalUiSmoothness(parseInt(cfg.theme.ui_overrides.ui_edge_smoothness || "8"));
        setLocalNavSmoothness(parseInt(cfg.theme.ui_overrides.navbar_edge_smoothness || "8"));
      } else {
        invoke<AppConfig>("get_app_config").then(fresh => {
          setConfig(fresh);
          applyTheme(fresh.theme.ui_overrides, fresh.theme.font_family_ui, fresh.theme.theme_preset);
          setLocalUiSmoothness(parseInt(fresh.theme.ui_overrides.ui_edge_smoothness || "8"));
          setLocalNavSmoothness(parseInt(fresh.theme.ui_overrides.navbar_edge_smoothness || "8"));
        }).catch(() => {});
      }
    });
    return () => {
      configUnsub.then(fn => fn());
      if (saveTimeoutRef.current)  clearTimeout(saveTimeoutRef.current);
      if (colorDebounceRef.current) clearTimeout(colorDebounceRef.current);
      // Persist any storage-path edits still pending when the page unmounts.
      flushStorageDraft();
    };
  }, []);

  const saveConfig = async (next: AppConfig) => {
    configRef.current = next;
    setConfig(next);
    await invoke("save_app_config", { config: next });
    applyTheme(next.theme.ui_overrides, next.theme.font_family_ui, next.theme.theme_preset);
    await emit("config_updated", next);
  };

  // Commit any pending storage-path draft to the config (single save + emit).
  const flushStorageDraft = () => {
    if (textSaveDebounceRef.current) {
      clearTimeout(textSaveDebounceRef.current);
      textSaveDebounceRef.current = null;
    }
    const draft = storageDraftRef.current;
    if (draft.root_path === undefined && draft.workspace_path === undefined) return;
    const base = configRef.current;
    if (!base) return;
    storageDraftRef.current = {};
    setStorageDraft({});
    saveConfig({ ...base, storage: { ...base.storage, ...draft } });
  };

  const updateStorageDraft = (patch: { root_path?: string; workspace_path?: string }) => {
    const next = { ...storageDraftRef.current, ...patch };
    storageDraftRef.current = next;
    setStorageDraft(next);
    if (textSaveDebounceRef.current) clearTimeout(textSaveDebounceRef.current);
    textSaveDebounceRef.current = setTimeout(flushStorageDraft, 300);
  };

  const patchOverride = async (key: string, val: string) => {
    if (!config) return;
    const overrides = { ...config.theme.ui_overrides, [key]: val, theme_version: THEME_VERSION };
    const next = { ...config, theme: { ...config.theme, ui_overrides: overrides } };
    setConfig(next);
    applyTheme(overrides, config.theme.font_family_ui, config.theme.theme_preset);
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
          <div className="stt-col-stack">

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
                    value={storageDraft.root_path ?? config.storage.root_path}
                    onChange={e => updateStorageDraft({ root_path: e.target.value })}
                    onBlur={flushStorageDraft}
                    className="stt-input stt-input-mono"
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={async () => {
                      const chosen: string | null = await invoke("pick_directory");
                      if (chosen) {
                        updateStorageDraft({ root_path: chosen });
                        flushStorageDraft();
                      }
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
                    value={storageDraft.workspace_path ?? config.storage.workspace_path ?? ""}
                    placeholder="Same as storage root (fallback)"
                    onChange={e => updateStorageDraft({ workspace_path: e.target.value })}
                    onBlur={flushStorageDraft}
                    className="stt-input stt-input-mono"
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={async () => {
                      const chosen: string | null = await invoke("pick_directory");
                      if (chosen) {
                        updateStorageDraft({ workspace_path: chosen });
                        flushStorageDraft();
                      }
                    }}
                    className="stt-browse-btn"
                  >
                    Browse…
                  </button>
                </div>
              </div>

              <div className="stt-subgrid-2">
                <div className="stt-field">
                  <span className="stt-label">Launch Page</span>
                  <GlideSelect
                    fullWidth
                    ariaLabel="Launch Page"
                    value={config.general.launch_page}
                    onChange={val => saveConfig({ ...config, general: { ...config.general, launch_page: val } })}
                    options={[
                      { value: "Home", label: "Overview" },
                      { value: "Explorer", label: "Files" },
                      { value: "Settings", label: "Settings" },
                    ]}
                  />
                </div>

                <div className="stt-field" style={{ position: "relative" }}>
                  <span className="stt-label">Nav Layout</span>
                  <GlideSelect
                    fullWidth
                    ariaLabel="Nav Layout"
                    value={config.theme.nav_layout || "top_navbar"}
                    onChange={async val => {
                      await emit("nav_layout_changed", val);
                      const next = { ...config, theme: { ...config.theme, nav_layout: val } };
                      await saveConfig(next);
                      await emit("config_updated", next);
                    }}
                    options={[
                      { value: "top_navbar", label: "Top Navbar (Default)" },
                      { value: "bottom_navbar", label: "Bottom Navbar" },
                    ]}
                  />
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

            {/* Card: Application Updates */}
            <div className="stt-section">
              <div className="stt-section-title">
                <ArrowUpCircle size={12} />
                Application Updates
              </div>

              {/* Auto-update toggle */}
              <div className="stt-field">
                <div className="stt-field-row">
                  <div>
                    <span className="stt-label">Automatic Updates</span>
                    <div className="stt-label-hint">Automatically check for updates on app launch</div>
                  </div>
                  <label className="stt-toggle-wrapper">
                    <input
                      type="checkbox"
                      className="stt-toggle-input"
                      checked={config.general.auto_update}
                      onChange={e => saveConfig({ ...config, general: { ...config.general, auto_update: e.target.checked } })}
                    />
                    <span className="stt-toggle-track" />
                  </label>
                </div>
              </div>

              <div className="stt-divider" />

              {/* Version & Manual Check */}
              <div className="stt-field">
                <div className="stt-field-row">
                  <div>
                    <span className="stt-label">Installed Version</span>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                      v{updater.currentVersion}
                    </div>
                  </div>

                  <button
                    onClick={() => updater.checkForUpdates(false)}
                    disabled={updater.status === "checking" || updater.status === "downloading" || updater.status === "installing"}
                    className="stt-btn-secondary"
                    style={{ display: "flex", alignItems: "center", gap: "6px" }}
                  >
                    <RefreshCw size={12} className={updater.status === "checking" ? "animate-spin" : ""} />
                    <span>{updater.status === "checking" ? "Checking…" : "Check for Updates"}</span>
                  </button>
                </div>

                {/* State: Up to date */}
                {updater.status === "upToDate" && (
                  <div className="stt-update-badge stt-update-badge--uptodate" style={{ alignSelf: "flex-start", marginTop: "6px" }}>
                    <CheckCircle size={12} />
                    <span>You are on the latest version</span>
                  </div>
                )}

                {/* State: Error */}
                {updater.status === "error" && (
                  <div className="stt-update-card" style={{ borderColor: "rgba(239,68,68,0.25)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                      <AlertCircle size={14} style={{ color: "#ef4444", flexShrink: 0, marginTop: "2px" }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-primary)", fontWeight: 600 }}>Check Failed</span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", wordBreak: "break-word" }}>
                          {updater.errorMessage || "Could not check for updates."}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* State: Update Available */}
                {(updater.status === "available" || updater.status === "downloading" || updater.status === "installing") && (
                  <div className="stt-update-card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div className="stt-update-badge stt-update-badge--available">
                        <ArrowUpCircle size={12} />
                        <span>Update Available: v{updater.newVersion}</span>
                      </div>
                      {updater.releaseDate && (
                        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                          {new Date(updater.releaseDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    {updater.releaseNotes && (
                      <div style={{ fontSize: "11px", color: "var(--text-secondary)", maxHeight: "80px", overflowY: "auto", whiteSpace: "pre-wrap", padding: "6px 8px", backgroundColor: "var(--bg-app)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                        {updater.releaseNotes}
                      </div>
                    )}

                    {updater.status === "downloading" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                          <span style={{ color: "var(--text-muted)" }}>Downloading update…</span>
                          <span style={{ fontWeight: 600, color: "var(--accent)" }}>{updater.downloadProgress}%</span>
                        </div>
                        <div className="stt-progress-track">
                          <div className="stt-progress-fill" style={{ width: `${updater.downloadProgress}%` }} />
                        </div>
                      </div>
                    )}

                    {updater.status === "installing" && (
                      <div style={{ fontSize: "11px", color: "var(--accent)", display: "flex", alignItems: "center", gap: "6px" }}>
                        <RefreshCw size={12} className="animate-spin" />
                        <span>Installing update and restarting…</span>
                      </div>
                    )}

                    {updater.status === "available" && (
                      <button
                        onClick={updater.downloadAndInstall}
                        className="stt-btn-primary"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          padding: "8px 12px",
                          backgroundColor: "var(--accent)",
                          color: "#FFFFFF",
                          borderRadius: "var(--radius-sm)",
                          fontWeight: 600,
                          fontSize: "12px",
                          border: "none",
                          cursor: "pointer",
                          marginTop: "4px"
                        }}
                      >
                        <Download size={13} />
                        <span>Download &amp; Install Update</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>


          {/* ── RIGHT COLUMN: Visual Palette ──────────────────── */}
          <div className="stt-col-stack">

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

              {/* Appearance Mode (Quantum Blue Light / Dark) */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span className="stt-label" style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Appearance Mode
                </span>
                <div className="stt-subgrid-2" style={{ gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => handleSetThemeMode("dark")}
                    className="glass-card flex items-center justify-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-all"
                    style={{
                      border: config.theme.theme_preset !== "light" ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                      backgroundColor: config.theme.theme_preset !== "light" ? "var(--accent-soft)" : "var(--bg-surface-elevated)",
                      color: config.theme.theme_preset !== "light" ? "var(--accent-text, var(--accent))" : "var(--text-secondary)",
                      fontSize: "11.5px",
                      fontWeight: config.theme.theme_preset !== "light" ? 700 : 500,
                    }}
                  >
                    <Moon size={13} />
                    <span>Dark Mode</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetThemeMode("light")}
                    className="glass-card flex items-center justify-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-all"
                    style={{
                      border: config.theme.theme_preset === "light" ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                      backgroundColor: config.theme.theme_preset === "light" ? "var(--accent-soft)" : "var(--bg-surface-elevated)",
                      color: config.theme.theme_preset === "light" ? "var(--accent)" : "var(--text-secondary)",
                      fontSize: "11.5px",
                      fontWeight: config.theme.theme_preset === "light" ? 700 : 500,
                    }}
                  >
                    <Sun size={13} />
                    <span>Light Mode</span>
                  </button>
                </div>
              </div>

              {/* Preset selector */}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <GlideSelect
                  fullWidth
                  ariaLabel="Theme Preset"
                  value={selectedPresetName}
                  onChange={handleSelectPreset}
                  style={{ flex: 1 }}
                  options={[
                    { value: "system_default_quantum_dark", label: "Quantum Blue (Dark — Default)" },
                    { value: "system_default_quantum_light", label: "Quantum Blue (Light)" },
                    ...customPresets.map(p => ({ value: p.name, label: `Preset: ${p.name}` })),
                    { value: "custom_select", label: "— Custom overrides active —", disabled: true },
                  ]}
                />
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
              <div className="stt-subgrid-swatches" style={{ paddingTop: "4px" }}>
                {[
                  { key: "nav_background",  label: "Paper / Nav Background" },
                  { key: "card_background", label: "Card / Panel Surface"   },
                  { key: "card_border",     label: "Card Border & Rule"      },
                  { key: "border_accent",   label: "Accent Highlight Color"  },
                  { key: "text_color",      label: "Main Typography Color"   },
                ].map(({ key, label }) => {
                  const currentVal = config.theme.ui_overrides[key] || (DEFAULT_THEME.ui_overrides as any)[key] || "#0B0F19";
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
                <GlideSelect
                  fullWidth
                  ariaLabel="Typography System"
                  value={getFontPreset(config.theme.font_family_ui).id}
                  onChange={font => {
                    const next = { ...config, theme: { ...config.theme, font_family_ui: font } };
                    saveConfig(next);
                  }}
                  options={FONT_PRESETS.map(f => ({ value: f.id, label: `${f.label} — ${f.desc}` }))}
                />
              </div>
            </div>

            {/* Card: Ghost Fiber Ambient Canvas */}
            <div className="stt-section" style={{ position: "relative", zIndex: 15 }}>
              <div className="stt-section-title">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <Sparkles size={12} style={{ color: "var(--accent)" }} /> Ghost Fiber Canvas
                  </span>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "11px", color: "var(--text-secondary)" }}>
                    <input
                      type="checkbox"
                      checked={config.theme.ui_overrides.ghost_fiber_enabled !== "false"}
                      onChange={e => patchOverride("ghost_fiber_enabled", e.target.checked ? "true" : "false")}
                      style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                    />
                    <span>Active</span>
                  </label>
                </div>
              </div>

              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "-4px", marginBottom: "8px" }}>
                Interactive generative ribbons rendered across the application background with live physics and mouse interaction.
              </p>

              {/* Quick Preset Swatches (Quantum Blue only) */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
                <span className="stt-label" style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Palette Preset
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
                  {[
                    {
                      id: "quantum",
                      name: "Quantum Blue",
                      glow: QUANTUM_GHOST_FIBER_DEFAULTS.ghost_fiber_glow,
                      sec: QUANTUM_GHOST_FIBER_DEFAULTS.ghost_fiber_secondary,
                      line: QUANTUM_GHOST_FIBER_DEFAULTS.ghost_fiber_line,
                    },
                  ].map(preset => {
                    const isCurrent =
                      (config.theme.ui_overrides.ghost_fiber_glow || preset.glow).toLowerCase() === preset.glow.toLowerCase() &&
                      (config.theme.ui_overrides.ghost_fiber_secondary || preset.sec).toLowerCase() === preset.sec.toLowerCase();
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          const overrides = {
                            ...config.theme.ui_overrides,
                            ghost_fiber_glow: preset.glow,
                            ghost_fiber_secondary: preset.sec,
                            ghost_fiber_line: preset.line,
                            theme_version: THEME_VERSION,
                          };
                          const next = { ...config, theme: { ...config.theme, ui_overrides: overrides } };
                          saveConfig(next);
                        }}
                        className="glass-card group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all"
                        style={{
                          border: isCurrent ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                          backgroundColor: isCurrent ? "var(--accent-soft)" : "var(--bg-surface-elevated)",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: "11.5px", fontWeight: isCurrent ? 700 : 500, color: isCurrent ? "var(--accent-text, var(--accent))" : "var(--text-primary)" }}>
                            {preset.name}
                          </span>
                          <div style={{ display: "flex", gap: "5px" }}>
                            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: preset.glow, display: "inline-block" }} />
                            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: preset.sec, display: "inline-block" }} />
                            <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: preset.line, border: "1px solid var(--border-default)", display: "inline-block" }} />
                          </div>
                        </div>
                        {isCurrent && <Check size={13} style={{ color: "var(--accent-text, var(--accent))" }} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color swatch overrides */}
              <div className="stt-fiber-swatches" style={{ paddingTop: "4px" }}>
                {[
                  { key: "ghost_fiber_glow",      label: "Glow Hue (Main)", defaultVal: "#2457FF" },
                  { key: "ghost_fiber_secondary", label: "Gradient Blend",  defaultVal: "#00D4FF" },
                  { key: "ghost_fiber_line",      label: "Folds & Tips",    defaultVal: "#DFF7FF" },
                ].map(({ key, label, defaultVal }) => {
                  const currentVal = config.theme.ui_overrides[key] || defaultVal;
                  return (
                    <div key={key} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span className="stt-label" style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        {label}
                      </span>
                      <div className="stt-color-row">
                        <input
                          type="color"
                          value={currentVal.startsWith("#") && currentVal.length === 7 ? currentVal : defaultVal}
                          onChange={e => patchOverride(key, e.target.value)}
                          className="stt-color-swatch cursor-pointer"
                          style={{ padding: 0, border: "none", width: "24px", height: "24px" }}
                        />
                        <AnimatedHexInput
                          value={currentVal}
                          onChange={val => patchOverride(key, val)}
                          className="stt-hex-input"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Style & Opacity Controls */}
              <div className="stt-subgrid-2" style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span className="stt-label" style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    Canvas Opacity
                  </span>
                  <GlideSelect
                    fullWidth
                    ariaLabel="Canvas Opacity"
                    value={config.theme.ui_overrides.ghost_fiber_opacity || "0.45"}
                    onChange={val => patchOverride("ghost_fiber_opacity", val)}
                    options={[
                      { value: "0.20", label: "20% — Subtle & Muted" },
                      { value: "0.35", label: "35% — Soft Ambient" },
                      { value: "0.45", label: "45% — Balanced (Default)" },
                      { value: "0.65", label: "65% — Vivid & Bright" },
                      { value: "0.85", label: "85% — High Intensity" },
                    ]}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span className="stt-label" style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    Fiber Drawing Style
                  </span>
                  <GlideSelect
                    fullWidth
                    ariaLabel="Fiber Drawing Style"
                    value={config.theme.ui_overrides.ghost_fiber_style || "dots"}
                    onChange={val => patchOverride("ghost_fiber_style", val)}
                    options={[
                      { value: "dots", label: "Dots (Standard Particulate)" },
                      { value: "dashes", label: "Dashes (Streamline Streaks)" },
                      { value: "lines", label: "Continuous Lines (Silk Ribbons)" },
                    ]}
                  />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── Keyboard Shortcuts (full width) ─────────────────── */}
        <div className="stt-section stt-section--span-full" style={{ marginTop: "16px" }}>
          <div className="stt-section-title">
            <Keyboard size={12} />
            Keyboard Shortcuts
          </div>

          <div className="stt-shortcut-groups">
            {SHORTCUT_GROUPS.map(group => (
              <div key={group.title} className="stt-shortcut-group">
                <div className="stt-shortcut-group-title">{group.title}</div>
                {group.shortcuts.map(sc => (
                  <div key={sc.action} className="stt-shortcut-row">
                    <span className="stt-shortcut-action">{sc.action}</span>
                    <span className="stt-shortcut-keys">
                      {sc.keys.map((k, i) => (
                        <React.Fragment key={k}>
                          {i > 0 && <span className="stt-shortcut-plus">+</span>}
                          <kbd className="stt-kbd">{k}</kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ))}
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
                        nav_background:  config.theme.ui_overrides.nav_background  || "#0B0F19",
                        text_color:      config.theme.ui_overrides.text_color      || "#F0F4F8",
                        card_background: config.theme.ui_overrides.card_background || "#121829",
                        border_accent:   config.theme.ui_overrides.border_accent   || "#2457FF",
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
