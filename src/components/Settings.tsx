// @ts-nocheck
import React, { useState, useEffect } from "react";
import { Sliders, RefreshCw, ChevronDown, Save, Dices, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { AppConfig } from "../types";
import { useCustomContextMenu } from "./ContextMenu";

const DEFAULT_THEME = {
  theme_preset: "light",
  accent_color: "#b8440c",
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
  nav_separator_color: "#c9bfab",
  nav_glass_effect: false,
  ui_overrides: {
    nav_background: "#f6f2ea",
    content_background: "#f6f2ea",
    card_background: "#ede8dc",
    card_border: "#c9bfab",
    text_color: "#18140f",
    border_accent: "#b8440c",
    navbar_edge_smoothness: "0px",
  }
};

const PRESETS: Record<string, string[]> = {
  nav_background: ["#f6f2ea", "#faf6ee", "#f4efe6", "#e8e4d9", "#ffffff", "#2b2621", "#1a1612", "#181410"],
  text_color: ["#18140f", "#2c251e", "#3d332a", "#121e15", "#2a3d45", "#f6f2ea", "#ede8dc", "#ffffff"],
  card_background: ["#ede8dc", "#e4decb", "#dcd6c5", "#e5dfd0", "#fbfaf7", "#3b342c", "#28231d", "#221e1a"],
  border_accent: ["#b8440c", "#8c2d19", "#1a5f49", "#245d82", "#6f3c89", "#c29b38", "#4e6151", "#2e4057"]
};

const FONT_PRESETS = [
  { id: "editorial", label: "Neo-Classical", desc: "EB Garamond + Playfair (Elegant Editorial)", text: '"EB Garamond", Georgia, serif', display: '"Playfair Display", Georgia, serif', sans: '"Inter", system-ui, sans-serif' },
  { id: "modern_sans", label: "Crisp Sans", desc: "Unified Inter (Clean & Tech-focused)", text: '"Inter", system-ui, sans-serif', display: '"Inter", system-ui, sans-serif', sans: '"Inter", system-ui, sans-serif' },
  { id: "monospace", label: "Cyber Mono", desc: "Unified JetBrains Mono (Terminal Aesthetic)", text: '"JetBrains Mono", monospace', display: '"JetBrains Mono", monospace', sans: '"JetBrains Mono", monospace' },
  { id: "retro_serif", label: "Warm Retro", desc: "Georgia + Courier New (Vintage Press)", text: 'Georgia, serif', display: '"Courier New", Courier, monospace', sans: 'Georgia, serif' },
  { id: "outfit", label: "Geometric Sans", desc: "Unified Outfit (Friendly Modern Sans)", text: '"Outfit", sans-serif', display: '"Outfit", sans-serif', sans: '"Outfit", sans-serif' },
  { id: "spacemono", label: "Space Monospace", desc: "Space Mono (Futuristic Dashboard Numerals)", text: '"Space Mono", monospace', display: '"Space Mono", monospace', sans: '"Space Mono", monospace' },
  { id: "firacode", label: "Fira Code Monospace", desc: "Fira Code (Tabular Programmer Numerals)", text: '"Fira Code", monospace', display: '"Fira Code", monospace', sans: '"Fira Code", monospace' },
  { id: "lexend", label: "Data Geometric", desc: "Lexend (Engineered Readable Math & Digits)", text: '"Lexend", sans-serif', display: '"Lexend", sans-serif', sans: '"Lexend", sans-serif' }
];

// ── Typewriter-animated hex input ──────────────────────────────────────────
const AnimatedHexInput: React.FC<{
  value: string;
  onChange: (val: string) => void;
  className?: string;
}> = ({ value, onChange, className }) => {
  const [displayed, setDisplayed] = React.useState(value);
  const timersRef = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const isUserRef = React.useRef(false);

  React.useEffect(() => {
    if (isUserRef.current) {
      setDisplayed(value);
      return;
    }
    if (displayed === value) return;

    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];

    const chars = value.split("");
    const newTimers = chars.map((_, i) =>
      setTimeout(() => setDisplayed(value.slice(0, i + 1)), i * 28)
    );
    timersRef.current = newTimers;
    return () => newTimers.forEach(t => clearTimeout(t));
  }, [value]);

  return (
    <input
      type="text"
      value={displayed}
      onFocus={() => { isUserRef.current = true; setDisplayed(value); }}
      onBlur={() => { isUserRef.current = false; }}
      onChange={e => {
        setDisplayed(e.target.value);
        onChange(e.target.value);
      }}
      className={className}
    />
  );
};

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

  // Lightweight local states for sliders to ensure 60+ FPS fluid dragging
  const [localGlowBrightness, setLocalGlowBrightness] = useState<number>(1.0);
  const [localUiSmoothness, setLocalUiSmoothness] = useState<number>(4);
  const [localNavSmoothness, setLocalNavSmoothness] = useState<number>(0);

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
      // DARK THEMES
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
      // LIGHT THEMES
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

    const EXCLUDED_BACKGROUNDS = new Set(["#f6f2ea", "#181410"]);
    customPresets.forEach(p => {
      if (p.colors?.nav_background) {
        EXCLUDED_BACKGROUNDS.add(p.colors.nav_background.toLowerCase());
      }
    });

    const currentPaper = (config.theme.ui_overrides.nav_background || "#f6f2ea").toLowerCase();
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
              loaded.push({
                name: parsed.name,
                path: entry.path,
                colors: parsed.colors || parsed
              });
            }
          } catch (e) {
            console.error("Failed to read theme file:", entry.path, e);
          }
        }
      }
      setCustomPresets(loaded);
    } catch (err) {
      setCustomPresets([]);
    }
  };

  const handleSelectPreset = async (presetName: string) => {
    if (!config) return;
    setSelectedPresetName(presetName);
    
    let targetColors: Record<string, string> = {};
    if (presetName === "system_default_light") {
      targetColors = {
        nav_background: "#f6f2ea",
        content_background: "#f6f2ea",
        card_background: "#ede8dc",
        card_border: "#c9bfab",
        text_color: "#18140f",
        border_accent: "#b8440c",
      };
    } else if (presetName === "system_default_dark") {
      targetColors = {
        nav_background: "#181410",
        content_background: "#181410",
        card_background: "#221e1a",
        card_border: "#3c352a",
        text_color: "#ffffff",
        border_accent: "#b8440c",
      };
    } else {
      const preset = customPresets.find(p => p.name === presetName);
      if (preset) {
        targetColors = preset.colors;
      } else {
        return;
      }
    }

    const overrides = { ...config.theme.ui_overrides, ...targetColors };
    const next = { ...config, theme: { ...config.theme, ui_overrides: overrides } };
    await saveConfig(next);
  };

  useEffect(() => {
    if (!config) return;
    const ov = config.theme.ui_overrides || {};
    const isLight = 
      ov.nav_background === "#f6f2ea" &&
      ov.text_color === "#18140f" &&
      ov.card_background === "#ede8dc" &&
      ov.card_border === "#c9bfab" &&
      ov.border_accent === "#b8440c";
    
    if (isLight) {
      setSelectedPresetName("system_default_light");
      return;
    }

    const isDark = 
      ov.nav_background === "#181410" &&
      ov.text_color === "#ffffff" &&
      ov.card_background === "#221e1a" &&
      ov.card_border === "#3c352a" &&
      ov.border_accent === "#b8440c";

    if (isDark) {
      setSelectedPresetName("system_default_dark");
      return;
    }

    const matchedCustom = customPresets.find(p => 
      p.colors?.nav_background?.toLowerCase() === ov.nav_background?.toLowerCase() &&
      p.colors?.text_color?.toLowerCase() === ov.text_color?.toLowerCase() &&
      p.colors?.card_background?.toLowerCase() === ov.card_background?.toLowerCase() &&
      p.colors?.border_accent?.toLowerCase() === ov.border_accent?.toLowerCase()
    );

    if (matchedCustom) {
      setSelectedPresetName(matchedCustom.name);
    } else {
      setSelectedPresetName("custom_select");
    }
  }, [config?.theme?.ui_overrides, customPresets]);

  const loadAll = async () => {
    try {
      const cfg: AppConfig = await invoke("get_app_config");
      setConfig(cfg);
      applyTheme(cfg.theme.ui_overrides, cfg.theme.font_family_ui);
      setLocalGlowBrightness(parseFloat(cfg.theme.ui_overrides.accent_glow_brightness || "1.0"));
      setLocalUiSmoothness(parseInt(cfg.theme.ui_overrides.ui_edge_smoothness || "4"));
      setLocalNavSmoothness(parseInt(cfg.theme.ui_overrides.navbar_edge_smoothness || "0"));
      await loadCustomPresets(cfg.storage.root_path);
    } catch (e) { console.error(e); }
  };

  const applyTheme = (overrides: Record<string, string>, fontFamily?: string) => {
    const r = document.documentElement;

    const paperColor = overrides.nav_background || "#f6f2ea";
    const inkColor   = overrides.text_color || "#18140f";
    const creamColor = overrides.card_background || "#ede8dc";
    const ruleColor  = overrides.card_border || "#c9bfab";
    const accentColor = overrides.border_accent || "#b8440c";

    r.style.setProperty("--theme-paper",  paperColor);
    r.style.setProperty("--theme-ink",    inkColor);
    r.style.setProperty("--theme-cream",  creamColor);
    r.style.setProperty("--theme-rule",   ruleColor);
    r.style.setProperty("--theme-accent", accentColor);

    const lightRuleColor = ruleColor.startsWith("#") && ruleColor.length === 7
      ? `${ruleColor}3a`
      : ruleColor;
    r.style.setProperty("--theme-light-rule", lightRuleColor);

    const mutedColor = inkColor.startsWith("#") && inkColor.length === 7
      ? `${inkColor}90`
      : "#8a7f6e";
    r.style.setProperty("--theme-muted", mutedColor);

    const glowEnabled = overrides.accent_glow === "true";
    const brightness = parseFloat(overrides.accent_glow_brightness || "1.0");
    const accentColorVal = overrides.border_accent || "#b8440c";

    const borderGlowRadius = Math.round(10 * brightness);
    const textGlowRadius = Math.round(5 * brightness);

    const baseAlpha = Math.min(1.0, brightness);
    const borderAlphaHex = Math.round(baseAlpha * 255).toString(16).padStart(2, "0");
    const textAlphaHex = Math.round(baseAlpha * 0.5 * 255).toString(16).padStart(2, "0");

    const borderGlowColor = accentColorVal.startsWith("#") && accentColorVal.length === 7
      ? `${accentColorVal}${borderAlphaHex}`
      : accentColorVal;
    const textGlowColor = accentColorVal.startsWith("#") && accentColorVal.length === 7
      ? `${accentColorVal}${textAlphaHex}`
      : `${accentColorVal}80`;

    r.style.setProperty("--theme-accent-glow", glowEnabled ? `0 0 ${borderGlowRadius}px ${borderGlowColor}` : "none");
    r.style.setProperty("--theme-accent-text-glow", glowEnabled ? `0 0 ${textGlowRadius}px ${textGlowColor}` : "none");

    const font = FONT_PRESETS.find(f => f.id === (fontFamily || "editorial")) || FONT_PRESETS[0];
    r.style.setProperty("--theme-font-text", font.text);
    r.style.setProperty("--theme-font-display", font.display);
    r.style.setProperty("--theme-font-sans", font.sans);

    r.style.setProperty("--navbar-edge-smoothness", overrides.navbar_edge_smoothness || "0px");
    r.style.setProperty("--ui-edge-smoothness", overrides.ui_edge_smoothness || "4px");
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
        setLocalNavSmoothness(parseInt(cfg.theme.ui_overrides.navbar_edge_smoothness || "0"));
      } else {
        invoke<AppConfig>("get_app_config").then(fresh => {
          setConfig(fresh);
          applyTheme(fresh.theme.ui_overrides, fresh.theme.font_family_ui);
          setLocalGlowBrightness(parseFloat(fresh.theme.ui_overrides.accent_glow_brightness || "1.0"));
          setLocalUiSmoothness(parseInt(fresh.theme.ui_overrides.ui_edge_smoothness || "4"));
          setLocalNavSmoothness(parseInt(fresh.theme.ui_overrides.navbar_edge_smoothness || "0"));
        }).catch(() => {});
      }
    });

    return () => {
      configUnsub.then(fn => fn());
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (colorDebounceRef.current) {
        clearTimeout(colorDebounceRef.current);
      }
    };
  }, []);

  const saveConfig = async (next: AppConfig) => {
    setConfig(next);
    await invoke("save_app_config", { config: next });
    applyTheme(next.theme.ui_overrides, next.theme.font_family_ui);
    await emit("config_updated", null);
  };

  const patchOverride = async (key: string, val: string) => {
    if (!config) return;
    const overrides = { ...config.theme.ui_overrides, [key]: val };
    const next = { ...config, theme: { ...config.theme, ui_overrides: overrides } };
    
    setConfig(next);
    applyTheme(overrides, config.theme.font_family_ui);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      await invoke("save_app_config", { config: next });
      await emit("config_updated", next);
    }, 200);
  };

  const patchOverrideDebounced = (key: string, val: string) => {
    if (!config) return;
    const overrides = { ...config.theme.ui_overrides, [key]: val };
    const next = { ...config, theme: { ...config.theme, ui_overrides: overrides } };

    if (colorDebounceRef.current) {
      clearTimeout(colorDebounceRef.current);
    }
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
      { label: "Refresh Configuration", onClick: loadAll }
    ]);
  };

  if (!config) {
    return <div className="flex-1 flex items-center justify-center text-muted font-sans-meta text-xs">Loading configuration…</div>;
  }

  return (
    <div 
      onContextMenu={handleBlankRightClick}
      className="flex-1 h-full overflow-y-auto bg-paper font-sans-meta text-xs select-text"
    >
      <div className="max-w-5xl mx-auto p-8 space-y-10">

        {/* ── Page header ────────────────────────────────────────────── */}
        <div className="double-rule-bottom pb-4 flex items-center justify-between">
          <div>
            <span className="kicker">Studio Configuration</span>
            <h1 className="font-serif-display text-3xl font-black italic tracking-tight mt-1 text-ink">Settings</h1>
          </div>
          <button onClick={resetTheme} className="p-2 border border-rule hover:bg-cream/45 rounded-sm text-muted flex items-center gap-1.5 font-bold uppercase text-[9px] cursor-pointer" title="Reset theme settings back to default">
            <RefreshCw size={12} /> Reset Theme
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ── LEFT COLUMN: General, Storage & Layout ────────────────── */}
          <div className="space-y-6">

            {/* Card: General & Storage */}
            <div className="p-5 border border-rule bg-cream/15 rounded-sm space-y-4">
              <span className="kicker flex items-center gap-1.5"><Sliders size={12} /> General &amp; Storage</span>
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-[10px] uppercase text-muted">Installation Storage Root</label>
                <div className="flex gap-1.5">
                  <input type="text" value={config.storage.root_path}
                    onChange={e => saveConfig({ ...config, storage: { ...config.storage, root_path: e.target.value } })}
                    className="flex-1 p-2 border border-rule/50 rounded-sm bg-paper outline-none focus:border-accent font-mono text-[11px]" />
                  <button
                    onClick={async () => {
                      const chosen: string | null = await invoke("pick_directory");
                      if (chosen) saveConfig({ ...config, storage: { ...config.storage, root_path: chosen } });
                    }}
                    className="px-3 py-1 border border-rule/50 bg-cream hover:bg-ink hover:text-paper hover:border-ink rounded-sm text-[10px] font-bold uppercase transition-all whitespace-nowrap cursor-pointer"
                  >
                    Browse…
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-[10px] uppercase text-muted">Workspace Directory</label>
                <div className="flex gap-1.5">
                  <input type="text" value={config.storage.workspace_path || ""}
                    placeholder="Same as storage root (fallback)"
                    onChange={e => saveConfig({ ...config, storage: { ...config.storage, workspace_path: e.target.value } })}
                    className="flex-1 p-2 border border-rule/50 rounded-sm bg-paper outline-none focus:border-accent font-mono text-[11px]" />
                  <button
                    onClick={async () => {
                      const chosen: string | null = await invoke("pick_directory");
                      if (chosen) saveConfig({ ...config, storage: { ...config.storage, workspace_path: chosen } });
                    }}
                    className="px-3 py-1 border border-rule/50 bg-cream hover:bg-ink hover:text-paper hover:border-ink rounded-sm text-[10px] font-bold uppercase transition-all whitespace-nowrap cursor-pointer"
                  >
                    Browse…
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-[10px] uppercase text-muted">Launch Page</label>
                  <select value={config.general.launch_page}
                    onChange={e => saveConfig({ ...config, general: { ...config.general, launch_page: e.target.value } })}
                    className="p-2 border border-rule/50 rounded-sm bg-paper outline-none cursor-pointer">
                    <option value="Explorer">Explorer</option>
                    <option value="Settings">Settings</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5 relative">
                  <label className="font-bold text-[10px] uppercase text-muted">Nav Layout</label>
                  <button
                    onClick={() => setLayoutDropdownOpen(!layoutDropdownOpen)}
                    className="p-2 border border-rule/50 rounded-sm bg-paper text-ink outline-none cursor-pointer flex items-center justify-between font-semibold text-left select-none text-xs h-10 w-full"
                  >
                    <span>
                      {config.theme.nav_layout === "sidebar" && "Left Sidebar"}
                      {config.theme.nav_layout === "right_sidebar" && "Right Sidebar"}
                      {config.theme.nav_layout === "vertical_pills" && "Left Vertical Pill"}
                      {config.theme.nav_layout === "right_vertical_pills" && "Right Vertical Pill"}
                      {config.theme.nav_layout === "top_navbar" && "Top Navbar"}
                      {config.theme.nav_layout === "bottom_navbar" && "Bottom Navbar"}
                    </span>
                    <ChevronDown size={14} className="text-muted" />
                  </button>

                  {layoutDropdownOpen && (
                    <>
                      <div 
                        className="fixed inset-0 z-40 cursor-default" 
                        onClick={() => setLayoutDropdownOpen(false)} 
                      />
                      <div className="absolute top-full left-0 w-full mt-1.5 p-1 bg-paper border-2 border-rule shadow-2xl rounded-sm flex flex-col gap-0.5 select-none z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                        {[
                          { value: "sidebar", label: "Left Sidebar" },
                          { value: "right_sidebar", label: "Right Sidebar" },
                          { value: "vertical_pills", label: "Left Vertical Pill" },
                          { value: "right_vertical_pills", label: "Right Vertical Pill" },
                          { value: "top_navbar", label: "Top Navbar" },
                          { value: "bottom_navbar", label: "Bottom Navbar" }
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
                            className={`w-full px-2.5 py-2 text-left rounded-sm text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer
                              ${config.theme.nav_layout === opt.value 
                                ? "bg-accent text-paper" 
                                : "text-muted hover:bg-cream hover:text-ink"
                              }`}
                          >
                            <span>{opt.label}</span>
                            {config.theme.nav_layout === opt.value && <span className="text-[10px]">✓</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Edge Smoothness Sliders */}
              <div className="flex flex-col gap-3 pt-4 border-t border-rule/30">
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between font-bold text-[10px] uppercase text-muted">
                    <span>Overall UI Edge Smoothness</span>
                    <span className="text-accent font-mono font-bold">
                      {localUiSmoothness}px
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input 
                      type="range" 
                      min="0" 
                      max="24" 
                      step="2" 
                      value={localUiSmoothness}
                      onChange={e => {
                        const val = parseInt(e.target.value);
                        setLocalUiSmoothness(val);
                        handleSliderDrag("ui_edge_smoothness", `${val}px`);
                      }}
                      className="flex-1 accent-accent cursor-pointer mt-1" 
                    />
                    <button 
                      onClick={() => {
                        setLocalUiSmoothness(0);
                        handleSliderDrag("ui_edge_smoothness", "0px");
                      }}
                      className="px-2 py-0.5 border border-rule/50 bg-paper hover:bg-cream hover:text-ink text-[9px] uppercase font-bold rounded-sm whitespace-nowrap cursor-pointer"
                    >
                      Sharp
                    </button>
                    <button 
                      onClick={() => {
                        setLocalUiSmoothness(24);
                        handleSliderDrag("ui_edge_smoothness", "24px");
                      }}
                      className="px-2 py-0.5 border border-rule/50 bg-paper hover:bg-cream hover:text-ink text-[9px] uppercase font-bold rounded-sm whitespace-nowrap cursor-pointer"
                    >
                      Smooth
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 pt-3 border-t border-light-rule">
                  <div className="flex justify-between font-bold text-[10px] uppercase text-muted">
                    <span>Navbar Edge Smoothness</span>
                    <span className="text-accent font-mono font-bold">
                      {localNavSmoothness}px
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input 
                      type="range" 
                      min="0" 
                      max="24" 
                      step="2" 
                      value={localNavSmoothness}
                      onChange={e => {
                        const val = parseInt(e.target.value);
                        setLocalNavSmoothness(val);
                        handleSliderDrag("navbar_edge_smoothness", `${val}px`);
                      }}
                      className="flex-1 accent-accent cursor-pointer mt-1" 
                    />
                    <button 
                      onClick={() => {
                        setLocalNavSmoothness(0);
                        handleSliderDrag("navbar_edge_smoothness", "0px");
                      }}
                      className="px-2 py-0.5 border border-rule/50 bg-paper hover:bg-cream hover:text-ink text-[9px] uppercase font-bold rounded-sm whitespace-nowrap cursor-pointer"
                    >
                      Sharp
                    </button>
                    <button 
                      onClick={() => {
                        setLocalNavSmoothness(24);
                        handleSliderDrag("navbar_edge_smoothness", "24px");
                      }}
                      className="px-2 py-0.5 border border-rule/50 bg-paper hover:bg-cream hover:text-ink text-[9px] uppercase font-bold rounded-sm whitespace-nowrap cursor-pointer"
                    >
                      Smooth
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN: Visual Palette Overrides ────────────────── */}
          <div className="space-y-6">
            <div className={`p-5 border border-rule bg-cream/15 rounded-sm space-y-4 hover-lift relative ${
              activeColorKey ? "z-30" : "z-10"
            }`}>
              <div className="flex items-center justify-between">
                <span className="kicker flex items-center gap-1.5"><Sliders size={12} /> Visual Palette Overrides</span>
                <button
                  onClick={handleRandomizeTheme}
                  className="px-2.5 py-1 border border-rule/50 bg-cream hover:bg-accent hover:text-paper rounded-sm text-[9.5px] font-bold uppercase transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                  title="Roll a random editorial theme palette"
                >
                  <Dices 
                    size={13} 
                    style={{ transform: `rotate(${rollDegrees}deg)`, transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }} 
                  />
                  <span>Randomize Palette</span>
                </button>
              </div>

              {/* Theme Presets Dropdown & Save Button */}
              <div className="flex items-center gap-2">
                <select
                  value={selectedPresetName}
                  onChange={e => handleSelectPreset(e.target.value)}
                  className="flex-1 p-2 border border-rule/50 rounded-sm bg-paper text-ink outline-none cursor-pointer text-xs font-semibold"
                >
                  <option value="system_default_light">Default Light (Editorial)</option>
                  <option value="system_default_dark">Default Dark (Midnight)</option>
                  {customPresets.map(p => (
                    <option key={p.name} value={p.name}>Preset: {p.name}</option>
                  ))}
                  <option value="custom_select" disabled>— Custom overrides active —</option>
                </select>

                <button
                  onClick={() => setShowSaveModal(true)}
                  className="px-3 py-2 border border-rule/50 bg-cream hover:bg-ink hover:text-paper rounded-sm text-[10px] font-bold uppercase transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  title="Save current colors as a custom preset"
                >
                  <Save size={12} />
                  <span>Save Preset</span>
                </button>
              </div>

              {/* Color Swatch Overrides */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                {[
                  { key: "nav_background", label: "Paper / Nav Background" },
                  { key: "card_background", label: "Card / Panel Surface" },
                  { key: "card_border", label: "Card Border & Rule" },
                  { key: "border_accent", label: "Accent Highlight Color" },
                  { key: "text_color", label: "Main Typography Color" },
                ].map(({ key, label }) => {
                  const currentVal = config.theme.ui_overrides[key] || (DEFAULT_THEME.ui_overrides as any)[key] || "#000000";
                  const isOpen = activeColorKey === key;
                  return (
                    <div key={key} className="flex flex-col gap-1 relative">
                      <label className="font-bold text-[9px] uppercase text-muted truncate">{label}</label>
                      <div className="flex items-center gap-2 border border-rule/50 p-1.5 rounded-sm bg-paper">
                        <button
                          type="button"
                          onClick={() => setActiveColorKey(isOpen ? null : key)}
                          className="w-6 h-6 rounded-sm border border-rule shadow-inner shrink-0 cursor-pointer transition-transform hover:scale-105"
                          style={{ backgroundColor: currentVal }}
                        />
                        <AnimatedHexInput
                          value={currentVal}
                          onChange={val => patchOverride(key, val)}
                          className="font-mono text-[10px] uppercase bg-transparent outline-none flex-1 min-w-0"
                        />
                      </div>

                      {/* Color Palette Popover */}
                      {isOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setActiveColorKey(null)} />
                          <div className="absolute top-full left-0 mt-1 p-2.5 bg-paper border-2 border-rule shadow-2xl rounded-sm z-50 w-56 animate-in fade-in zoom-in-95 duration-100">
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-bold text-[9px] uppercase text-muted">Palette presets</span>
                              <button onClick={() => setActiveColorKey(null)} className="text-muted hover:text-ink cursor-pointer"><X size={12} /></button>
                            </div>
                            <div className="grid grid-cols-4 gap-1.5">
                              {(PRESETS[key] || PRESETS.border_accent).map(hex => (
                                <button
                                  key={hex}
                                  onClick={() => {
                                    patchOverride(key, hex);
                                    setActiveColorKey(null);
                                  }}
                                  className="w-full h-6 rounded-sm border border-rule shadow-sm hover:scale-110 transition-transform cursor-pointer"
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

              {/* Font Family Presets */}
              <div className="flex flex-col gap-1.5 pt-3 border-t border-light-rule">
                <label className="font-bold text-[10px] uppercase text-muted">Typography System</label>
                <select
                  value={config.theme.font_family_ui}
                  onChange={e => {
                    const font = e.target.value;
                    const next = { ...config, theme: { ...config.theme, font_family_ui: font } };
                    saveConfig(next);
                  }}
                  className="p-2 border border-rule/50 rounded-sm bg-paper text-ink outline-none cursor-pointer text-xs"
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

      {/* Save Custom Preset Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-paper border-2 border-rule rounded-sm shadow-2xl max-w-sm w-full p-6 space-y-4 text-ink animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-rule/40 pb-2.5">
              <span className="kicker">Custom Theme</span>
              <button onClick={() => setShowSaveModal(false)} className="text-muted hover:text-ink cursor-pointer"><X size={14} /></button>
            </div>
            <div className="space-y-2">
              <label className="font-bold text-[10px] uppercase text-muted">Preset Name</label>
              <input
                type="text"
                placeholder="e.g. Vintage Amber"
                value={newThemeName}
                onChange={e => setNewThemeName(e.target.value)}
                className="w-full p-2 border border-rule/50 rounded-sm bg-paper outline-none focus:border-accent text-xs font-semibold"
                autoFocus
              />
              {saveError && <p className="text-[10px] text-red-600 font-mono">{saveError}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-3 py-1.5 border border-rule rounded-sm text-[10px] uppercase font-bold hover:bg-cream cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!newThemeName.trim()) {
                    setSaveError("Please enter a theme name");
                    return;
                  }
                  if (!config) return;
                  try {
                    const themeName = newThemeName.trim();
                    const separator = config.storage.root_path.includes("/") ? "/" : "\\";
                    const fileName = `${themeName.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.json`;
                    const filePath = `${config.storage.root_path}${separator}users${separator}${fileName}`;

                    const payload = {
                      name: themeName,
                      colors: {
                        nav_background: config.theme.ui_overrides.nav_background || "#f6f2ea",
                        text_color: config.theme.ui_overrides.text_color || "#18140f",
                        card_background: config.theme.ui_overrides.card_background || "#ede8dc",
                        border_accent: config.theme.ui_overrides.border_accent || "#b8440c",
                      }
                    };

                    await invoke("write_text_file", {
                      filePath,
                      content: JSON.stringify(payload, null, 2)
                    });

                    await loadCustomPresets(config.storage.root_path);
                    setSelectedPresetName(themeName);
                    setShowSaveModal(false);
                    setNewThemeName("");
                    setSaveError("");
                  } catch (err: any) {
                    setSaveError(err.toString() || "Failed to save theme file");
                  }
                }}
                className="px-4 py-1.5 bg-accent hover:bg-accent/90 text-paper font-bold text-[10px] uppercase rounded-sm cursor-pointer transition-all"
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
