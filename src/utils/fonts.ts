export interface FontPreset {
  id: string;
  label: string;
  desc: string;
  text: string;
  display: string;
  sans: string;
  mono?: string;
}

export const FONT_PRESETS: FontPreset[] = [
  {
    id: "editorial",
    label: "Neo-Classical",
    desc: "EB Garamond + Playfair (Elegant Editorial)",
    text: '"EB Garamond", Georgia, serif',
    display: '"Playfair Display", Georgia, serif',
    sans: '"Inter", system-ui, sans-serif',
  },
  {
    id: "modern_sans",
    label: "Crisp Sans",
    desc: "Unified Inter (Clean & Tech-focused)",
    text: '"Inter", system-ui, sans-serif',
    display: '"Inter", system-ui, sans-serif',
    sans: '"Inter", system-ui, sans-serif',
  },
  {
    id: "monospace",
    label: "Cyber Mono",
    desc: "Unified JetBrains Mono (Terminal Aesthetic)",
    text: '"JetBrains Mono", monospace',
    display: '"JetBrains Mono", monospace',
    sans: '"JetBrains Mono", monospace',
    mono: '"JetBrains Mono", monospace',
  },
  {
    id: "retro_serif",
    label: "Warm Retro",
    desc: "Georgia + Courier New (Vintage Press)",
    text: 'Georgia, serif',
    display: '"Courier New", Courier, monospace',
    sans: 'Georgia, serif',
  },
  {
    id: "outfit",
    label: "Geometric Sans",
    desc: "Unified Outfit (Friendly Modern Sans)",
    text: '"Outfit", sans-serif',
    display: '"Outfit", sans-serif',
    sans: '"Outfit", sans-serif',
  },
  {
    id: "spacemono",
    label: "Space Monospace",
    desc: "Space Mono (Futuristic Dashboard Numerals)",
    text: '"Space Mono", monospace',
    display: '"Space Mono", monospace',
    sans: '"Space Mono", monospace',
    mono: '"Space Mono", monospace',
  },
  {
    id: "firacode",
    label: "Fira Code Monospace",
    desc: "Fira Code (Tabular Programmer Numerals)",
    text: '"Fira Code", monospace',
    display: '"Fira Code", monospace',
    sans: '"Fira Code", monospace',
    mono: '"Fira Code", monospace',
  },
  {
    id: "lexend",
    label: "Data Geometric",
    desc: "Lexend (Engineered Readable Math & Digits)",
    text: '"Lexend", sans-serif',
    display: '"Lexend", sans-serif',
    sans: '"Lexend", sans-serif',
  },
];

export function getFontPreset(id?: string): FontPreset {
  if (!id) return FONT_PRESETS[1]; // Crisp Sans / Inter default

  const normalized = id.toLowerCase().trim();

  // Handle legacy or aliased identifiers
  if (normalized === "inter" || normalized === "crisp_sans" || normalized === "modern_sans") {
    return FONT_PRESETS.find(f => f.id === "modern_sans") || FONT_PRESETS[1];
  }
  if (normalized === "editorial" || normalized === "neo_classical" || normalized === "neoclassical") {
    return FONT_PRESETS.find(f => f.id === "editorial") || FONT_PRESETS[0];
  }

  return FONT_PRESETS.find(f => f.id.toLowerCase() === normalized) || FONT_PRESETS[1];
}

export function applyTypographyToRoot(target: HTMLElement, presetId?: string): void {
  const font = getFontPreset(presetId);

  target.style.setProperty("--theme-font-text", font.text);
  target.style.setProperty("--theme-font-display", font.display);
  target.style.setProperty("--theme-font-sans", font.sans);
  target.style.setProperty("--font-ui", font.text);
  target.style.setProperty("--font-display", font.display);
  target.style.setProperty(
    "--font-mono",
    font.mono || '"JetBrains Mono", "Cascadia Code", Consolas, monospace'
  );
}
