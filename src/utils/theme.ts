import { AppConfig } from "../types";
import { applyTypographyToRoot } from "./fonts";

export const THEME_VERSION = "quantum_v1";

export const QUANTUM_GHOST_FIBER_DEFAULTS = {
  ghost_fiber_glow: "#2457FF",
  ghost_fiber_secondary: "#00D4FF",
  ghost_fiber_line: "#DFF7FF",
  ghost_fiber_opacity: "0.45",
  ghost_fiber_style: "dots",
  ghost_fiber_enabled: "true",
} as const;

export const QUANTUM_DARK_OVERRIDES: Record<string, string> = {
  nav_background: "#0B0F19",
  content_background: "#0B0F19",
  card_background: "rgba(255, 255, 255, 0.03)",
  card_border: "rgba(223, 247, 255, 0.08)",
  text_color: "#F0F4F8",
  border_accent: "#2457FF",
  navbar_edge_smoothness: "8px",
  ui_edge_smoothness: "8px",
  ...QUANTUM_GHOST_FIBER_DEFAULTS,
  theme_version: THEME_VERSION,
};

export const QUANTUM_LIGHT_OVERRIDES: Record<string, string> = {
  nav_background: "#FFFFFF",
  content_background: "#F0F4F8",
  card_background: "rgba(255, 255, 255, 0.82)",
  card_border: "#D8E2ED",
  text_color: "#0A1128",
  border_accent: "#2457FF",
  navbar_edge_smoothness: "8px",
  ui_edge_smoothness: "8px",
  ...QUANTUM_GHOST_FIBER_DEFAULTS,
  theme_version: THEME_VERSION,
};

function hexLuminance(hex?: string): number | null {
  if (!hex) return null;
  const clean = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Migrates older default themes (Obsidian Champagne / Minimalist B&W)
 * to the unified Quantum Blue Ghost Fiber Default theme once per user config.
 */
export function migrateLegacyThemeConfig(cfg: AppConfig): { cfg: AppConfig; changed: boolean } {
  const ov = cfg.theme?.ui_overrides || {};
  if (ov.theme_version === THEME_VERSION) {
    return { cfg, changed: false };
  }

  const isLight = cfg.theme?.theme_preset === "light";
  const basePalette = isLight ? QUANTUM_LIGHT_OVERRIDES : QUANTUM_DARK_OVERRIDES;

  const oldAccent = (ov.border_accent || "").toLowerCase();
  const oldBg = (ov.nav_background || "").toLowerCase();
  const isLegacyDefault =
    !oldAccent ||
    oldAccent === "#e6d5c3" ||
    oldAccent === "#ffffff" ||
    oldBg === "#12131c" ||
    oldBg === "#000000" ||
    oldBg === "";

  const nextOverrides: Record<string, string> = {
    ...ov,
    ...(isLegacyDefault ? basePalette : {}),
    // Remove discontinued Ghost Fiber presets / upgrade Ghost Fiber defaults to Quantum Blue
    ghost_fiber_glow: QUANTUM_GHOST_FIBER_DEFAULTS.ghost_fiber_glow,
    ghost_fiber_secondary: QUANTUM_GHOST_FIBER_DEFAULTS.ghost_fiber_secondary,
    ghost_fiber_line: QUANTUM_GHOST_FIBER_DEFAULTS.ghost_fiber_line,
    ghost_fiber_opacity: ov.ghost_fiber_opacity || QUANTUM_GHOST_FIBER_DEFAULTS.ghost_fiber_opacity,
    ghost_fiber_style: ov.ghost_fiber_style || QUANTUM_GHOST_FIBER_DEFAULTS.ghost_fiber_style,
    ghost_fiber_enabled: ov.ghost_fiber_enabled || QUANTUM_GHOST_FIBER_DEFAULTS.ghost_fiber_enabled,
    theme_version: THEME_VERSION,
  };

  const nextCfg: AppConfig = {
    ...cfg,
    theme: {
      ...cfg.theme,
      accent_color: isLegacyDefault ? "#2457FF" : cfg.theme.accent_color,
      ui_overrides: nextOverrides,
    },
  };

  return { cfg: nextCfg, changed: true };
}

export function applyThemeToDocument(
  overrides: Record<string, string>,
  fontFamily?: string,
  themePreset?: string
) {
  const root = document.documentElement;
  const ov = overrides || {};

  // Determine whether Light Mode is active (either explicit preset === "light" or bright custom canvas background)
  const bgSample = ov.content_background || ov.nav_background;
  const lum = hexLuminance(bgSample);
  const isLight =
    themePreset === "light" ||
    (themePreset !== "dark" && lum !== null && lum > 0.55) ||
    (lum !== null && lum > 0.65);

  const paperColor =
    ov.content_background ||
    ov.nav_background ||
    (isLight ? "#F0F4F8" : "#0B0F19");
  const navColor =
    ov.nav_background ||
    (isLight ? "#FFFFFF" : "rgba(255, 255, 255, 0.03)");
  const inkColor =
    ov.text_color ||
    (isLight ? "#0A1128" : "#F0F4F8");
  const creamColor =
    ov.card_background ||
    (isLight ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.03)");
  const ruleColor =
    ov.card_border ||
    (isLight ? "#D8E2ED" : "rgba(223, 247, 255, 0.08)");
  const accentColor = ov.border_accent || "#2457FF";

  if (isLight) {
    root.classList.add("theme-light");
    root.classList.remove("theme-dark");
    root.setAttribute("data-theme", "light");
    root.style.colorScheme = "light";
  } else {
    root.classList.remove("theme-light");
    root.classList.add("theme-dark");
    root.setAttribute("data-theme", "dark");
    root.style.colorScheme = "dark";
  }

  // Always enforce a solid hex for elevated surfaces (modals, menus, popovers, select popups)
  const isSolidHex = (val?: string) => !!val && /^#[0-9a-fA-F]{6}$/.test(val.trim());
  const elevatedBg = isLight
    ? (isSolidHex(ov.card_background) ? ov.card_background : "#FFFFFF")
    : (isSolidHex(ov.card_background) ? ov.card_background : "#121829");

  const textSec = isLight ? "#334155" : "#CBD5E1";
  const textMut = isLight ? "#64748B" : "#8B9BB4";
  const textFnt = isLight ? "#94A3B8" : "#54637A";
  const borderSubtle = ov.card_border || (isLight ? "#D8E2ED" : "rgba(223, 247, 255, 0.08)");
  const borderDefault = isLight ? "#CBD5E1" : "rgba(223, 247, 255, 0.16)";
  const borderStrong = isLight ? "rgba(36, 87, 255, 0.35)" : "rgba(36, 87, 255, 0.40)";
  const accentSoft = isLight ? "#DFF7FF" : "rgba(36, 87, 255, 0.16)";
  const accentSofter = isLight ? "rgba(36, 87, 255, 0.07)" : "rgba(36, 87, 255, 0.08)";
  const navHoverBg = isLight ? "rgba(36, 87, 255, 0.06)" : "rgba(36, 87, 255, 0.10)";
  const navActiveBg = isLight ? "#DFF7FF" : "rgba(36, 87, 255, 0.22)";

  // Readable accent color when rendered as small text on background
  const accentLum = hexLuminance(accentColor);
  const accentText =
    !isLight && accentLum !== null && accentLum < 0.25
      ? "#6FA4FF"
      : accentColor;

  root.style.setProperty("--theme-paper", paperColor);
  root.style.setProperty("--theme-ink", inkColor);
  root.style.setProperty("--theme-cream", creamColor);
  root.style.setProperty("--theme-rule", ruleColor);
  root.style.setProperty("--theme-accent", accentColor);

  // Also sync Tailwind v4 @theme runtime tokens so utility classes (bg-paper, text-ink, etc.) update live
  const tailwindCream = isLight
    ? (isSolidHex(ov.card_background) ? ov.card_background : "#E2EAF3")
    : (isSolidHex(ov.card_background) ? ov.card_background : "#121829");
  const tailwindRule = isLight
    ? (isSolidHex(ov.card_border) ? ov.card_border : "#CBD5E1")
    : (isSolidHex(ov.card_border) ? ov.card_border : "#1E293B");
  const tailwindLightRule = isLight ? "#D8E2ED" : "#162033";

  root.style.setProperty("--color-paper", paperColor);
  root.style.setProperty("--color-ink", inkColor);
  root.style.setProperty("--color-cream", tailwindCream);
  root.style.setProperty("--color-muted", textMut);
  root.style.setProperty("--color-accent", accentColor);
  root.style.setProperty("--color-rule", tailwindRule);
  root.style.setProperty("--color-light-rule", tailwindLightRule);

  root.style.setProperty("--bg-app", paperColor);
  root.style.setProperty("--bg-sidebar", navColor);
  root.style.setProperty("--bg-surface", creamColor);
  root.style.setProperty("--bg-surface-elevated", elevatedBg);
  root.style.setProperty("--bg-titlebar", paperColor);

  root.style.setProperty("--text-primary", inkColor);
  root.style.setProperty("--text-secondary", textSec);
  root.style.setProperty("--text-muted", textMut);
  root.style.setProperty("--theme-muted", textMut);
  root.style.setProperty("--text-faint", textFnt);

  root.style.setProperty("--accent", accentColor);
  root.style.setProperty("--accent-text", accentText);
  root.style.setProperty("--accent-rose", isLight ? "#0099CC" : "#00D4FF");
  root.style.setProperty("--accent-soft", accentSoft);
  root.style.setProperty("--accent-softer", accentSofter);

  root.style.setProperty("--border-subtle", borderSubtle);
  root.style.setProperty("--border-default", borderDefault);
  root.style.setProperty("--border-strong", borderStrong);

  root.style.setProperty("--sidebar-nav-hover-bg", navHoverBg);
  root.style.setProperty("--sidebar-nav-active-bg", navActiveBg);

  const lightRuleColor =
    ruleColor.startsWith("#") && ruleColor.length === 7 ? `${ruleColor}3a` : ruleColor;
  root.style.setProperty("--theme-light-rule", lightRuleColor);

  // Glow
  const glowOn = ov.accent_glow === "true";
  const brightness = parseFloat(ov.accent_glow_brightness || "1.0");
  const borderGlowRadius = Math.round(10 * brightness);
  const textGlowRadius = Math.round(5 * brightness);
  const baseAlpha = Math.min(1.0, brightness);
  const borderAlphaHex = Math.round(baseAlpha * 255).toString(16).padStart(2, "0");
  const textAlphaHex = Math.round(baseAlpha * 0.5 * 255).toString(16).padStart(2, "0");
  const borderGlowColor =
    accentColor.startsWith("#") && accentColor.length === 7
      ? `${accentColor}${borderAlphaHex}`
      : accentColor;
  const textGlowColor =
    accentColor.startsWith("#") && accentColor.length === 7
      ? `${accentColor}${textAlphaHex}`
      : `${accentColor}80`;

  root.style.setProperty(
    "--theme-accent-glow",
    glowOn ? `0 0 ${borderGlowRadius}px ${borderGlowColor}` : "none"
  );
  root.style.setProperty(
    "--theme-accent-text-glow",
    glowOn ? `0 0 ${textGlowRadius}px ${textGlowColor}` : "none"
  );

  // Typography
  applyTypographyToRoot(root, fontFamily);

  // Smoothness / Border Radius
  const navSmooth =
    ov.navbar_edge_smoothness !== undefined && ov.navbar_edge_smoothness !== ""
      ? ov.navbar_edge_smoothness
      : "8px";
  const uiSmooth =
    ov.ui_edge_smoothness !== undefined && ov.ui_edge_smoothness !== ""
      ? ov.ui_edge_smoothness
      : "8px";
  root.style.setProperty("--navbar-edge-smoothness", navSmooth);
  root.style.setProperty("--ui-edge-smoothness", uiSmooth);
}
