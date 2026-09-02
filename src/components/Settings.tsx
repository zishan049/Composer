import React, { useState, useEffect } from "react";
import { Download, Search, Sliders, Database, RefreshCw, Cpu, Zap, ChevronDown, ChevronUp, Key, Save, Dices, MessageSquare } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { AppConfig, ModelCard, WhisperModelInfo, GpuDevice } from "../types";
import { useCustomContextMenu } from "./ContextMenu";

// Family colour/badge map
const FAMILY_BADGE: Record<string, { label: string; color: string }> = {
  llama:    { label: "Llama",    color: "#7c3aed" },
  gemma:    { label: "Gemma",    color: "#0369a1" },
  mistral:  { label: "Mistral",  color: "#0891b2" },
  phi:      { label: "Phi",      color: "#0f766e" },
  deepseek: { label: "DeepSeek", color: "#b45309" },
  qwen:     { label: "Qwen",     color: "#be185d" },
  falcon:   { label: "Falcon",   color: "#6d28d9" },
};

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
// Plays a character-by-character reveal when the value changes externally
// (e.g. dark/light toggle). Normal user typing bypasses the animation.
const AnimatedHexInput: React.FC<{
  value: string;
  onChange: (val: string) => void;
  className?: string;
}> = ({ value, onChange, className }) => {
  const [displayed, setDisplayed] = React.useState(value);
  const timersRef = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const isUserRef = React.useRef(false);

  React.useEffect(() => {
    // If user is actively typing, skip animation
    if (isUserRef.current) {
      setDisplayed(value);
      return;
    }
    if (displayed === value) return;

    // Cancel any running animation
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];

    // Typewriter: reveal one char every 28ms
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
  const colorThrottleRef = React.useRef<number>(0);

  // Model hub
  const [hfSearchQuery, setHfSearchQuery] = useState<string>("");
  const [hfModels, setHfModels] = useState<ModelCard[]>([]);
  const [filteredFamily, setFilteredFamily] = useState<string>("all");
  const [whisperModels, setWhisperModels] = useState<WhisperModelInfo[]>([]);
  const [loadedModelName, setLoadedModelName] = useState<string | null>(null);

  // GPU
  const [gpuDevices, setGpuDevices] = useState<GpuDevice[]>([]);
  const [gpuLayers, setGpuLayers] = useState<number>(0);
  const [gpuBackend, setGpuBackend] = useState<string>("cpu");
  const [gpuSectionOpen, setGpuSectionOpen] = useState<boolean>(true);
  const [vramHint, setVramHint] = useState<string>("");   // shown next to Load button

  // Download feedback
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [whisperProgress, setWhisperProgress] = useState<Record<string, number>>({});
  const [whisperError, setWhisperError] = useState<string | null>(null);
  const [whisperRunMode, setWhisperRunMode] = useState<Record<string, "gpu" | "cpu">>({});
  const [whisperEngineStatus, setWhisperEngineStatus] = useState<"unknown" | "downloading" | "ready">("unknown");

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

    // ── 60 hand-curated palettes — 30 dark, 30 light ──────────────────────
    const RANDOM_PALETTES = [
      // ── DARK THEMES (30) ──────────────────────────────────────────────────
      { nav_background: "#1b222c", text_color: "#e5ecef", card_background: "#222a36", card_border: "#2e3b4e", border_accent: "#88c0d0" }, // Nordic Ice
      { nav_background: "#141c16", text_color: "#e1ebd8", card_background: "#1c261e", card_border: "#243328", border_accent: "#80b686" }, // Forest Moss
      { nav_background: "#0c0a12", text_color: "#eceaf0", card_background: "#151221", card_border: "#2a1e3d", border_accent: "#ff007f" }, // Cyber Neon
      { nav_background: "#0f111a", text_color: "#e6e8f2", card_background: "#161826", card_border: "#20233b", border_accent: "#7582ff" }, // Tokyo Midnight
      { nav_background: "#1d1d1f", text_color: "#f5f5f7", card_background: "#272729", card_border: "#333336", border_accent: "#86868b" }, // Minimal Charcoal
      { nav_background: "#120e0c", text_color: "#f0e6e1", card_background: "#1c1714", card_border: "#2b211d", border_accent: "#d4a373" }, // Espresso Wood
      { nav_background: "#0a1128", text_color: "#e2eafd", card_background: "#101f42", card_border: "#1a2c5a", border_accent: "#00b4d8" }, // Deep Ocean
      { nav_background: "#002b36", text_color: "#93a1a1", card_background: "#073642", card_border: "#0b4f60", border_accent: "#cb4b16" }, // Solarized Teal
      { nav_background: "#0d1117", text_color: "#c9d1d9", card_background: "#161b22", card_border: "#21262d", border_accent: "#58a6ff" }, // GitHub Dark
      { nav_background: "#1a0a2e", text_color: "#e8d5ff", card_background: "#250d40", card_border: "#3a1460", border_accent: "#bf5af2" }, // Cosmic Grape
      { nav_background: "#0b1a1a", text_color: "#d0ede0", card_background: "#0f2420", card_border: "#153528", border_accent: "#00e5bc" }, // Dark Teal
      { nav_background: "#18110c", text_color: "#ffe9cc", card_background: "#241808", card_border: "#3a2410", border_accent: "#ff9d00" }, // Amber Ember
      { nav_background: "#100d1a", text_color: "#dcd8f0", card_background: "#17132a", card_border: "#221b3e", border_accent: "#9f7dff" }, // Dusk Violet
      { nav_background: "#0e1a0e", text_color: "#b3ffb3", card_background: "#122012", card_border: "#1a2e1a", border_accent: "#39ff14" }, // Matrix Green
      { nav_background: "#1a0d0d", text_color: "#ffe5e5", card_background: "#261212", card_border: "#3d1a1a", border_accent: "#ff3d3d" }, // Blood Moon
      { nav_background: "#12161c", text_color: "#cdd6f4", card_background: "#1e2230", card_border: "#2a3146", border_accent: "#89b4fa" }, // Catppuccin Mocha
      { nav_background: "#0c0e14", text_color: "#d8dee9", card_background: "#131720", card_border: "#1c2030", border_accent: "#5e81ac" }, // Polar Night
      { nav_background: "#1c1a1c", text_color: "#e1d5c9", card_background: "#2a2428", card_border: "#3a3038", border_accent: "#d4956a" }, // Warm Slate
      { nav_background: "#091015", text_color: "#c5e3f0", card_background: "#0e1c25", card_border: "#152838", border_accent: "#4fc3f7" }, // Midnight Cyan
      { nav_background: "#150a00", text_color: "#ffddb3", card_background: "#1f1000", card_border: "#2e1800", border_accent: "#ff8c00" }, // Dark Ember
      { nav_background: "#0e0a18", text_color: "#f0d9ff", card_background: "#160f28", card_border: "#1e1438", border_accent: "#da77ff" }, // Nebula Purple
      { nav_background: "#0a1a10", text_color: "#c8f7dc", card_background: "#0f2818", card_border: "#163a22", border_accent: "#00ff88" }, // Neon Jungle
      { nav_background: "#1a1200", text_color: "#fff3b0", card_background: "#261b00", card_border: "#3a2a00", border_accent: "#ffd60a" }, // Deep Gold
      { nav_background: "#10101a", text_color: "#e0e0ff", card_background: "#161628", card_border: "#1e1e38", border_accent: "#6666ff" }, // Electric Indigo
      { nav_background: "#0a1a28", text_color: "#b8e4ff", card_background: "#0f2840", card_border: "#153858", border_accent: "#00aaff" }, // Cobalt Depths
      { nav_background: "#1a1018", text_color: "#ffd6ef", card_background: "#281520", card_border: "#3a1c2e", border_accent: "#ff70c8" }, // Neon Rose
      { nav_background: "#0c1810", text_color: "#d4f5c0", card_background: "#122018", card_border: "#192e22", border_accent: "#7dc84a" }, // Dark Verdure
      { nav_background: "#180f0a", text_color: "#ffe8d8", card_background: "#241810", card_border: "#362418", border_accent: "#e87040" }, // Burnt Sienna
      { nav_background: "#0a0e1a", text_color: "#d0d8ff", card_background: "#0e1428", card_border: "#141e3a", border_accent: "#4a7fff" }, // Starfield Blue
      { nav_background: "#141e14", text_color: "#e8f8d0", card_background: "#1c2c1c", card_border: "#263a26", border_accent: "#a0d060" }, // Sage Night
      // ── LIGHT THEMES (30) ─────────────────────────────────────────────────
      { nav_background: "#faf4f4", text_color: "#2a1e1e", card_background: "#f2e6e6", card_border: "#e2cbcb", border_accent: "#b87070" }, // Rose Quartz
      { nav_background: "#f4f6f0", text_color: "#222a1d", card_background: "#e6ebdc", card_border: "#d2d9c8", border_accent: "#6b8e23" }, // Olive Garden
      { nav_background: "#fff5f6", text_color: "#382426", card_background: "#fde2e4", card_border: "#f7c5c8", border_accent: "#ffb5a7" }, // Sakura Breeze
      { nav_background: "#fcf8f2", text_color: "#2d1607", card_background: "#f5ebd9", card_border: "#e8d1b7", border_accent: "#c36a2d" }, // Desert Clay
      { nav_background: "#fbf0d9", text_color: "#433422", card_background: "#f3e1bf", card_border: "#e6ce9c", border_accent: "#8c5623" }, // Sepia Vintage
      { nav_background: "#f0f4ff", text_color: "#1a2052", card_background: "#e4eaff", card_border: "#c8d4ff", border_accent: "#3a5bff" }, // Blueprint
      { nav_background: "#f5fff8", text_color: "#0d2e18", card_background: "#e4f6ea", card_border: "#c5e6d0", border_accent: "#1e8c45" }, // Mint Spring
      { nav_background: "#fffbf0", text_color: "#2e2000", card_background: "#fef3d0", card_border: "#f9e09a", border_accent: "#d4a200" }, // Golden Parchment
      { nav_background: "#fdf6ff", text_color: "#2a1040", card_background: "#f4e8ff", card_border: "#e5c8ff", border_accent: "#9240d4" }, // Lavender Field
      { nav_background: "#f0fbff", text_color: "#062030", card_background: "#ddf4ff", card_border: "#b8e8ff", border_accent: "#0094cc" }, // Ice Blue
      { nav_background: "#fff0f3", text_color: "#350018", card_background: "#ffe0e8", card_border: "#ffc5d4", border_accent: "#e0125e" }, // Cherry Blossom
      { nav_background: "#f8f6f0", text_color: "#2a2210", card_background: "#eee9d8", card_border: "#ddd3bc", border_accent: "#7a6540" }, // Linen Beige
      { nav_background: "#f4f9ff", text_color: "#0a1a30", card_background: "#e4efff", card_border: "#c8dfff", border_accent: "#1a6ec8" }, // Sky Calm
      { nav_background: "#fdfcfb", text_color: "#1e1208", card_background: "#f5ede0", card_border: "#e8d8c0", border_accent: "#a05a2c" }, // Cream Latte
      { nav_background: "#f0fff4", text_color: "#0a2e12", card_background: "#d8f5e2", card_border: "#b0e8c4", border_accent: "#12804a" }, // Forest Mist
      { nav_background: "#fff8f0", text_color: "#2e1a06", card_background: "#ffefd8", card_border: "#ffd8a8", border_accent: "#e05c00" }, // Tangerine
      { nav_background: "#f8f0ff", text_color: "#1e0a38", card_background: "#eedad8", card_border: "#e0c4f8", border_accent: "#7b2ff7" }, // Wisteria
      { nav_background: "#fff9f0", text_color: "#300e00", card_background: "#ffeedd", card_border: "#ffd8b0", border_accent: "#cc6600" }, // Amber Light
      { nav_background: "#f0fef5", text_color: "#0a2818", card_background: "#d8f8e4", card_border: "#b0eccc", border_accent: "#00804a" }, // Spearmint
      { nav_background: "#fef8f0", text_color: "#2a1800", card_background: "#fdebd0", card_border: "#f9d4a8", border_accent: "#d47800" }, // Honey Glow
      { nav_background: "#f2f8ff", text_color: "#081830", card_background: "#ddeeff", card_border: "#bbd8ff", border_accent: "#0055cc" }, // Cornflower
      { nav_background: "#fff5f0", text_color: "#2a0e00", card_background: "#ffe4d8", card_border: "#ffc8b0", border_accent: "#cc3300" }, // Terracotta Light
      { nav_background: "#f6fff0", text_color: "#102010", card_background: "#e4f5d8", card_border: "#c8e8b8", border_accent: "#4a8a20" }, // Lime Orchard
      { nav_background: "#fffaf2", text_color: "#281800", card_background: "#feefd8", card_border: "#fcdcaa", border_accent: "#b06000" }, // Butterscotch
      { nav_background: "#f0f8ff", text_color: "#081428", card_background: "#dceeff", card_border: "#bad8ff", border_accent: "#006ec0" }, // Polar Blue
      { nav_background: "#fdfaf6", text_color: "#1e1410", card_background: "#f4ebe0", card_border: "#e6d4c0", border_accent: "#8c6040" }, // Warm Ivory
      { nav_background: "#f5f0ff", text_color: "#160840", card_background: "#e8dcff", card_border: "#d0bcff", border_accent: "#6030c0" }, // Soft Indigo
      { nav_background: "#f8fffc", text_color: "#081e14", card_background: "#dff8ec", card_border: "#bdecd8", border_accent: "#10a060" }, // Aquamarine
      { nav_background: "#fff0f8", text_color: "#280a20", card_background: "#ffdaf0", card_border: "#ffbce0", border_accent: "#c0306a" }, // Peach Blush
      { nav_background: "#f8faf0", text_color: "#1a2010", card_background: "#e8f0d0", card_border: "#d0deb0", border_accent: "#607830" }, // Artichoke
      { nav_background: "#fff6e0", text_color: "#2e2000", card_background: "#fdedc0", card_border: "#fad898", border_accent: "#c09000" }, // Champagne Gold
    ];

    // ── Build exclusion set: all backgrounds already "known" ─────────────
    // System defaults
    const EXCLUDED_BACKGROUNDS = new Set([
      "#f6f2ea", // system light
      "#181410", // system dark
    ]);

    // User's custom saved presets
    customPresets.forEach(p => {
      if (p.colors?.nav_background) {
        EXCLUDED_BACKGROUNDS.add(p.colors.nav_background.toLowerCase());
      }
    });

    // Current active background (avoid repeating the same look)
    const currentPaper = (config.theme.ui_overrides.nav_background || "#f6f2ea").toLowerCase();
    EXCLUDED_BACKGROUNDS.add(currentPaper);

    const available = RANDOM_PALETTES.filter(
      p => !EXCLUDED_BACKGROUNDS.has(p.nav_background.toLowerCase())
    );

    // Fallback: if everything is excluded somehow, pick from full list excluding only current
    const pool = available.length > 0
      ? available
      : RANDOM_PALETTES.filter(p => p.nav_background.toLowerCase() !== currentPaper);

    const randomPalette = pool[Math.floor(Math.random() * pool.length)] || RANDOM_PALETTES[0];

    const targetColors = {
      nav_background:      randomPalette.nav_background,
      content_background:  randomPalette.nav_background,
      card_background:     randomPalette.card_background,
      card_border:         randomPalette.card_border,
      text_color:          randomPalette.text_color,
      border_accent:       randomPalette.border_accent,
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

      // Copy default themes from workspace if not present
      if (config?.storage?.workspace_path) {
        const workspace = config.storage.workspace_path;
        const defaultThemes = ["red_night.json", "matrix_shit.json"];
        for (const filename of defaultThemes) {
          const targetPath = `${usersDir}${separator}${filename}`;
          const sourcePath = `${workspace}${separator}${filename}`;
          try {
            await invoke("read_text_file", { filePath: targetPath });
          } catch {
            try {
              const content = await invoke<string>("read_text_file", { filePath: sourcePath });
              await invoke("write_text_file", { filePath: targetPath, content });
            } catch (copyErr) {
              console.error("Failed to copy theme file:", filename, copyErr);
            }
          }
        }
      }

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
    } else if (presetName === "system_red_night") {
      targetColors = {
        nav_background: "#1a0d0d",
        content_background: "#1a0d0d",
        card_background: "#261212",
        card_border: "#3d1a1a",
        text_color: "#ffe5e5",
        border_accent: "#ff3d3d",
      };
    } else if (presetName === "system_matrix_shit") {
      targetColors = {
        nav_background: "#0a1a10",
        content_background: "#0a1a10",
        card_background: "#0f2818",
        card_border: "#163a22",
        text_color: "#c8f7dc",
        border_accent: "#00ff88",
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

  // Synchronize dropdown selection with active config overrides
  useEffect(() => {
    if (!config) return;
    const ov = config.theme.ui_overrides || {};
    
    // Check if it matches default light
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

    // Check if it matches default dark
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

    // Check if it matches Red Night
    const isRedNight = 
      ov.nav_background === "#1a0d0d" &&
      ov.text_color === "#ffe5e5" &&
      ov.card_background === "#261212" &&
      ov.card_border === "#3d1a1a" &&
      ov.border_accent === "#ff3d3d";

    if (isRedNight) {
      setSelectedPresetName("system_red_night");
      return;
    }

    // Check if it matches Matrix Shit
    const isMatrixShit = 
      ov.nav_background === "#0a1a10" &&
      ov.text_color === "#c8f7dc" &&
      ov.card_background === "#0f2818" &&
      ov.card_border === "#163a22" &&
      ov.border_accent === "#00ff88";

    if (isMatrixShit) {
      setSelectedPresetName("system_matrix_shit");
      return;
    }

    // Check if it matches any custom preset
    const matched = customPresets.find(p => {
      return (
        ov.nav_background === p.colors.nav_background &&
        ov.text_color === p.colors.text_color &&
        ov.card_background === p.colors.card_background &&
        ov.border_accent === p.colors.border_accent
      );
    });

    if (matched) {
      setSelectedPresetName(matched.name);
    } else {
      setSelectedPresetName("custom_select");
    }
  }, [config, customPresets]);

  // ── Data loading ──────────────────────────────────────────────────────
  const loadAll = async () => {
    try {
      const cfg: AppConfig = await invoke("get_app_config");
      setConfig(cfg);
      applyTheme(cfg.theme.ui_overrides, cfg.theme.font_family_ui);
      setLocalGlowBrightness(parseFloat(cfg.theme.ui_overrides.accent_glow_brightness || "1.0"));
      setLocalUiSmoothness(parseInt(cfg.theme.ui_overrides.ui_edge_smoothness || "4"));
      setLocalNavSmoothness(parseInt(cfg.theme.ui_overrides.navbar_edge_smoothness || "0"));
      await loadCustomPresets(cfg.storage.root_path);

      const models: ModelCard[] = await invoke("query_huggingface_models", { query: "" });
      // Mark models that are already downloaded on disk
      const downloaded: string[] = await invoke("list_downloaded_models");
      const downloadedSet = new Set(downloaded);
      setHfModels(models.map(m => ({ ...m, is_downloaded: downloadedSet.has(m.filename) })));

      const whisp: WhisperModelInfo[] = await invoke("list_whisper_models");
      setWhisperModels(whisp);

      const loaded: string | null = await invoke("get_loaded_model");
      setLoadedModelName(loaded);

      // Auto-load the saved default LLM if nothing is currently in VRAM
      if (!loaded && cfg.models.default_llm) {
        const isOnDisk = downloadedSet.has(cfg.models.default_llm);
        if (isOnDisk) {
          // Fire-and-forget: load in background, don't block the UI
          loadModel(cfg.models.default_llm, undefined).catch(() => {});
        }
      }

      const gpus: GpuDevice[] = await invoke("detect_gpu_devices");
      setGpuDevices(gpus);

      // init_gpu_from_config restores saved GPU layers+backend into runtime state
      const [layers, backend]: [number, string] = await invoke("init_gpu_from_config");
      setGpuLayers(layers);
      setGpuBackend(backend);
    } catch (e) { console.error(e); }
  };

  // Check whether whisper-cli.exe already exists — instant, no network
  const checkWhisperEngine = async () => {
    const exists: boolean = await invoke("check_whisper_binary");
    setWhisperEngineStatus(exists ? "ready" : "unknown");
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

    // Dynamic light rule (soft dividers) and text-muted based on hex colors
    const lightRuleColor = ruleColor.startsWith("#") && ruleColor.length === 7
      ? `${ruleColor}3a` // ~23% opacity
      : ruleColor;
    r.style.setProperty("--theme-light-rule", lightRuleColor);

    const mutedColor = inkColor.startsWith("#") && inkColor.length === 7
      ? `${inkColor}90` // ~56% opacity
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

    const progUnsub = listen("download_progress", (e: any) => {
      const [name, percent] = e.payload;
      setHfModels(prev => prev.map(m => m.name === name ? { ...m, download_progress: percent } : m));
    });

    const doneUnsub = listen("download_complete", async (e: any) => {
      const name = e.payload as string;
      // Mark is_downloaded and clear progress
      setHfModels(prev => prev.map(m => m.name === name
        ? { ...m, is_downloaded: true, download_progress: 0 }
        : m
      ));
      // Re-sync the full downloaded list from disk
      const downloaded: string[] = await invoke("list_downloaded_models");
      const set = new Set(downloaded);
      setHfModels(prev => prev.map(m => ({ ...m, is_downloaded: set.has(m.filename) })));
    });

    const errUnsub = listen("download_error", (e: any) => {
      const [, msg] = e.payload as [string, string];
      setDownloadError(msg);
      // Auto-clear after 8 seconds
      setTimeout(() => setDownloadError(null), 8000);
      // Reset progress on the affected model
      const [name] = e.payload as [string, string];
      setHfModels(prev => prev.map(m => m.name === name ? { ...m, download_progress: 0 } : m));
    });

    // Whisper download events
    const wProgUnsub = listen("whisper_download_progress", (e: any) => {
      const [name, pct] = e.payload as [string, number];
      setWhisperProgress(prev => ({ ...prev, [name]: pct }));
    });
    const wDoneUnsub = listen("whisper_download_complete", async (e: any) => {
      const name = e.payload as string;
      setWhisperProgress(prev => { const n = { ...prev }; delete n[name]; return n; });
      // Re-read list from disk to mark is_downloaded
      const fresh: WhisperModelInfo[] = await invoke("list_whisper_models");
      setWhisperModels(fresh);
    });
    const wErrUnsub = listen("whisper_download_error", (e: any) => {
      const [name, msg] = e.payload as [string, string];
      setWhisperError(msg);
      setTimeout(() => setWhisperError(null), 8000);
      setWhisperProgress(prev => { const n = { ...prev }; delete n[name]; return n; });
    });

    // React to whisper engine download events from backend
    const engineUnsub = listen("whisper_engine_status", (e: any) => {
      const status = e.payload as string;
      if (status === "ready") setWhisperEngineStatus("ready");
      else if (status === "downloading") setWhisperEngineStatus("downloading");
      else setWhisperEngineStatus("unknown");
    });

    // Check binary existence on mount (sync, no network)
    invoke("check_whisper_binary").then((exists) => {
      setWhisperEngineStatus(exists ? "ready" : "unknown");
    }).catch(() => {});

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
      progUnsub.then(fn => fn());
      doneUnsub.then(fn => fn());
      errUnsub.then(fn => fn());
      wProgUnsub.then(fn => fn());
      wDoneUnsub.then(fn => fn());
      wErrUnsub.then(fn => fn());
      engineUnsub.then(fn => fn());
      configUnsub.then(fn => fn());
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (colorDebounceRef.current) {
        clearTimeout(colorDebounceRef.current);
      }
    };
  }, []);

  // Live GPU poll every 8 seconds
  useEffect(() => {
    const poll = setInterval(async () => {
      const fresh: GpuDevice[] = await invoke("refresh_gpu_status");
      setGpuDevices(fresh);
    }, 8000);
    return () => clearInterval(poll);
  }, []);

  // ── Config helpers ────────────────────────────────────────────────────
  const saveConfig = async (next: AppConfig) => {
    setConfig(next);
    await invoke("save_app_config", { config: next });
    applyTheme(next.theme.ui_overrides, next.theme.font_family_ui);
    // Notify all listeners (Explorer, App.tsx) that config has changed
    await emit("config_updated", null);
  };

  const patchOverride = async (key: string, val: string) => {
    if (!config) return;
    const overrides = { ...config.theme.ui_overrides, [key]: val };
    const next = { ...config, theme: { ...config.theme, ui_overrides: overrides } };
    
    // 1. Instantly update React state and inject CSS variables into DOM for silky 60+ FPS dragging
    setConfig(next);
    applyTheme(overrides, config.theme.font_family_ui);

    // 2. Debounce expensive file-system disk write operations and global Tauri event listeners
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      await invoke("save_app_config", { config: next });
      await emit("config_updated", next);
    }, 200); // 200ms debounce window
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
    }, 120); // 120ms debounce
  };

  const resetTheme = async () => {
    if (!config) return;
    const next = { ...config, theme: DEFAULT_THEME };
    await saveConfig(next);
    await emit("nav_layout_changed", DEFAULT_THEME.nav_layout);
  };

  // ── GPU helpers ───────────────────────────────────────────────────────
  const saveGpuConfig = async (layers: number, backend: string) => {
    setGpuLayers(layers);
    setGpuBackend(backend);
    await invoke("set_model_gpu_config", { gpuLayers: layers, gpuBackend: backend });
  };

  // ── Model actions ─────────────────────────────────────────────────────
  const downloadModel = async (model: ModelCard) => {
    setHfModels(prev => prev.map(m => m.name === model.name ? { ...m, download_progress: 1 } : m));
    await invoke("start_model_download", {
      modelName: model.name,
      repoId: model.repo_id,
      filename: model.filename,
    });
  };

  const cancelDownload = async (name: string) => {
    await invoke("cancel_model_download", { modelName: name });
    setHfModels(prev => prev.map(m => m.name === name ? { ...m, download_progress: 0 } : m));
  };

  const loadModel = async (name: string, sizeGb?: number) => {
    setLoadedModelName(name + " [Loading…]");
    setVramHint("Analysing VRAM…");
    try {
      // Auto-configure GPU layers based on VRAM availability
      const rec: any = await invoke("get_vram_recommendation", { modelSizeGb: sizeGb ?? 4.0 });
      const layers: number = rec.recommended_layers;
      const backend: string = rec.backend;
      await saveGpuConfig(layers, backend);
      const hint = rec.fits_fully
        ? `✓ Full GPU (${backend.toUpperCase()})`
        : layers > 0
          ? `⚡ Partial GPU — ${layers} layers`
          : `⚠ CPU-only (insufficient VRAM)`;
      setVramHint(hint);
    } catch {
      setVramHint("");
    }
    await invoke("load_active_model", { modelName: name });
    setLoadedModelName(name);
  };

  const unloadModel = async () => {
    await invoke("unload_active_model");
    setLoadedModelName(null);
    setVramHint("");
    // Clear the persisted default so it doesn't auto-reload next launch
    if (config) saveConfig({ ...config, models: { ...config.models, default_llm: "" } });
  };

  // ── Right-click on model card ──────────────────────────────────────────
  const handleModelRightClick = (e: React.MouseEvent, model: ModelCard) => {
    showContextMenu(e, [
      {
        label: model.is_downloaded ? "Load Model into VRAM" : "Download Model",
        icon: model.is_downloaded ? <Cpu size={13} /> : <Download size={13} />,
        onClick: () => model.is_downloaded
          ? loadModel(model.name, model.size_gb).then(() =>
              saveConfig({ ...config!, models: { ...config!.models, default_llm: model.name } })
            )
          : downloadModel(model),
      },
      {
        label: "Cancel Download",
        disabled: model.download_progress === 0,
        onClick: () => cancelDownload(model.name),
      },
      { label: "", isSeparator: true },
      {
        label: "Copy model name",
        onClick: () => navigator.clipboard.writeText(model.name),
      },
      {
        label: "View on HuggingFace",
        onClick: () => invoke("tauri_plugin_opener::open_url", { url: `https://huggingface.co/${model.author}/${model.name.replace(".gguf", "")}` }),
      },
    ]);
  };

  const handleBlankRightClick = (e: React.MouseEvent) => {
    showContextMenu(e, [
      { label: "Reset Theme Settings", onClick: resetTheme },
      { label: "", isSeparator: true },
      { label: "Refresh Configuration", onClick: loadAll }
    ]);
  };

  const familyTabs = ["all", ...Object.keys(FAMILY_BADGE)];
  const visibleModels = hfModels.filter(m => {
    const familyOk = filteredFamily === "all" || m.family === filteredFamily;
    const queryOk = !hfSearchQuery || m.name.toLowerCase().includes(hfSearchQuery.toLowerCase()) || m.family.toLowerCase().includes(hfSearchQuery.toLowerCase());
    return familyOk && queryOk;
  });

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
            <span className="kicker">System Control Dashboard</span>
            <h1 className="font-serif-display text-3xl font-black italic tracking-tight mt-1 text-ink">Settings</h1>
          </div>
          <button onClick={resetTheme} className="p-2 border border-rule hover:bg-cream/45 rounded-sm text-muted flex items-center gap-1.5 font-bold uppercase text-[9px]" title="Reset theme settings back to default">
            <RefreshCw size={12} /> Reset Theme
          </button>
        </div>

        <div className="grid grid-cols-2 gap-8">
          {/* ── LEFT COLUMN ──────────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Card: General & Storage */}
            <div className="p-5 border border-rule bg-cream/15 rounded-sm space-y-4">
              <span className="kicker flex items-center gap-1.5"><Sliders size={12} /> General & Storage</span>
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
                    className="px-3 py-1 border border-rule/50 bg-cream hover:bg-ink hover:text-paper hover:border-ink rounded-sm text-[10px] font-bold uppercase transition-all whitespace-nowrap"
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
                    className="px-3 py-1 border border-rule/50 bg-cream hover:bg-ink hover:text-paper hover:border-ink rounded-sm text-[10px] font-bold uppercase transition-all whitespace-nowrap"
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
                    <option value="Chat">Chat</option>
                    <option value="Scheduler">Scheduler</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5 relative">
                  <label className="font-bold text-[10px] uppercase text-muted">Nav Layout</label>
                  <button
                    onClick={() => setLayoutDropdownOpen(!layoutDropdownOpen)}
                    className="p-2 border border-rule/50 rounded-sm bg-paper text-ink outline-none cursor-pointer flex items-center justify-between font-semibold text-left select-none text-xs h-[40px] w-full"
                  >
                    <span>
                      {config.theme.nav_layout === "sidebar" && "Left Sidebar"}
                      {config.theme.nav_layout === "right_sidebar" && "Right Sidebar"}
                      {config.theme.nav_layout === "vertical_pills" && (
                        <span className="flex items-center gap-2">
                          <span 
                            className="font-serif-display font-black text-accent italic animate-pulse mr-1" 
                            style={{ 
                              textShadow: "0 0 10px var(--theme-accent), 0 0 20px var(--theme-accent)", 
                              filter: "drop-shadow(0 0 5px var(--theme-accent))" 
                            }}
                          >
                            L
                          </span>
                          Vertical Pill
                        </span>
                      )}
                      {config.theme.nav_layout === "right_vertical_pills" && (
                        <span className="flex items-center gap-2">
                          <span 
                            className="font-serif-display font-black text-accent italic animate-pulse mr-1" 
                            style={{ 
                              textShadow: "0 0 10px var(--theme-accent), 0 0 20px var(--theme-accent)", 
                              filter: "drop-shadow(0 0 5px var(--theme-accent))" 
                            }}
                          >
                            R
                          </span>
                          Vertical Pill
                        </span>
                      )}
                      {config.theme.nav_layout === "top_navbar" && "Top Navbar"}
                      {config.theme.nav_layout === "bottom_navbar" && "Bottom Navbar"}
                    </span>
                    <ChevronDown size={14} className="text-muted" />
                  </button>

                  {layoutDropdownOpen && (
                    <>
                      {/* Backdrop for closing popover */}
                      <div 
                        className="fixed inset-0 z-40 cursor-default" 
                        onClick={() => setLayoutDropdownOpen(false)} 
                      />
                      {/* Dropdown panel */}
                      <div className="absolute top-full left-0 w-full mt-1.5 p-1 bg-paper border-2 border-rule shadow-2xl rounded-sm flex flex-col gap-0.5 select-none z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                        {[
                          { value: "sidebar", label: "Left Sidebar" },
                          { value: "right_sidebar", label: "Right Sidebar" },
                          { value: "vertical_pills", label: "L Vertical Pill", letter: "L" },
                          { value: "right_vertical_pills", label: "R Vertical Pill", letter: "R" },
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
                            <span className="flex items-center gap-1.5">
                              {opt.letter ? (
                                <span className={`flex items-center gap-2 font-bold ${config.theme.nav_layout === opt.value ? "text-paper" : "text-ink"}`}>
                                  <span 
                                    className={`font-serif-display font-black italic animate-pulse mr-1 ${config.theme.nav_layout === opt.value ? "text-paper" : "text-accent"}`}
                                    style={{ 
                                      textShadow: config.theme.nav_layout === opt.value 
                                        ? "0 0 10px rgba(255,255,255,0.8), 0 0 20px rgba(255,255,255,0.6)" 
                                        : "0 0 10px var(--theme-accent), 0 0 20px var(--theme-accent)", 
                                      filter: config.theme.nav_layout === opt.value 
                                        ? "drop-shadow(0 0 5px rgba(255,255,255,0.5))" 
                                        : "drop-shadow(0 0 5px var(--theme-accent))" 
                                    }}
                                  >
                                    {opt.letter}
                                  </span>
                                  Vertical Pill
                                </span>
                              ) : (
                                opt.label
                              )}
                            </span>
                            {config.theme.nav_layout === opt.value && <span className="text-[10px]">✓</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-4 border-t border-rule/30">
                {/* Overall UI Edge Smoothness */}
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

                {/* Navbar Edge Smoothness */}
                {(config.theme.nav_layout === "top_navbar" || config.theme.nav_layout === "bottom_navbar" || config.theme.nav_layout === "vertical_pills" || config.theme.nav_layout === "right_vertical_pills") && (
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
                )}

                  {/* Icon Only Toggle (Top & Bottom Navbar exclusive) */}
                  {(config.theme.nav_layout === "top_navbar" || config.theme.nav_layout === "bottom_navbar") && (
                    <div className="flex items-center justify-between pt-3 border-t border-light-rule mt-1">
                      <div>
                        <span className="font-bold text-[10px] uppercase text-muted block">Navbar Navigation Style</span>
                        <span className="text-muted text-[9px] mt-0.5 block leading-tight">Hide text labels to display a minimal icon-only tab bar</span>
                      </div>
                      <button 
                        onClick={() => {
                          const current = config.theme.ui_overrides.nav_icon_only === "true";
                          patchOverride("nav_icon_only", current ? "false" : "true");
                        }}
                        className={`px-3 py-1 border font-bold text-[9px] uppercase rounded-sm transition-all duration-200 cursor-pointer ${
                          config.theme.ui_overrides.nav_icon_only === "true"
                            ? "bg-accent border-accent text-paper" 
                            : "border-rule bg-paper text-muted hover:text-ink"
                        }`}
                      >
                        {config.theme.ui_overrides.nav_icon_only === "true" ? "Icon Only" : "Icon + Text"}
                      </button>
                    </div>
                  )}
                </div>
            </div>

            {/* Card: Active Models */}
            <div className="p-5 border border-rule bg-cream/15 rounded-sm space-y-4 hover-lift">
              <span className="kicker flex items-center gap-1.5"><Cpu size={12} /> Active Models</span>

              {/* AI / LLM selector */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-[10px] uppercase text-muted">AI Language Model (GGUF)</label>
                  {loadedModelName && !loadedModelName.includes("[") && (
                    <span className="text-[8.5px] font-mono text-accent border border-accent/30 px-1.5 py-0.5 rounded-sm">
                      {loadedModelName.length > 28 ? loadedModelName.slice(0, 26) + "…" : loadedModelName}
                    </span>
                  )}
                </div>
                {hfModels.filter(m => m.is_downloaded).length === 0 ? (
                  <div className="p-2 border border-rule/40 rounded-sm bg-paper text-muted text-[10.5px] italic">
                    No GGUF models downloaded yet — use the Model Hub below.
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <select
                      value={loadedModelName && !loadedModelName.includes("[") ? loadedModelName : ""}
                      onChange={async e => {
                        const name = e.target.value;
                        if (!name) return;
                        const model = hfModels.find(m => m.name === name);
                        await loadModel(name, model?.size_gb);
                        saveConfig({ ...config, models: { ...config.models, default_llm: name } });
                      }}
                      className="flex-1 p-2 border border-rule/50 rounded-sm bg-paper outline-none cursor-pointer focus:border-accent font-mono text-[10.5px]"
                    >
                      <option value="">— Select a model —</option>
                      {hfModels.filter(m => m.is_downloaded).map(m => (
                        <option key={m.name} value={m.name}>{m.name}</option>
                      ))}
                    </select>
                    {loadedModelName && !loadedModelName.includes("[") && (
                      <button
                        onClick={unloadModel}
                        className="px-2.5 py-1 border border-red-600/50 hover:bg-red-600 hover:text-paper text-red-600 font-bold uppercase text-[9px] rounded-sm transition-all whitespace-nowrap"
                      >
                        Unload
                      </button>
                    )}
                  </div>
                )}
                {vramHint && (
                  <p className={`text-[9.5px] font-mono font-semibold mt-0.5 ${
                    vramHint.startsWith("✓") ? "text-green-700" :
                    vramHint.startsWith("⚡") ? "text-accent" : "text-muted"
                  }`}>{vramHint}</p>
                )}
              </div>

              {/* Whisper selector */}
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-[10px] uppercase text-muted">Whisper STT Model</label>
                {(() => {
                  const downloaded = whisperModels.filter(m => m.is_downloaded);
                  if (downloaded.length === 0) {
                    return (
                      <div className="p-2 border border-rule/40 rounded-sm bg-paper text-muted text-[10.5px] italic">
                        No Whisper models downloaded yet — use the Whisper section below.
                      </div>
                    );
                  }
                  // If the saved active model isn't downloaded, fall back to first downloaded
                  const activeIsAvailable = downloaded.some(m => m.name === config.voice.active_whisper_model);
                  const effectiveValue = activeIsAvailable
                    ? config.voice.active_whisper_model
                    : downloaded[0].name;
                  // Persist the correction silently
                  if (!activeIsAvailable && effectiveValue !== config.voice.active_whisper_model) {
                    setTimeout(() => saveConfig({ ...config, voice: { ...config.voice, active_whisper_model: effectiveValue } }), 0);
                  }
                  return (
                    <select
                      value={effectiveValue}
                      onChange={e => {
                        const name = e.target.value;
                        saveConfig({ ...config, voice: { ...config.voice, active_whisper_model: name } });
                      }}
                      className="p-2 border border-rule/50 rounded-sm bg-paper outline-none cursor-pointer focus:border-accent font-mono text-[10.5px]"
                    >
                      {downloaded.map(m => {
                        const mode = whisperRunMode[m.name];
                        const sizeLabel = m.size_mb >= 1000 ? `${(m.size_mb / 1000).toFixed(1)} GB` : `${m.size_mb} MB`;
                        return (
                          <option key={m.name} value={m.name}>
                            whisper-{m.name}{mode ? ` [${mode.toUpperCase()}]` : ""} — {sizeLabel}
                          </option>
                        );
                      })}
                    </select>
                  );
                })()}
              </div>
            </div>

            {/* Card: Theme Overrides */}
            <div className={`p-5 border border-rule bg-cream/15 rounded-sm space-y-4 hover-lift relative ${
              activeColorKey ? "z-30" : "z-10"
            }`}>
              <span className="kicker flex items-center gap-1.5"><Sliders size={12} /> Visual Palette Overrides</span>
              <p className="text-muted text-[11px] leading-relaxed">Colors update instantly in the root CSS variables. Click on any color preview box to open the color change panel.</p>

              {/* Theme Presets Dropdown & Save Button */}
              {/* Theme Presets Dropdown & Save Button */}
              {config && (() => {
                const activePreset = 
                  selectedPresetName === "system_default_light"
                    ? { name: "Default Light", colors: { nav_background: "#f6f2ea", card_background: "#ede8dc", text_color: "#18140f", border_accent: "#b8440c", card_border: "#c9bfab" } }
                    : selectedPresetName === "system_default_dark"
                    ? { name: "Default Dark", colors: { nav_background: "#181410", card_background: "#221e1a", text_color: "#ffffff", border_accent: "#b8440c", card_border: "#3c352a" } }
                    : selectedPresetName === "system_red_night"
                    ? { name: "Red Night", colors: { nav_background: "#1a0d0d", card_background: "#261212", text_color: "#ffe5e5", border_accent: "#ff3d3d", card_border: "#3d1a1a" } }
                    : selectedPresetName === "system_matrix_shit"
                    ? { name: "Matrix Shit", colors: { nav_background: "#0a1a10", card_background: "#0f2818", text_color: "#c8f7dc", border_accent: "#00ff88", card_border: "#163a22" } }
                    : customPresets.find(p => p.name === selectedPresetName);

                const getGradient = (paper: string, card: string, accent: string) => {
                  return `linear-gradient(135deg, ${paper} 0%, ${card} 50%, ${accent} 100%)`;
                };

                const triggerBg = activePreset
                  ? getGradient(activePreset.colors.nav_background, activePreset.colors.card_background, activePreset.colors.border_accent || "#b8440c")
                  : getGradient(config.theme.ui_overrides.nav_background || "#f6f2ea", config.theme.ui_overrides.card_background || "#ede8dc", config.theme.ui_overrides.border_accent || "#b8440c");

                const triggerColor = activePreset
                  ? activePreset.colors.text_color
                  : (config.theme.ui_overrides.text_color || "#18140f");

                const triggerBorder = activePreset
                  ? (activePreset.colors.border_accent || "#b8440c")
                  : (config.theme.ui_overrides.border_accent || "#b8440c");

                return (
                  <div className="flex items-center gap-3 bg-paper/50 p-2.5 rounded-sm border border-rule/35">
                    <div className="flex-1 flex flex-col gap-1 relative">
                      <span className="font-bold text-[9px] uppercase tracking-wider text-muted">Theme Presets</span>
                      
                      {/* Custom Dropdown Trigger */}
                      <button
                        type="button"
                        onClick={() => setPresetsDropdownOpen(!presetsDropdownOpen)}
                        className="w-full p-1.5 border rounded-sm text-left flex items-center justify-between font-sans-meta text-[11px] font-semibold transition-all relative overflow-hidden h-[31px] active:scale-98 gradient-breath"
                        style={{
                          background: triggerBg,
                          color: triggerColor,
                          borderColor: triggerBorder,
                        }}
                      >
                        <span className="truncate pr-4 z-10">
                          {activePreset ? activePreset.name : "Select a theme preset..."}
                        </span>
                        <ChevronDown size={11} className="shrink-0 text-muted z-10" />
                      </button>

                      {/* Dropdown Options list */}
                      {presetsDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setPresetsDropdownOpen(false)} />
                          <div className="absolute top-[48px] left-0 right-0 max-h-60 overflow-y-auto z-50 bg-paper border border-rule/50 rounded-sm shadow-xl p-1 space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
                            
                            {/* Option: Default Light */}
                            <button
                              type="button"
                              onClick={() => {
                                handleSelectPreset("system_default_light");
                                setPresetsDropdownOpen(false);
                              }}
                              className="w-full p-2 text-left rounded-sm text-[11px] font-semibold border flex items-center justify-between transition-all hover:brightness-95 active:scale-99 gradient-breath"
                              style={{
                                background: getGradient("#f6f2ea", "#ede8dc", "#b8440c"),
                                color: "#18140f",
                                borderColor: "#b8440c",
                              }}
                            >
                              <span className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full border border-rule/20" style={{ backgroundColor: "#b8440c" }} />
                                Default Light
                              </span>
                              {selectedPresetName === "system_default_light" && (
                                <span 
                                  className="text-[8px] px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider z-10"
                                  style={{ backgroundColor: "#18140f", color: "#f6f2ea" }}
                                >
                                  Active
                                </span>
                              )}
                            </button>

                            {/* Option: Default Dark */}
                            <button
                              type="button"
                              onClick={() => {
                                handleSelectPreset("system_default_dark");
                                setPresetsDropdownOpen(false);
                              }}
                              className="w-full p-2 text-left rounded-sm text-[11px] font-semibold border flex items-center justify-between transition-all hover:brightness-110 active:scale-99 gradient-breath"
                              style={{
                                background: getGradient("#181410", "#221e1a", "#b8440c"),
                                color: "#ffffff",
                                borderColor: "#b8440c",
                              }}
                            >
                              <span className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full border border-rule/20" style={{ backgroundColor: "#b8440c" }} />
                                Default Dark
                              </span>
                              {selectedPresetName === "system_default_dark" && (
                                <span 
                                  className="text-[8px] px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider z-10"
                                  style={{ backgroundColor: "#ffffff", color: "#181410" }}
                                >
                                  Active
                                </span>
                              )}
                            </button>

                            {/* Option: Red Night */}
                            <button
                              type="button"
                              onClick={() => {
                                handleSelectPreset("system_red_night");
                                setPresetsDropdownOpen(false);
                              }}
                              className="w-full p-2 text-left rounded-sm text-[11px] font-semibold border flex items-center justify-between transition-all hover:brightness-110 active:scale-99 gradient-breath"
                              style={{
                                background: getGradient("#1a0d0d", "#261212", "#ff3d3d"),
                                color: "#ffe5e5",
                                borderColor: "#ff3d3d",
                              }}
                            >
                              <span className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full border border-rule/20" style={{ backgroundColor: "#ff3d3d" }} />
                                Red Night
                              </span>
                              {selectedPresetName === "system_red_night" && (
                                <span 
                                  className="text-[8px] px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider z-10"
                                  style={{ backgroundColor: "#ffe5e5", color: "#1a0d0d" }}
                                >
                                  Active
                                </span>
                              )}
                            </button>

                            {/* Option: Matrix Shit */}
                            <button
                              type="button"
                              onClick={() => {
                                handleSelectPreset("system_matrix_shit");
                                setPresetsDropdownOpen(false);
                              }}
                              className="w-full p-2 text-left rounded-sm text-[11px] font-semibold border flex items-center justify-between transition-all hover:brightness-110 active:scale-99 gradient-breath"
                              style={{
                                background: getGradient("#0a1a10", "#0f2818", "#00ff88"),
                                color: "#c8f7dc",
                                borderColor: "#00ff88",
                              }}
                            >
                              <span className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full border border-rule/20" style={{ backgroundColor: "#00ff88" }} />
                                Matrix Shit
                              </span>
                              {selectedPresetName === "system_matrix_shit" && (
                                <span 
                                  className="text-[8px] px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider z-10"
                                  style={{ backgroundColor: "#c8f7dc", color: "#0a1a10" }}
                                >
                                  Active
                                </span>
                              )}
                            </button>

                            {/* Custom Presets Section */}
                            {customPresets.length > 0 && (
                              <>
                                <div className="border-t border-rule/35 my-1" />
                                {customPresets.map(p => {
                                  const paper = p.colors?.nav_background || "#f6f2ea";
                                  const card = p.colors?.card_background || "#ede8dc";
                                  const text = p.colors?.text_color || "#18140f";
                                  const accent = p.colors?.border_accent || "#b8440c";
                                  return (
                                    <button
                                      key={p.name}
                                      type="button"
                                      onClick={() => {
                                        handleSelectPreset(p.name);
                                        setPresetsDropdownOpen(false);
                                      }}
                                      className="w-full p-2 text-left rounded-sm text-[11px] font-semibold border flex items-center justify-between transition-all hover:brightness-95 hover:contrast-105 active:scale-99 gradient-breath"
                                      style={{
                                        background: getGradient(paper, card, accent),
                                        color: text,
                                        borderColor: accent,
                                      }}
                                    >
                                      <span className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full border border-rule/20" style={{ backgroundColor: accent }} />
                                        {p.name}
                                      </span>
                                      {selectedPresetName === p.name && (
                                        <span 
                                          className="text-[8px] px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider z-10"
                                          style={{ backgroundColor: text, color: paper }}
                                        >
                                          Active
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    {/* Randomize Button */}
                    <button
                      onClick={handleRandomizeTheme}
                      className="p-2 bg-cream/35 hover:bg-cream/70 text-ink border border-rule/50 hover:border-accent rounded-sm cursor-pointer transition-all duration-200 self-end h-[31px] w-[31px] flex items-center justify-center group active:scale-90"
                      title="Randomize Theme"
                    >
                      <Dices 
                        size={14} 
                        style={{ transform: `rotate(${rollDegrees}deg)` }}
                        className="transition-transform duration-500 ease-out group-hover:rotate-45 text-muted group-hover:text-accent"
                      />
                    </button>
                    <button
                      onClick={() => {
                        setNewThemeName("");
                        setSaveError("");
                        setShowSaveModal(true);
                      }}
                      className="px-3 py-1.5 bg-accent hover:bg-accent/90 text-paper font-bold text-[10px] uppercase rounded-sm whitespace-nowrap cursor-pointer transition-all duration-200 self-end h-[31px] flex items-center justify-center gap-1 active-accent-glow"
                    >
                      <Save size={11} /> Save Theme
                    </button>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "nav_background", label: "Paper Base" },
                  { key: "text_color",     label: "Ink Text" },
                  { key: "card_background",label: "Cream Card" },
                  { key: "border_accent",  label: "Terracotta Accent" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-1.5 relative">
                    <label className="font-bold text-[10px] uppercase text-muted">{label}</label>
                    <div className="flex items-center gap-1.5">
                      <div 
                        onClick={() => setActiveColorKey(activeColorKey === key ? null : key)}
                        className={`w-6 h-6 rounded-sm border cursor-pointer shrink-0 transition-all hover:scale-105 active:scale-95 ${
                          activeColorKey === key ? "border-accent ring-2 ring-accent/30" : "border-rule/50"
                        }`}
                        style={{ 
                          background: key === "nav_background" ? "var(--theme-paper)" 
                                    : key === "text_color" ? "var(--theme-ink)" 
                                    : key === "card_background" ? "var(--theme-cream)" 
                                    : "var(--theme-accent)"
                        }} 
                      />
                      <AnimatedHexInput
                        value={config.theme.ui_overrides[key] || ""}
                        onChange={val => patchOverride(key, val)}
                        className="flex-1 p-1.5 border border-rule/50 rounded-sm bg-paper outline-none text-[11px] font-mono focus:border-accent" />
                    </div>
                    {/* The Color Change Panel Popover */}
                    {activeColorKey === key && (
                      <>
                        {/* Backdrop for closing popover */}
                        <div 
                          className="fixed inset-0 z-40 cursor-default" 
                          onClick={() => setActiveColorKey(null)} 
                        />
                        {/* Popover panel */}
                        <div className="absolute top-full left-0 mt-2 p-3 bg-paper border-2 border-rule shadow-2xl rounded-sm w-48 flex flex-col gap-2 font-sans-meta select-none z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[9px] uppercase tracking-wider text-muted">Presets</span>
                            <button 
                              onClick={() => setActiveColorKey(null)} 
                              className="text-muted hover:text-ink font-bold text-xs"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {PRESETS[key].map(color => (
                              <button
                                key={color}
                                onClick={() => patchOverride(key, color)}
                                className={`w-full h-5 rounded-sm border transition-all hover:scale-105 active:scale-95 ${
                                  (config.theme.ui_overrides[key] || "").toLowerCase() === color.toLowerCase()
                                    ? "border-accent ring-1 ring-accent/35 scale-105"
                                    : "border-rule/50 hover:border-rule"
                                  }`}
                                style={{ background: color }}
                                title={color}
                              />
                            ))}
                          </div>
                          <div className="flex items-center justify-between border-t border-light-rule pt-2 mt-1">
                            <span className="text-[9px] font-bold text-muted uppercase">Custom Color</span>
                            <div className="relative w-8 h-5 border border-rule/50 rounded-sm overflow-hidden cursor-pointer shrink-0">
                              <input 
                                type="color" 
                                value={config.theme.ui_overrides[key] || "#f6f2ea"} 
                                onChange={e => {
                                  const val = e.target.value;
                                  // Throttle heavy browser CSS/layout repaints to at most once every 60ms for fluid dragging
                                  const now = Date.now();
                                  if (now - colorThrottleRef.current > 60) {
                                    colorThrottleRef.current = now;
                                    const overrides = { ...config.theme.ui_overrides, [key]: val };
                                    applyTheme(overrides, config.theme.font_family_ui);
                                  }
                                  patchOverrideDebounced(key, val);
                                }}
                                className="absolute -inset-1 w-12 h-12 p-0 border-0 cursor-pointer"
                              />
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Font Family Selector and Changer Dropdown */}
              <div className="flex flex-col gap-1.5 pt-4 border-t border-rule/30 mt-3.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-[10px] uppercase text-muted">Application Typography Profile</label>
                  {(config?.theme?.font_family_ui || "editorial") !== "editorial" && (
                    <button
                      onClick={async () => {
                        const next = { ...config, theme: { ...config.theme, font_family_ui: "editorial" } };
                        await saveConfig(next as AppConfig);
                      }}
                      className="px-2 py-0.5 border border-rule/50 bg-paper hover:bg-cream hover:text-ink text-[9px] uppercase font-bold rounded-sm whitespace-nowrap cursor-pointer transition-all duration-200"
                    >
                      Reset Font
                    </button>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <select
                    value={config?.theme?.font_family_ui || "editorial"}
                    onChange={async (e) => {
                      const next = { ...config, theme: { ...config.theme, font_family_ui: e.target.value } };
                      await saveConfig(next as AppConfig);
                    }}
                    className="flex-1 p-2 border border-rule/50 rounded-sm bg-paper outline-none cursor-pointer focus:border-accent font-sans-meta text-[11px] font-semibold"
                  >
                    {FONT_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label} — {preset.desc.replace(/Unified\s|Elegant\s|Terminal\s|Friendly\s/g, '')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dynamic Accent Glow Toggle */}
              <div className="flex flex-col gap-3.5 pt-4 border-t border-rule/30 mt-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-bold text-[10px] uppercase tracking-wide">Dynamic Accent Glow</span>
                    <span className="text-[9px] text-muted font-sans-meta">Add neon atmosphere illumination to interactive details</span>
                  </div>
                  <button
                    onClick={async () => {
                      const nextGlow = config?.theme?.ui_overrides?.accent_glow === "true" ? "false" : "true";
                      await patchOverride("accent_glow", nextGlow);
                    }}
                    className={`px-3 py-1 border font-bold text-[9px] uppercase rounded-sm cursor-pointer transition-all duration-200 ${
                      config?.theme?.ui_overrides?.accent_glow === "true"
                        ? "bg-accent border-accent text-paper font-extrabold active-accent-glow"
                        : "border-rule text-muted hover:border-rule/80 hover:text-ink"
                    }`}
                  >
                    {config?.theme?.ui_overrides?.accent_glow === "true" ? "Glow ON" : "Glow OFF"}
                  </button>
                </div>

                {config?.theme?.ui_overrides?.accent_glow === "true" && (
                  <div className="flex flex-col gap-1.5 pl-2 border-l-2 border-accent/30 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="flex justify-between font-bold text-[9px] uppercase text-muted">
                      <span>Glow Brightness</span>
                      <span className="text-accent font-mono font-bold">
                        {Math.round(localGlowBrightness * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input 
                        type="range" 
                        min="0.2" 
                        max="2.5" 
                        step="0.1" 
                        value={localGlowBrightness}
                        onChange={e => {
                          const val = parseFloat(e.target.value);
                          setLocalGlowBrightness(val);
                          handleSliderDrag("accent_glow_brightness", e.target.value);
                        }}
                        className="flex-1 accent-accent cursor-pointer mt-1" 
                      />
                      <button 
                        onClick={() => {
                          setLocalGlowBrightness(0.5);
                          handleSliderDrag("accent_glow_brightness", "0.5");
                        }}
                        className="px-2 py-0.5 border border-rule/50 bg-paper hover:bg-cream hover:text-ink text-[9px] uppercase font-bold rounded-sm whitespace-nowrap cursor-pointer"
                      >
                        Dim
                      </button>
                      <button 
                        onClick={() => {
                          setLocalGlowBrightness(2.0);
                          handleSliderDrag("accent_glow_brightness", "2.0");
                        }}
                        className="px-2 py-0.5 border border-rule/50 bg-paper hover:bg-cream hover:text-ink text-[9px] uppercase font-bold rounded-sm whitespace-nowrap cursor-pointer"
                      >
                        Bright
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Card: Memory */}
            <div className="p-5 border border-rule bg-cream/15 rounded-sm space-y-4 hover-lift">
              <span className="kicker flex items-center gap-1.5"><Database size={12} /> Memory Store</span>
              <div className="flex items-center justify-between">
                <span className="font-bold">Enable memory injection</span>
                <button onClick={() => saveConfig({ ...config, memory: { ...config.memory, enabled: !config.memory.enabled } })}
                  className={`px-2.5 py-0.5 border font-bold text-[9px] uppercase rounded-sm ${config.memory.enabled ? "bg-accent border-accent text-paper" : "border-rule text-muted"}`}>
                  {config.memory.enabled ? "On" : "Off"}
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-[9px] font-bold uppercase text-muted">
                  <span>Compression target</span>
                  <span>{Math.round(config.memory.compression_ratio_target * 100)}%</span>
                </div>
                <input type="range" min="0.1" max="0.5" step="0.05"
                  value={config.memory.compression_ratio_target}
                  onChange={e => saveConfig({ ...config, memory: { ...config.memory, compression_ratio_target: parseFloat(e.target.value) } })}
                  className="accent-accent cursor-pointer" />
              </div>
              <button onClick={async () => { const r: string = await invoke("trigger_memory_compression", { scope: "global", contextId: "" }); alert(r); }}
                className="w-full py-1.5 bg-ink hover:bg-accent text-paper font-bold uppercase tracking-wider text-[9px] rounded-sm transition-all">
                Force Memory Compression
              </button>
            </div>

            {/* Card: Chat & Branding Settings */}
            <div className="p-5 border border-rule bg-cream/15 rounded-sm space-y-4 hover-lift">
              <span className="kicker flex items-center gap-1.5"><MessageSquare size={12} /> Chat &amp; Branding Settings</span>

              <div className="flex flex-col gap-2">
                <label className="font-bold text-[10px] uppercase text-muted">User Chat Avatar</label>
                <div className="flex items-center gap-4 bg-paper p-3 rounded-sm border border-rule/35">
                  {/* Preview */}
                  <div className="w-14 h-14 rounded-sm border-2 border-rule bg-cream flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                    {config.chat.user_avatar_image ? (
                      <img
                        src={convertFileSrc(config.chat.user_avatar_image)}
                        className="w-full h-full object-cover"
                        alt="User avatar preview"
                      />
                    ) : (
                      <span className="font-sans-meta text-xl font-bold text-muted select-none">U</span>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col gap-2 min-w-0">
                    <div>
                      <span className="font-bold text-[10px] uppercase text-ink block mb-0.5">Import Custom Logo</span>
                      <span className="text-[9.5px] text-muted leading-snug block">
                        Replaces the default "U" badge in chat. Saved to your storage root at <span className="font-mono text-accent">assets/user_avatar</span>.
                      </span>
                    </div>

                    {config.chat.user_avatar_image && (
                      <p className="font-mono text-[8.5px] text-muted truncate border border-rule/30 bg-cream/40 px-1.5 py-0.5 rounded-sm">
                        {config.chat.user_avatar_image}
                      </p>
                    )}

                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={async () => {
                          // Use native file picker to get the image path
                          const filePath: string | null = await invoke("pick_file");
                          if (!filePath) return;

                          // Determine extension from picked file
                          const ext = filePath.split(".").pop()?.toLowerCase() || "png";
                          const sep = config.storage.root_path.includes("/") ? "/" : "\\";
                          const destPath = `${config.storage.root_path}${sep}assets${sep}user_avatar.${ext}`;

                          try {
                            // Read source file as base64
                            const base64: string = await invoke("read_binary_file_base64", { filePath });
                            // Write to storage root, creating dirs if needed
                            await invoke("write_binary_file_base64", { filePath: destPath, base64Content: base64 });
                            // Persist the file path (not base64) in config
                            const next = {
                              ...config,
                              chat: { ...config.chat, user_avatar_image: destPath }
                            };
                            await saveConfig(next);
                          } catch (err: any) {
                            alert("Failed to save avatar: " + (err?.toString() || "Unknown error"));
                          }
                        }}
                        className="px-3 py-1 border border-rule/50 bg-cream hover:bg-ink hover:text-paper hover:border-ink rounded-sm text-[9px] font-bold uppercase transition-all whitespace-nowrap cursor-pointer"
                      >
                        Choose Image…
                      </button>

                      {config.chat.user_avatar_image && (
                        <button
                          onClick={async () => {
                            const avatarPath = config.chat.user_avatar_image!;
                            // Delete the file from storage root
                            try {
                              await invoke("delete_file_or_dir", { path: avatarPath });
                            } catch {
                              // File may already be missing — still clear the config
                            }
                            // Clear the path from config
                            await saveConfig({
                              ...config,
                              chat: { ...config.chat, user_avatar_image: "" }
                            });
                          }}
                          className="px-3 py-1 border border-red-600/30 hover:border-red-600 bg-paper hover:bg-red-600 hover:text-paper rounded-sm text-[9px] font-bold uppercase transition-all whitespace-nowrap cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN ─────────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Card: GPU Configuration */}
            <div className="border border-rule bg-cream/15 rounded-sm overflow-hidden hover-lift">
              <button onClick={() => setGpuSectionOpen(!gpuSectionOpen)}
                className="w-full px-5 py-3 flex items-center justify-between bg-cream/30 hover:bg-cream/50 transition-colors">
                <span className="kicker flex items-center gap-1.5">
                  <Zap size={12} className="text-accent" /> GPU Acceleration
                </span>
                {gpuSectionOpen ? <ChevronUp size={12} className="text-muted" /> : <ChevronDown size={12} className="text-muted" />}
              </button>

              {gpuSectionOpen && (
                <div className="p-5 space-y-4">
                  {/* Detected GPUs */}
                  {gpuDevices.length > 0 ? (
                    <div className="space-y-2">
                      {gpuDevices.map(gpu => (
                        <div key={gpu.index}
                          onContextMenu={e => showContextMenu(e, [
                            { label: `Select ${gpu.name} as active device`, onClick: () => saveGpuConfig(gpuLayers, gpu.backend) },
                            { label: "Copy GPU name", onClick: () => navigator.clipboard.writeText(gpu.name) },
                          ])}
                          className="p-3 bg-paper border border-light-rule rounded-sm flex items-center justify-between">
                          <div>
                            <p className="font-bold text-[12px] text-accent">{gpu.name}</p>
                            <p className="text-muted text-[10px]">
                              VRAM: {(gpu.vram_free_mb / 1024).toFixed(1)} GB free / {(gpu.vram_total_mb / 1024).toFixed(1)} GB total
                              {" · "}Backend: <span className="uppercase font-bold">{gpu.backend}</span>
                              {" · "}CUDA {gpu.compute_capability}
                            </p>
                          </div>
                          <div className="w-16 h-1.5 bg-cream border border-rule/35 rounded-sm overflow-hidden">
                            <div style={{ width: `${((gpu.vram_total_mb - gpu.vram_free_mb) / gpu.vram_total_mb) * 100}%` }}
                              className="bg-accent h-full" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-paper border border-light-rule rounded-sm text-muted text-[11px] italic">
                      No discrete GPU detected — CPU inference mode active.
                    </div>
                  )}

                  {/* Execution Mode Selector */}
                  <div className="flex flex-col gap-2 pt-1">
                    <label className="font-bold text-[10px] uppercase text-muted">Execution Mode</label>
                    <div className="grid grid-cols-3 gap-1.5 p-0.5 bg-cream border border-rule/50 rounded-sm">
                      {[
                        { id: "cpu", label: "CPU Only", desc: "No GPU VRAM used" },
                        { id: "hybrid", label: "Hybrid Offload", desc: "Split RAM & VRAM" },
                        { id: "gpu_only", label: "Complete GPU Only", desc: "100% VRAM offload" }
                      ].map(mode => {
                        const isActive = 
                          mode.id === "cpu" ? gpuLayers === 0 :
                          mode.id === "gpu_only" ? gpuLayers === -1 :
                          gpuLayers > 0;
                        return (
                          <button
                            key={mode.id}
                            onClick={() => {
                              if (mode.id === "cpu") {
                                saveGpuConfig(0, "cpu");
                              } else if (mode.id === "gpu_only") {
                                const detected = gpuDevices.length > 0 ? gpuDevices[0].backend : "cuda";
                                saveGpuConfig(-1, detected);
                              } else {
                                const detected = gpuDevices.length > 0 ? gpuDevices[0].backend : "cuda";
                                saveGpuConfig(32, detected);
                              }
                            }}
                            className={`py-2 px-1 flex flex-col items-center justify-center rounded-sm transition-all duration-200 ${
                              isActive 
                                ? "bg-accent text-paper shadow-md font-extrabold" 
                                : "text-muted hover:text-ink hover:bg-cream/40"
                            }`}
                          >
                            <span className="text-[10px] uppercase tracking-wide">{mode.label}</span>
                            <span className="text-[8px] opacity-75 font-normal mt-0.5">{mode.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Backend and parameter configurations */}
                  <div className="grid grid-cols-2 gap-4 pt-1">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-[10px] uppercase text-muted">Inference Backend</label>
                      <select 
                        value={gpuBackend}
                        onChange={e => saveGpuConfig(gpuLayers, e.target.value)}
                        disabled={gpuLayers === 0}
                        className={`p-2 border border-rule/50 rounded-sm bg-paper outline-none cursor-pointer ${
                          gpuLayers === 0 ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      >
                        <option value="cpu" disabled={gpuLayers !== 0}>CPU only</option>
                        <option value="cuda">CUDA (NVIDIA)</option>
                        <option value="rocm">ROCm (AMD)</option>
                        <option value="metal">Metal (Apple)</option>
                        <option value="vulkan">Vulkan (Cross-platform)</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5 justify-center">
                      {gpuLayers === 0 && (
                        <div className="text-[10px] text-muted italic p-2 bg-paper border border-light-rule rounded-sm text-center">
                          CPU fallback active. VRAM is bypassed.
                        </div>
                      )}
                      {gpuLayers === -1 && (
                        <div className="text-[10px] text-accent font-bold p-2 bg-paper border border-accent/20 rounded-sm text-center animate-pulse">
                          🔥 Complete GPU Only. Maximum Speed.
                        </div>
                      )}
                      {gpuLayers > 0 && (
                        <>
                          <div className="flex justify-between font-bold text-[10px] uppercase text-muted">
                            <span>GPU Offload Layers</span>
                            <span className="text-accent">{gpuLayers}</span>
                          </div>
                          <input 
                            type="range" 
                            min="1" 
                            max="80" 
                            step="1" 
                            value={gpuLayers}
                            onChange={e => saveGpuConfig(parseInt(e.target.value), gpuBackend)}
                            className="accent-accent cursor-pointer mt-1"
                          />
                        </>
                      )}
                    </div>
                  </div>

                  <div className="p-3 bg-paper border border-light-rule rounded-sm text-[10px] text-muted leading-relaxed">
                    <strong className="text-accent">Tip:</strong> Set layers to <strong>−1</strong> to offload the entire model to GPU VRAM.
                    Partial offload (e.g. 32 layers) lets you run models larger than VRAM by splitting across RAM + VRAM.
                  </div>
                </div>
              )}
            </div>

            {/* Card: HuggingFace Hub */}
            <div className="p-5 border border-rule bg-cream/15 rounded-sm space-y-4">
              <span className="kicker flex items-center gap-1.5"><Download size={12} /> Model Hub (GGUF)</span>

              {/* Hugging Face Hub Access Token Input */}
              <div className="flex flex-col gap-1.5 p-3 bg-paper border border-light-rule rounded-sm">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-[9px] uppercase tracking-wider text-muted flex items-center gap-1">
                    <Key size={10} className="text-accent" /> Hugging Face Hub Access Token
                  </label>
                  <a 
                    href="https://huggingface.co/settings/tokens" 
                    target="_blank" 
                    rel="noreferrer" 
                    onClick={(e) => {
                      e.preventDefault();
                      invoke("tauri_plugin_opener::open_url", { url: "https://huggingface.co/settings/tokens" });
                    }}
                    className="text-accent hover:underline text-[9px] font-bold"
                  >
                    Get Token ↗
                  </a>
                </div>
                <input 
                  type="password" 
                  value={config.models.hf_token}
                  onChange={e => saveConfig({ ...config, models: { ...config.models, hf_token: e.target.value } })}
                  placeholder="hf_..."
                  className="w-full p-2 border border-rule/50 rounded-sm bg-cream/10 outline-none focus:border-accent font-mono text-[11px]" 
                />
                <span className="text-[9px] text-muted">Required to download gated models like Google Gemma-3. Your token is stored locally and securely.</span>
              </div>

              {/* Family filter pills */}
              <div className="flex flex-wrap gap-1.5">
                {familyTabs.map(f => (
                  <button key={f} onClick={() => setFilteredFamily(f)}
                    className={`px-2.5 py-0.5 text-[9px] font-bold uppercase rounded-sm border transition-all
                      ${filteredFamily === f ? "bg-ink text-paper border-ink" : "border-rule text-muted hover:border-muted"}`}>
                    {f === "all" ? "All" : (FAMILY_BADGE[f]?.label ?? f)}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-1.5 border border-rule/50 rounded-sm px-2 bg-paper">
                  <Search size={11} className="text-muted shrink-0" />
                  <input type="text" placeholder="Search by name or family…" value={hfSearchQuery}
                    onChange={e => setHfSearchQuery(e.target.value)}
                    className="flex-1 py-1.5 bg-transparent outline-none text-[11px]" />
                </div>
                <button onClick={() => invoke("query_huggingface_models", { query: hfSearchQuery }).then((r: any) => setHfModels(r))}
                  className="px-3 bg-ink hover:bg-accent text-paper font-bold uppercase text-[9px] rounded-sm transition-all">
                  Query
                </button>
              </div>

              {/* Active model indicator */}
              <div className="p-3 bg-paper border border-light-rule rounded-sm flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[9px] font-bold uppercase text-accent mb-0.5">Active Context</p>
                    <p className="font-mono text-[11px] font-bold text-ink">{loadedModelName || "No model loaded"}</p>
                  </div>
                  {loadedModelName && !loadedModelName.includes("[") && (
                    <button onClick={unloadModel}
                      className="px-2 py-0.5 border border-red-700/60 hover:bg-red-700 hover:text-paper text-red-700 font-bold uppercase text-[9px] rounded-sm transition-all">
                      Unload
                    </button>
                  )}
                </div>
                {vramHint && (
                  <p className={`text-[9.5px] font-mono font-semibold ${
                    vramHint.startsWith("✓") ? "text-green-700" :
                    vramHint.startsWith("⚡") ? "text-accent" : "text-muted"
                  }`}>{vramHint}</p>
                )}
              </div>

              {/* Download error toast */}
              {downloadError && (
                <div className="p-3 bg-red-50 border border-red-300 rounded-sm text-[10.5px] text-red-700 flex items-start justify-between gap-2">
                  <div>
                    <span className="font-bold uppercase text-[9px]">Download Error</span>
                    <p className="mt-0.5 font-mono leading-relaxed">{downloadError}</p>
                  </div>
                  <button onClick={() => setDownloadError(null)} className="shrink-0 hover:text-red-900 font-bold text-lg leading-none">×</button>
                </div>
              )}

              {/* Model list */}
              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {visibleModels.map(model => {
                  const badge = FAMILY_BADGE[model.family];
                  const isActive = loadedModelName === model.name;
                  const isDownloading = model.download_progress > 0 && !model.is_downloaded;

                  return (
                    <div key={model.name}
                      onContextMenu={e => handleModelRightClick(e, model)}
                      className="p-3 bg-paper border border-light-rule rounded-sm flex flex-col gap-2 hover:border-rule transition-colors">

                      {/* Header row */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {badge && (
                              <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded-sm text-white shrink-0"
                                style={{ background: badge.color }}>
                                {badge.label}
                              </span>
                            )}
                            <span className="font-mono text-[10.5px] font-bold text-ink truncate">{model.name}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9.5px] text-muted">
                            <span>{model.size_gb} GB · {model.quantization}</span>
                            <span>ctx {(model.context_length / 1024).toFixed(0)}K</span>
                            <span className="flex items-center gap-0.5">
                              <span>RAM {model.estimated_ram_gb}GB</span>
                              <span className="text-muted/40">/</span>
                              <span className="text-accent font-semibold">VRAM {model.estimated_vram_gb}GB</span>
                            </span>
                          </div>
                        </div>

                        {/* Action button */}
                        <div className="shrink-0">
                          {isActive ? (
                            <span className="px-2 py-0.5 bg-accent/15 text-accent font-bold text-[8.5px] uppercase border border-accent/30 rounded-sm">Active</span>
                          ) : model.is_downloaded ? (
                            <button onClick={async () => {
                              await loadModel(model.name, model.size_gb);
                              saveConfig({ ...config!, models: { ...config!.models, default_llm: model.name } });
                            }}
                              className="px-2.5 py-0.5 bg-ink hover:bg-accent text-paper font-bold uppercase text-[9px] rounded-sm transition-all">
                              Load
                            </button>
                          ) : isDownloading ? (
                            <button onClick={() => cancelDownload(model.name)}
                              className="px-2.5 py-0.5 border border-rule hover:bg-cream text-accent font-bold uppercase text-[9px] rounded-sm transition-all">
                              {Math.round(model.download_progress)}% ✕
                            </button>
                          ) : (
                            <button onClick={() => downloadModel(model)}
                              className="px-2.5 py-0.5 border border-rule hover:bg-cream text-ink font-bold uppercase text-[9px] rounded-sm transition-all flex items-center gap-1">
                              <Download size={10} /> Get
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Download progress bar */}
                      {isDownloading && (
                        <div className="w-full bg-cream h-1 border border-rule/35 rounded-sm overflow-hidden">
                          <div style={{ width: `${model.download_progress}%` }}
                            className="bg-accent h-full transition-all duration-300" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Card: Whisper */}
            <div className="p-5 border border-rule bg-cream/15 rounded-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="kicker flex items-center gap-1.5"><Sliders size={12} /> Whisper STT Models</span>
                {/* Whisper engine status badge — auto-downloads when first model is downloaded */}
                {whisperEngineStatus === "ready" ? (
                  <span className="text-[8.5px] font-bold uppercase text-green-700 border border-green-400/40 bg-green-50 px-2 py-0.5 rounded-sm flex items-center gap-1">
                    ✓ Engine Ready
                  </span>
                ) : whisperEngineStatus === "downloading" ? (
                  <span className="text-[8.5px] font-bold uppercase text-accent border border-accent/30 px-2 py-0.5 rounded-sm flex items-center gap-1 animate-pulse">
                    ⬇ Downloading Engine…
                  </span>
                ) : (
                  <button
                    onClick={async () => {
                      setWhisperEngineStatus("downloading");
                      invoke("download_whisper_binary")
                        .then(() => setWhisperEngineStatus("ready"))
                        .catch(() => setWhisperEngineStatus("unknown"));
                    }}
                    className="px-2.5 py-1 border border-rule/50 hover:bg-ink hover:text-paper text-muted font-bold uppercase text-[8.5px] rounded-sm transition-all flex items-center gap-1"
                  >
                    <Download size={10} /> Download Engine
                  </button>
                )}
              </div>

              {/* Whisper error toast */}
              {whisperError && (
                <div className="p-3 bg-red-50 border border-red-300 rounded-sm text-[10.5px] text-red-700 flex items-start justify-between gap-2">
                  <div>
                    <span className="font-bold uppercase text-[9px]">Whisper Download Error</span>
                    <p className="mt-0.5 font-mono leading-relaxed">{whisperError}</p>
                  </div>
                  <button onClick={() => setWhisperError(null)} className="shrink-0 hover:text-red-900 font-bold text-lg leading-none">×</button>
                </div>
              )}

              {whisperModels.map(wm => {
                const pct = whisperProgress[wm.name];
                const isDownloading = pct !== undefined;
                const isActive = config?.voice.active_whisper_model === wm.name;
                const runMode = whisperRunMode[wm.name];
                // Whisper VRAM requirements (rough estimates per model)
                const whisperVram: Record<string, number> = { tiny: 0.5, base: 0.7, small: 1.2, medium: 2.5, "large-v3": 5.0 };

                const handleWhisperDownload = async () => {
                  const required = whisperVram[wm.name] ?? 1.0;
                  const hasVram: boolean = await invoke("check_vram_available", { requiredGb: required });
                  setWhisperRunMode(prev => ({ ...prev, [wm.name]: hasVram ? "gpu" : "cpu" }));
                  // Auto-download the whisper.cpp engine in parallel — no-op if already present
                  if (whisperEngineStatus !== "ready") {
                    setWhisperEngineStatus("downloading");
                    invoke("download_whisper_binary")
                      .then(() => setWhisperEngineStatus("ready"))
                      .catch(() => setWhisperEngineStatus("unknown"));
                  }
                  invoke("download_whisper_model", { modelName: wm.name });
                };

                return (
                  <div key={wm.name}
                    onContextMenu={e => showContextMenu(e, [
                      { label: `Set as active model`, onClick: () => saveConfig({ ...config!, voice: { ...config!.voice, active_whisper_model: wm.name } }) },
                      ...(wm.is_downloaded ? [] : [{ label: `Download ${wm.name}`, onClick: handleWhisperDownload }]),
                    ])}
                    className="flex flex-col gap-2 py-2 border-b border-light-rule last:border-0">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => saveConfig({ ...config!, voice: { ...config!.voice, active_whisper_model: wm.name } })}
                          className={`w-2.5 h-2.5 rounded-full border-2 transition-colors ${
                            isActive ? "bg-accent border-accent" : "bg-transparent border-muted/50 hover:border-accent"
                          }`}
                          title="Set as active"
                        />
                        <span className="font-mono text-[11px] font-bold">whisper-{wm.name}</span>
                        {isActive && <span className="text-[8.5px] uppercase font-bold text-accent border border-accent/30 px-1 py-0.5 rounded-sm">Active</span>}
                        {wm.is_downloaded && runMode && (
                          <span className={`text-[8px] uppercase font-bold px-1 py-0.5 rounded-sm border ${
                            runMode === "gpu"
                              ? "text-green-700 border-green-400/40 bg-green-50"
                              : "text-muted border-rule bg-cream/40"
                          }`}>{runMode === "gpu" ? "GPU" : "CPU"}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted text-[10px]">{wm.size_mb >= 1000 ? `${(wm.size_mb / 1000).toFixed(1)} GB` : `${wm.size_mb} MB`}</span>
                        {wm.is_downloaded ? (
                          <span className="px-2 py-0.5 bg-accent/15 text-accent font-bold uppercase text-[8.5px] rounded-sm border border-accent/30">Ready</span>
                        ) : isDownloading ? (
                          <button
                            onClick={() => invoke("cancel_whisper_download", { modelName: wm.name })}
                            className="px-2.5 py-0.5 border border-rule hover:bg-cream text-accent font-bold uppercase text-[9px] rounded-sm transition-all"
                          >
                            {Math.round(pct)}% ✕
                          </button>
                        ) : (
                          <button
                            onClick={handleWhisperDownload}
                            className="px-2.5 py-0.5 border border-rule hover:bg-cream text-ink font-bold uppercase text-[9px] rounded-sm transition-all flex items-center gap-1"
                          >
                            <Download size={10} /> Download
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Progress bar */}
                    {isDownloading && (
                      <div className="w-full bg-cream h-1 border border-rule/35 rounded-sm overflow-hidden">
                        <div style={{ width: `${pct}%` }} className="bg-accent h-full transition-all duration-300" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      </div>

      {ContextMenuComponent}

      {/* Save Custom Theme Modal Dialog */}
      {showSaveModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-paper border-2 border-rule rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 text-accent border-b border-rule/35 pb-2.5">
              <Sliders size={16} />
              <span className="font-serif-display font-bold text-lg italic">Save Custom Theme</span>
            </div>
            
            <p className="text-[11.5px] text-muted leading-relaxed">
              Enter a unique name for your custom visual palette overrides. This will be saved in your storage root under the <span className="font-mono text-accent bg-cream/35 px-1 py-0.5 rounded-sm font-semibold">users/</span> folder.
            </p>

            <div className="flex flex-col gap-1.5">
              <label className="font-bold text-[9px] uppercase tracking-wider text-muted">Theme Name</label>
              <input
                type="text"
                value={newThemeName}
                onChange={(e) => {
                  setNewThemeName(e.target.value);
                  setSaveError("");
                }}
                placeholder="e.g. Crimson Cyber, Nord Forest"
                className="p-2 border border-rule rounded-md bg-cream/10 outline-none text-xs focus:border-accent text-ink placeholder:text-muted/60 font-semibold"
                autoFocus
              />
              {saveError && (
                <span className="text-[10px] text-accent font-semibold mt-1">
                  ⚠ {saveError}
                </span>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => {
                  setShowSaveModal(false);
                  setNewThemeName("");
                  setSaveError("");
                }}
                className="px-3.5 py-1.5 border border-rule/75 hover:border-rule text-muted hover:text-ink font-bold text-[10px] uppercase rounded-md cursor-pointer transition-all duration-200"
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

                    // Success!
                    await loadCustomPresets(config.storage.root_path);
                    setSelectedPresetName(themeName);
                    setShowSaveModal(false);
                    setNewThemeName("");
                    setSaveError("");
                  } catch (err: any) {
                    setSaveError(err.toString() || "Failed to save theme file");
                  }
                }}
                className="px-4 py-1.5 bg-accent hover:bg-accent/90 text-paper font-bold text-[10px] uppercase rounded-md cursor-pointer transition-all duration-200 active-accent-glow"
              >
                Save Preset
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
