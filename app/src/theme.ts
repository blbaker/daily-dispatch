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

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const radius = { sm: 4, md: 8, card: 0, pill: 999 };

export function makeTheme(isEink: boolean) {
  return isEink ? eink : standard;
}
export type Theme = ReturnType<typeof makeTheme>;
