// Styles shared by the main screens (digest, archive, article, tab bar).
// Split out of App.tsx to keep files small.
import { StyleSheet } from "react-native";
import { space, radius, scaleText, Theme } from "./theme";

export const FONT = "System";
export function styles(t: Theme) {
  // Story text follows the Reading text size; chrome (tabs, titles) does not.
  const reading = scaleText({
    leadHeadline: { fontSize: 22, fontWeight: "600" as const, color: t.textLight, lineHeight: 28, marginTop: 4 },
    catLabel: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.8, textTransform: "uppercase" as const },
    rowHeadline: { fontSize: 16, fontWeight: "600" as const, color: t.textLight, lineHeight: 21 },
    rowSource: { fontSize: 12, color: t.muted, marginTop: 3 },
  }, t.textScale);
  return StyleSheet.create({
    ...reading,
    // hero (YND cover: date top-left, 32-ish bold; lowercase light dateline)
    hero: { overflow: "hidden" },
    heroBack: { position: "absolute", left: space.md, zIndex: 5 },
    heroDate: { fontSize: 34, fontWeight: "700", letterSpacing: -0.5, lineHeight: 38,
      textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 10 },
    heroSub: { fontSize: 15, fontWeight: "400", letterSpacing: 0.6, marginTop: 2,
      textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },

    // lead story card under the slant (YND cover card)
    lead: { paddingHorizontal: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: t.divider },
    numDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginRight: 8 },
    numDotTxt: { color: "#fff", fontSize: 12, fontWeight: "700" },
    // "sent since 5 PM" divider on the Today list
    section: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: t.divider },
    sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, color: t.accent },
    sectionSub: { fontSize: 13, color: t.muted, marginTop: 2 },

    // article list rows
    row: { flexDirection: "row", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: t.divider },
    thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: t.divider },
    catRow: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
    catDotSm: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },

    // archive
    archiveTitle: { fontSize: 28, fontWeight: "800", color: t.textLight, letterSpacing: -0.5 },
    archiveSub: { fontSize: 13, color: t.muted, marginTop: 2 },
    emptyText: { color: t.muted, textAlign: "center", padding: space.xl },
    edCard: { minHeight: 200, marginBottom: t.eink ? space.md : 2, marginHorizontal: t.eink ? space.md : 0, justifyContent: "flex-end", overflow: "hidden", borderWidth: t.eink ? 1 : 0, borderColor: t.divider },
    edBody: { padding: space.lg },
    edDate: { fontSize: 40, fontWeight: "800", letterSpacing: -1, lineHeight: 42 },
    edLine: { fontSize: 13, marginTop: 4, textTransform: "capitalize" },
    edLead: { fontSize: 15, fontWeight: "600", lineHeight: 20, marginTop: 10 },
    latestBadge: { alignSelf: "flex-start", backgroundColor: t.eink ? t.textLight : "#fff", color: t.eink ? t.articleBg : "#121212", fontSize: 9, fontWeight: "800", letterSpacing: 1.6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, marginBottom: 8, overflow: "hidden" },

    // article view
    topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, paddingTop: 44, paddingBottom: space.sm, backgroundColor: t.articleBg, borderBottomWidth: 1, borderBottomColor: t.divider },
    topbarTitle: { fontSize: 15, fontWeight: "700", color: t.textLight },
    chevron: { fontSize: 34, fontWeight: "800", lineHeight: 34 },
    chevronBig: { fontSize: 40, fontWeight: "800", lineHeight: 40, width: 34 },

    // tabbar
    // The tabs sit in the same 720px column as Settings; on wide windows the
    // bar's sides match the page beside it (see App.tsx).
    tabbar: { borderTopWidth: 1, borderTopColor: t.surface.rule, backgroundColor: t.surface.tabbar },
    tabbarGutter: { borderTopWidth: 0, backgroundColor: t.surface.gutter },
    tabRow: { flexDirection: "row", width: "100%", maxWidth: 720, alignSelf: "center", backgroundColor: t.surface.tabbar, paddingTop: 10 },
    tabRowEdge: { borderTopWidth: 1, borderTopColor: t.surface.rule },
    tab: { flex: 1, alignItems: "center" },
    tabTxt: { fontSize: 14, fontWeight: "600", color: t.surface.muted },
    tabActive: { color: t.surface.accent, fontWeight: "800" },

    errTitle: { color: t.textLight, fontSize: 18, fontWeight: "700", marginBottom: 6 },
    errBody: { color: t.muted, textAlign: "center" },
    retry: { marginTop: space.lg, borderWidth: 1, borderColor: t.accent, borderRadius: radius.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
    retryText: { color: t.accent, fontWeight: "700" },
  });
}
