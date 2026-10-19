// In-app notification strip for desktop builds whose engine cannot show an
// OS notification (no Notifications module, or the OS said no). Same design
// as UpdateBanner: a cover-surface strip, category-style dot and UPPERCASE
// label, semibold headline, muted body, text-only actions. E-ink: white
// strip, black text, 1px black rule. It floats over the top of the screen
// and hides itself after a few seconds.
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useNotificationBanner, type FeedNotification, type OpenTarget } from "./notifications";
import { targetFromData } from "./notifications/target";

const LABEL: Record<string, string> = { edition: "NEW EDITION", episode: "NEW EPISODE" };

// Web preview only: ?notifyDemo=edition|episode shows a sample strip.
function demoNote(): FeedNotification | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const kind = new URLSearchParams(window.location.search).get("notifyDemo");
  if (kind !== "edition" && kind !== "episode") return null;
  return kind === "edition"
    ? { id: "demo", event: "edition", title: "Thursday's edition is ready", body: "4 stories, led by open hardware boards shipping with mainline kernels.", data: { type: "edition", id: "2026-03-12" }, createdAt: "" }
    : { id: "demo", event: "episode", title: "Today's episode is ready", body: "Two hosts, 14 minutes, on today's four stories.", data: { type: "episode", id: "2026-03-12" }, createdAt: "" };
}

export default function NotificationBanner({
  eink, topInset = 0, onOpen,
}: {
  eink: boolean; topInset?: number; onOpen: (t: OpenTarget) => void;
}) {
  const [live, dismiss] = useNotificationBanner();
  const [demo, setDemo] = useState<FeedNotification | null>(null);
  useEffect(() => setDemo(demoNote()), []);
  const note = live ?? demo;
  if (!note) return null;

  const s = styles(eink);
  const target = targetFromData(note.data);
  const close = () => (live ? dismiss() : setDemo(null));
  return (
    <View style={[s.strip, { paddingTop: topInset + 12 }]} accessibilityRole="alert">
      <View style={s.head}>
        <View style={s.dot} />
        <Text style={s.label}>{LABEL[note.data?.type ?? ""] ?? "NOTIFICATION"}</Text>
      </View>
      <Text style={s.headline}>{note.title}</Text>
      {note.body ? <Text style={s.detail}>{note.body}</Text> : null}
      <View style={s.actions}>
        <Pressable hitSlop={10} onPress={close}>
          <Text style={s.secondary}>Dismiss</Text>
        </Pressable>
        {target ? (
          <Pressable hitSlop={10} onPress={() => { close(); onOpen(target); }}>
            <Text style={s.primary}>Open</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function styles(eink: boolean) {
  const bg = eink ? "#FFFFFF" : "#121212"; // --cover-bg
  const text = eink ? "#000000" : "#FFFFFF"; // --text-primary-dark
  const muted = eink ? "#333333" : "#A0A0A0"; // --text-muted-dark
  const accent = eink ? "#000000" : "#2B9FD9"; // --cat-us
  return StyleSheet.create({
    strip: {
      position: "absolute", top: 0, left: 0, right: 0, zIndex: 20,
      backgroundColor: bg, paddingHorizontal: 20, paddingBottom: 16,
      borderBottomWidth: eink ? 1 : 0, borderBottomColor: "#000",
    },
    head: { flexDirection: "row", alignItems: "center" },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: accent, marginRight: 6 },
    label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9, color: accent },
    headline: { fontSize: 18, fontWeight: "600", lineHeight: 24, color: text, marginTop: 6 },
    detail: { fontSize: 14, lineHeight: 20, color: muted, marginTop: 4 },
    actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 24, marginTop: 12 },
    secondary: { fontSize: 15, fontWeight: "600", color: muted },
    primary: { fontSize: 15, fontWeight: "700", color: accent },
  });
}
