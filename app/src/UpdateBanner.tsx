// In-app update strip, built from the Yahoo News Digest design system (see
// styles() below). States: available -> downloading -> ready (Not now /
// Install) | error. Collapsible via the chevron.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
  Release, checkForUpdate, cleanupOldDownloads, downloadUpdate, installUpdate,
  isDownloaded,
} from "./updates";
import { onUpdateCheckRequest } from "./updateRequests";

type Phase = "hidden" | "available" | "downloading" | "ready" | "error";
const RECHECK_MS = 6 * 60 * 60 * 1000;

function mb(bytes: number) {
  return (bytes / 1048576).toFixed(0);
}

export default function UpdateBanner({
  eink, topInset = 0, onVisibleChange,
}: {
  eink: boolean; topInset?: number; onVisibleChange?: (visible: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [rel, setRel] = useState<Release | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(true);
  const dismissedVc = useRef(0); // "Not now" hides this version for the session
  const lastCheck = useRef(0);
  const path = useRef("");
  const busy = useRef(false);

  const check = useCallback(async (force = false) => {
    if (busy.current) return;
    if (!force && Date.now() - lastCheck.current < 60000) return;
    lastCheck.current = Date.now();
    const r = await checkForUpdate();
    if (!r) { setPhase("hidden"); return; }
    if (r.versionCode <= dismissedVc.current) return;
    setRel(r);
    setOpen(true);
    if (await isDownloaded(r)) {
      path.current = await downloadUpdate(r, () => {});
      setPhase("ready");
    } else {
      setPhase("available");
    }
  }, []);

  useEffect(() => {
    // Web preview only: ?updateDemo=available|downloading|ready|error
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const demo = new URLSearchParams(window.location.search).get("updateDemo") as Phase | null;
      if (demo) {
        setRel({ versionCode: 204, versionName: "1.0.204", notes: "Linked articles and faster Today refresh.", url: "", size: 56713335 });
        setProgress(0.62);
        setErr("Download failed (HTTP 403)");
        setPhase(demo);
        return;
      }
    }
    cleanupOldDownloads();
    check(true);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") check(); });
    const iv = setInterval(() => check(true), RECHECK_MS);
    return () => { sub.remove(); clearInterval(iv); };
  }, [check]);

  // Settings > About > Check now.
  useEffect(() => onUpdateCheckRequest(() => { void check(true); }), [check]);

  const startDownload = async () => {
    if (!rel || busy.current) return;
    busy.current = true;
    setProgress(0);
    setPhase("downloading");
    try {
      path.current = await downloadUpdate(rel, setProgress);
      setPhase("ready");
    } catch (e: any) {
      setErr(String(e?.message || e));
      setPhase("error");
    } finally {
      busy.current = false;
    }
  };

  const install = async () => {
    try {
      await installUpdate(path.current);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setPhase("error");
    }
  };

  const visible = phase !== "hidden" && !!rel;
  useEffect(() => { onVisibleChange?.(visible); }, [visible]);

  if (!visible || !rel) return null;
  const s = styles(eink);

  // Yahoo News Digest design system: a cover-surface (#121212) strip pinned to
  // the top edge, sharp corners, no shadow; category-style dot + UPPERCASE
  // label; semibold headline; muted body; text-only actions (no filled
  // buttons). Progress is a 2px bar in the accent color. E-ink: white strip,
  // black text, 1px black rule.
  const label =
    phase === "available" ? "UPDATE"
    : phase === "downloading" ? "DOWNLOADING"
    : phase === "ready" ? "READY TO INSTALL"
    : "UPDATE PAUSED";
  const headline =
    phase === "available" ? `Daily Dispatch ${rel.versionName} is here`
    : phase === "downloading" ? `Getting ${rel.versionName} ready`
    : phase === "ready" ? `${rel.versionName} is ready to install`
    : "The download didn't finish";
  const detail =
    phase === "available" ? rel.notes || "A new version of the app is available."
    : phase === "downloading"
      ? `${Math.round(progress * 100)}%${rel.size ? ` · ${mb(progress * rel.size)} of ${mb(rel.size)} MB` : ""} · keep reading while it downloads`
    : phase === "ready" ? "Downloaded. Install now, or it'll be waiting next time you open the app."
    : err || "Something went wrong. Try again when you're back online.";

  return (
    <View style={[s.strip, { paddingTop: topInset + 12 }]}>
      <Pressable style={s.head} onPress={() => setOpen((o) => !o)} hitSlop={8}>
        <View style={s.dot} />
        <Text style={s.label}>{label}</Text>
        <View style={{ flex: 1 }} />
        <View style={[s.chev, open ? s.chevUp : s.chevDown]} />
      </Pressable>

      {open ? (
        <>
          <Text style={s.headline}>{headline}</Text>
          <Text style={s.detail}>{detail}</Text>
          {phase === "downloading" ? (
            <View style={s.track}>
              <View style={[s.fill, { width: `${Math.max(2, progress * 100)}%` }]} />
            </View>
          ) : (
            <View style={s.actions}>
              {phase === "ready" ? (
                <Pressable hitSlop={10} onPress={() => { dismissedVc.current = rel.versionCode; setPhase("hidden"); }}>
                  <Text style={s.secondary}>Not now</Text>
                </Pressable>
              ) : null}
              <Pressable hitSlop={10} onPress={phase === "ready" ? install : startDownload}>
                <Text style={s.primary}>
                  {phase === "available" ? "Download" : phase === "ready" ? "Install" : "Try again"}
                </Text>
              </Pressable>
            </View>
          )}
        </>
      ) : null}
    </View>
  );
}

function styles(eink: boolean) {
  const bg = eink ? "#FFFFFF" : "#121212";       // --cover-bg
  const text = eink ? "#000000" : "#FFFFFF";     // --text-primary-dark
  const muted = eink ? "#333333" : "#A0A0A0";    // --text-muted-dark
  const accent = eink ? "#000000" : "#2B9FD9";   // --cat-us
  return StyleSheet.create({
    strip: {
      backgroundColor: bg, paddingHorizontal: 20, paddingBottom: 16,
      borderBottomWidth: eink ? 1 : 0, borderBottomColor: "#000",
    },
    head: { flexDirection: "row", alignItems: "center" },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: accent, marginRight: 6 },
    label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9, color: accent },
    chev: { width: 9, height: 9, borderColor: muted, borderTopWidth: 2, borderLeftWidth: 2, marginRight: 2 },
    chevUp: { transform: [{ rotate: "45deg" }], marginTop: 5 },
    chevDown: { transform: [{ rotate: "225deg" }], marginTop: -5 },
    headline: { fontSize: 18, fontWeight: "600", lineHeight: 24, color: text, marginTop: 6 },
    detail: { fontSize: 14, lineHeight: 20, color: muted, marginTop: 4 },
    actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 24, marginTop: 12 },
    secondary: { fontSize: 15, fontWeight: "600", color: muted },
    primary: { fontSize: 15, fontWeight: "700", color: accent },
    track: { height: 2, backgroundColor: eink ? "#CCCCCC" : "#2A2A2A", marginTop: 14, overflow: "hidden" },
    fill: { height: 2, backgroundColor: accent },
  });
}
