// Yahoo News Digest-derived design tokens (extracted design system).
// Single source of truth for both the phone build and the Boox e-ink build.
export type Cat =
  | "us" | "world" | "sports" | "science"
  | "entertainment" | "tech" | "business" | "politics" | "health";

export const CAT_COLOR: Record<Cat, string> = {
  us: "#2B9FD9",
  world: "#27AE60",
  sports: "#F5A623",
  science: "#9B4DCA",
  entertainment: "#E74C8A",
  tech: "#3498DB",
  business: "#1ABC9C",
  politics: "#E74C3C",
  health: "#2ECC71",
};

export const CAT_LABEL: Record<Cat, string> = {
  us: "U.S.",
  world: "World",
  sports: "Sports",
  science: "Science",
  entertainment: "Entertainment",
  tech: "Technology",
  business: "Business",
  politics: "Politics",
  health: "Health",
};

// Duotone cover washes for edition cards (Yahoo used full-bleed photos; a link
// digest has none, so a per-edition color wash stands in).
export const WASHES = [
  "#2B6CB0", "#2C7A7B", "#6B46C1", "#B7791F", "#9B2C5A", "#2F855A", "#1E6091",
];

// Standard (phone) palette — dark cover / white reader duality.
const standard = {
  eink: false,
  coverBg: "#121212",
  articleBg: "#FFFFFF",
  textDark: "#FFFFFF",
  textLight: "#1A1A1A",
  muted: "#6B6B6B",
  mutedDark: "#A0A0A0",
  divider: "#E5E5E5",
  dividerDark: "#2A2A2A",
  accent: "#2B9FD9",
  catColor: CAT_COLOR,
  washes: WASHES,
};

// E-ink (Boox Note Air 4C) palette — high-contrast grayscale, no washes, no
// low-contrast grays that vanish on e-paper. Colors flattened to black/gray.
const eink = {
  ...standard,
  eink: true,
  coverBg: "#FFFFFF", // e-ink is reflective; white base reads best
  articleBg: "#FFFFFF",
  textDark: "#000000",
  textLight: "#000000",
  muted: "#444444",
  mutedDark: "#333333",
  divider: "#000000",
  dividerDark: "#000000",
  accent: "#000000",
  // Category colors flattened to grayscale tones distinguishable on e-ink.
  catColor: Object.fromEntries(
    Object.keys(CAT_COLOR).map((k) => [k, "#000000"])
  ) as Record<Cat, string>,
  washes: ["#E8E8E8", "#DADADA", "#EDEDED", "#E0E0E0", "#D6D6D6"],
};

// Dark scheme (roadmap decision 10, approved with the Settings mockups): the
// reader side takes the cover side's tokens, so every screen goes dark.
const standardDark = {
  ...standard,
  articleBg: standard.coverBg,
  textLight: standard.textDark,
  muted: standard.mutedDark,
  divider: standard.dividerDark,
};

// Dark e-ink is the e-ink palette inverted (Boox dark display mode). #BBBBBB
// is #444444 inverted, so muted text keeps the same contrast.
const einkDark = {
  ...eink,
  coverBg: "#000000",
  articleBg: "#000000",
  textDark: "#FFFFFF",
  textLight: "#FFFFFF",
  muted: "#BBBBBB",
  mutedDark: "#CCCCCC",
  divider: "#FFFFFF",
  dividerDark: "#FFFFFF",
  accent: "#FFFFFF",
  catColor: Object.fromEntries(
    Object.keys(CAT_COLOR).map((k) => [k, "#FFFFFF"])
  ) as Record<Cat, string>,
  washes: ["#333333", "#3A3A3A", "#2E2E2E", "#363636", "#303030"],
};

// Settings screen and tab bar tokens (design/settings/tokens.css).
type Surface = {
  bg: string; text: string; muted: string; rule: string; accent: string; onAccent: string;
  good: string; bad: string; tabbar: string; gutter: string; track: string; scrim: string; ringW: number;
};
const SURFACE: Record<"standard" | "eink", Record<Scheme, Surface>> = {
  standard: {
    light: {
      bg: "#FFFFFF", text: "#1A1A1A", muted: "#6B6B6B", rule: "#E5E5E5", accent: "#2B9FD9", onAccent: "#FFFFFF",
      good: "#27AE60", bad: "#C0392B", tabbar: "#FFFFFF", gutter: "#F2F2F2", track: "#E5E5E5",
      scrim: "rgba(0,0,0,0.4)", ringW: 1.5,
    },
    dark: {
      bg: "#121212", text: "#FFFFFF", muted: "#A0A0A0", rule: "#2A2A2A", accent: "#2B9FD9", onAccent: "#FFFFFF",
      good: "#27AE60", bad: "#C0392B", tabbar: "#0D0D0D", gutter: "#000000", track: "#2A2A2A",
      scrim: "rgba(0,0,0,0.6)", ringW: 1.5,
    },
  },
  eink: {
    light: {
      bg: "#FFFFFF", text: "#000000", muted: "#444444", rule: "#000000", accent: "#000000", onAccent: "#FFFFFF",
      good: "#000000", bad: "#000000", tabbar: "#FFFFFF", gutter: "#FFFFFF", track: "#CCCCCC",
      scrim: "rgba(0,0,0,0.5)", ringW: 2,
    },
    dark: {
      bg: "#000000", text: "#FFFFFF", muted: "#BBBBBB", rule: "#FFFFFF", accent: "#FFFFFF", onAccent: "#000000",
      good: "#FFFFFF", bad: "#FFFFFF", tabbar: "#000000", gutter: "#000000", track: "#444444",
      scrim: "rgba(0,0,0,0.5)", ringW: 2,
    },
  },
};

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const radius = { sm: 4, md: 8, card: 0, pill: 999 };

export type Scheme = "light" | "dark";

export function makeTheme(isEink: boolean, opts: { scheme?: Scheme; textScale?: number } = {}) {
  const scheme: Scheme = opts.scheme ?? "light";
  const dark = scheme === "dark";
  const base = isEink ? (dark ? einkDark : eink) : (dark ? standardDark : standard);
  return {
    ...base,
    scheme,
    /** Reading text size from Settings, 1 = the design's sizes. */
    textScale: opts.textScale ?? 1,
    surface: SURFACE[isEink ? "eink" : "standard"][scheme],
  };
}
export type Theme = ReturnType<typeof makeTheme>;

type Sized = { fontSize?: number; lineHeight?: number };

/** Multiplies fontSize and lineHeight of every style in a sheet by `scale`. */
export function scaleText<T extends Record<string, object>>(sheet: T, scale: number): T {
  if (scale === 1) return sheet;
  const out: Record<string, object> = {};
  for (const [k, v] of Object.entries(sheet)) {
    const st = { ...(v as Sized) };
    if (typeof st.fontSize === "number") st.fontSize = Math.round(st.fontSize * scale * 2) / 2;
    if (typeof st.lineHeight === "number") st.lineHeight = Math.round(st.lineHeight * scale);
    out[k] = st;
  }
  return out as T;
}
