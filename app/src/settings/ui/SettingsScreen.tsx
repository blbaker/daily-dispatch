// The Settings screen (design/settings, approved 2026-10-19): Notifications,
// Daily podcast, Reading, Server and About, in one 720px column. Wide
// windows get a section index in the left gutter that follows the scroll.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import type { Theme } from "../../theme";
import { useSettings } from "../index";
import type { SettingsState } from "../types";
import { AboutSection, clockTime } from "./AboutSection";
import { Dot } from "./atoms";
import { NotificationsSection } from "./NotificationsSection";
import { PodcastSection } from "./PodcastSection";
import { ReadingSection } from "./ReadingSection";
import { ServerSection } from "./ServerSection";
import { Sheet, type SheetSpec } from "./Sheet";
import { settingsStyles, type SettingsStyles } from "./styles";

const SECTIONS = ["Notifications", "Daily podcast", "Reading", "Server", "About"];
const WIDE = 1100;

/** The line under the title: saved on the device first, then synced. */
export function syncLine(st: SettingsState, c: Theme["surface"]): { text: string; dot: string } {
  const { dirty, error, syncedAt } = st.sync;
  if (error === "No server set") return { text: "Saved on this device · add your server below to sync", dot: c.muted };
  if (dirty && error) return { text: "Saved on this device · will sync when your server answers", dot: c.bad };
  if (dirty) return { text: "Saved on this device · syncing", dot: c.accent };
  if (error) return { text: "Saved on this device · your server did not answer", dot: c.bad };
  if (syncedAt) return { text: `Saved · synced with your server at ${clockTime(syncedAt)}`, dot: c.good };
  return { text: "Saved on this device", dot: c.accent };
}

function JumpIndex({ s, left, active, onJump }: { s: SettingsStyles; left: number; active: number; onJump: (i: number) => void }) {
  return (
    <View style={[s.jump, { left }]} accessibilityLabel="Settings sections">
      {SECTIONS.map((name, i) => (
        <Pressable key={name} style={s.jumpLink} onPress={() => onJump(i)} accessibilityRole="link">
          {i === active ? <Dot s={s} /> : null}
          <Text style={[s.jumpText, i === active && s.jumpTextOn]}>{name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function SettingsScreen({ theme, topInset, bottomInset, setOverlay }: {
  theme: Theme; topInset: number; bottomInset: number;
  /** Draws the picker sheet above the tab bar, which this screen does not own. */
  setOverlay: (node: React.ReactNode) => void;
}) {
  const state = useSettings();
  const s = settingsStyles(theme);
  const { width, height } = useWindowDimensions();
  const [sheet, setSheet] = useState<SheetSpec | null>(null);
  const scroll = useRef<ScrollView>(null);
  const tops = useRef<number[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setOverlay(sheet ? <Sheet theme={theme} spec={sheet} onClose={() => setSheet(null)} bottomInset={bottomInset} /> : null);
  }, [sheet, theme, bottomInset, setOverlay]);
  useEffect(() => () => setOverlay(null), [setOverlay]);

  if (!state) {
    return <View style={[s.page, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={theme.surface.accent} /></View>;
  }
  const line = syncLine(state, theme.surface);
  const wide = width >= WIDE;

  const onScroll = (y: number, contentH: number) => {
    let i = 0;
    tops.current.forEach((top, n) => { if (top - y <= 140) i = n; });
    if (y + height >= contentH - 2) i = SECTIONS.length - 1;
    setActive(i);
  };
  const at = (i: number) => (e: { nativeEvent: { layout: { y: number } } }) => { tops.current[i] = e.nativeEvent.layout.y; };

  return (
    <View style={s.page} testID="settings-screen">
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ flexGrow: 1 }}
        scrollEventThrottle={32}
        onScroll={(e) => onScroll(e.nativeEvent.contentOffset.y, e.nativeEvent.contentSize.height)}
      >
        <View style={[s.shell, { paddingTop: topInset }]}>
          <View style={[s.head, wide && { paddingTop: 32 }]}>
            <Text style={s.title} accessibilityRole="header">Settings</Text>
            <View style={s.headSub}>
              <Dot s={s} color={line.dot} />
              <Text style={s.headSubText} testID="settings-sync">{line.text}</Text>
            </View>
          </View>
          <View style={s.sec} onLayout={at(0)}>
            <NotificationsSection s={s} eink={theme.eink} />
          </View>
          <View style={s.sec} onLayout={at(1)}>
            <PodcastSection s={s} eink={theme.eink} podcast={state.podcast} openSheet={setSheet} />
          </View>
          <View style={s.sec} onLayout={at(2)}>
            <ReadingSection s={s} theme={theme} reading={state.reading} />
          </View>
          <View style={s.sec} onLayout={at(3)}>
            <ServerSection s={s} theme={theme} server={state.server} />
          </View>
          <View style={s.sec} onLayout={at(4)}>
            <AboutSection s={s} openSheet={setSheet} />
          </View>
        </View>
      </ScrollView>
      {wide ? (
        <JumpIndex
          s={s}
          left={(width - 720) / 2 - 40 - 200}
          active={active}
          onJump={(i) => scroll.current?.scrollTo({ y: tops.current[i] ?? 0, animated: !theme.eink })}
        />
      ) : null}
    </View>
  );
}
