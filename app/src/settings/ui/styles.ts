// Settings screen styles, ported from design/settings/settings.css. Each
// group names the CSS rule it copies; colors come from theme.surface.
import { StyleSheet } from "react-native";
import { radius, space, type Theme } from "../../theme";

export function settingsStyles(t: Theme) {
  const c = t.surface;
  const eink = t.eink;
  return StyleSheet.create({
    // .shell / .head
    page: { flex: 1, backgroundColor: c.gutter },
    shell: { width: "100%", maxWidth: 720, alignSelf: "center", backgroundColor: c.bg, flexGrow: 1, paddingBottom: space.xl },
    head: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
    title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5, lineHeight: 34, color: c.text },
    headSub: { flexDirection: "row", alignItems: "center", marginTop: 2 },
    headSubText: { fontSize: 13, color: c.muted, flexShrink: 1 },

    // .sec / .sec-head / .dot / .scope
    sec: { paddingTop: space.lg },
    secHead: {
      flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingBottom: space.sm,
      borderBottomWidth: 1, borderBottomColor: c.rule,
    },
    secTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase", color: c.text },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6, backgroundColor: c.accent },
    scope: {
      marginLeft: "auto", fontSize: 9, fontWeight: "800", letterSpacing: 1.6, textTransform: "uppercase",
      color: c.muted, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1,
      borderColor: eink ? c.muted : c.rule, borderRadius: 20, overflow: "hidden",
    },

    // .row and its parts
    row: {
      flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg,
      paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: c.rule,
    },
    child: { paddingLeft: 40 },
    rowMain: { flex: 1, minWidth: 0 },
    rowLabel: { fontSize: 16, fontWeight: "600", lineHeight: 21, color: c.text },
    rowSub: { fontSize: 13, lineHeight: 18, color: c.muted, marginTop: 3 },
    value: { fontSize: 15, color: c.muted, maxWidth: 200 },
    chevron: { fontSize: 26, lineHeight: 26, color: c.muted, marginLeft: -4 },
    arrow: { fontSize: 18, lineHeight: 20, color: c.muted },
    dim: { opacity: eink ? 1 : 0.3 },
    dimText: { color: c.muted },

    // .ring: off is an outline, on is a filled disc with a check
    ring: {
      width: 26, height: 26, borderRadius: 13, borderWidth: c.ringW, borderColor: c.muted,
      alignItems: "center", justifyContent: "center",
    },
    ringOn: { backgroundColor: c.accent, borderColor: c.accent },
    ringDashed: { borderStyle: "dashed" },
    check: {
      position: "absolute", left: 8, top: 4, width: 6, height: 11,
      borderRightWidth: 2, borderBottomWidth: 2, borderColor: c.onAccent, transform: [{ rotate: "45deg" }],
    },

    // .time-block / .field-label / .time / .ampm
    timeBlock: {
      paddingLeft: 40, paddingRight: space.lg, paddingVertical: space.md,
      borderBottomWidth: 1, borderBottomColor: c.rule,
    },
    fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9, textTransform: "uppercase", color: c.muted },
    timeRow: { marginTop: 6 },
    time: { fontSize: 40, fontWeight: "800", letterSpacing: -1, lineHeight: 42, color: c.text },
    ampm: { fontSize: 15, fontWeight: "700", letterSpacing: 0.6, color: c.muted },

    // .size-block / .atoms / .atom / .preview
    sizeBlock: { paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: c.rule },
    sizeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    atoms: { flexDirection: "row", gap: space.md, marginTop: 12 },
    atom: {
      width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
      borderWidth: c.ringW, borderColor: c.muted,
    },
    atomOn: { backgroundColor: c.accent, borderColor: c.accent },
    atomText: { fontWeight: "700", color: c.text },
    atomTextOn: { color: c.onAccent },
    preview: { marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: c.rule },

    // .field / .input / .field-row
    field: { paddingTop: space.md, paddingHorizontal: space.lg },
    input: {
      fontSize: 16, lineHeight: 22, color: c.text, paddingTop: 6, paddingBottom: 10, paddingHorizontal: 0,
      borderBottomWidth: 1, borderBottomColor: c.rule,
    },
    inputFocus: { borderBottomWidth: 2, borderBottomColor: c.accent, paddingBottom: 9 },
    fieldRow: { flexDirection: "row", alignItems: "center", gap: space.md, borderBottomWidth: 1, borderBottomColor: c.rule },
    fieldRowFocus: { borderBottomWidth: 2, borderBottomColor: c.accent },
    inputBare: { flex: 1, borderBottomWidth: 0, letterSpacing: 1 },

    // .act / .act-sm: text only; e-ink borrows Retry's outline
    act: { fontSize: 15, fontWeight: "700", color: c.accent },
    actSm: { fontSize: 14, fontWeight: "700", color: c.accent },
    actBox: eink ? { borderWidth: 1, borderColor: c.accent, borderRadius: radius.sm, paddingHorizontal: space.lg, paddingVertical: space.sm } : {},
    actSmBox: eink ? { borderWidth: 1, borderColor: c.accent, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: space.xs } : {},

    // .test / .track / .status
    test: { paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: c.rule, alignItems: "flex-start" },
    track: { alignSelf: "stretch", height: 2, backgroundColor: c.track, marginTop: 14, overflow: "hidden" },
    fill: { height: 2, width: "35%", backgroundColor: c.accent },
    status: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 10 },
    statusLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9, textTransform: "uppercase", color: c.text },
    statusDetail: { fontSize: 14, color: c.muted, marginLeft: 8 },

    // .jump: desktop section index in the left gutter
    jump: { position: "absolute", top: 104, width: 200, alignItems: "flex-end" },
    jumpLink: { flexDirection: "row", alignItems: "center", paddingVertical: 9 },
    jumpText: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase", color: c.muted },
    jumpTextOn: { color: c.text },
  });
}
export type SettingsStyles = ReturnType<typeof settingsStyles>;
