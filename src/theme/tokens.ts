export type ColorTheme = {
  id: string;
  label: string;
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceSoft: string;
  accent: string;
  accentStrong: string;
  text: string;
  muted: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  tabBar: string;
  buttonPrimaryText: string;
};

export const THEMES: Record<string, ColorTheme> = {
  original: {
    id: "original",
    label: "Original",
    bg: "#130f0b",
    bgElevated: "#1b140e",
    surface: "#241b14",
    surfaceSoft: "#2e2218",
    accent: "#d2a14f",
    accentStrong: "#f0bb67",
    text: "#f7edd8",
    muted: "#c7b69b",
    border: "rgba(245, 228, 195, 0.12)",
    success: "#3bb273",
    warning: "#e4b146",
    danger: "#de675c",
    info: "#8fa8ff",
    tabBar: "#1b140e",
    buttonPrimaryText: "#20160c",
  },
  bvb09: {
    id: "bvb09",
    label: "BVB 09",
    bg: "#0a0a0a",
    bgElevated: "#141414",
    surface: "#1a1a1a",
    surfaceSoft: "#222222",
    accent: "#FDE100",
    accentStrong: "#FDE100",
    text: "#f5f5f5",
    muted: "#a0a0a0",
    border: "rgba(253, 225, 0, 0.15)",
    success: "#3bb273",
    warning: "#FDE100",
    danger: "#de675c",
    info: "#8fa8ff",
    tabBar: "#0a0a0a",
    buttonPrimaryText: "#000000",
  },
  midnight: {
    id: "midnight",
    label: "Midnight",
    bg: "#0d1117",
    bgElevated: "#161b22",
    surface: "#1c2129",
    surfaceSoft: "#21262d",
    accent: "#58a6ff",
    accentStrong: "#79c0ff",
    text: "#e6edf3",
    muted: "#8b949e",
    border: "rgba(139, 148, 158, 0.15)",
    success: "#3fb950",
    warning: "#d29922",
    danger: "#f85149",
    info: "#a5d6ff",
    tabBar: "#0d1117",
    buttonPrimaryText: "#0d1117",
  },
};

let activeTheme: ColorTheme = THEMES.original;

export function setActiveTheme(themeId: string) {
  activeTheme = THEMES[themeId] ?? THEMES.original;
  // Overwrite every key on the exported `colors` object so that
  // StyleSheet.create and inline styles both pick up the change
  // after a re-render.
  for (const key of Object.keys(activeTheme) as Array<keyof ColorTheme>) {
    (colors as Record<string, string>)[key] = activeTheme[key];
  }
}

export function getActiveTheme() {
  return activeTheme;
}

// Mutable color bag – keys are overwritten by setActiveTheme()
export const colors: ColorTheme = { ...THEMES.original };

export const spacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
};

export const radius = {
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
};
