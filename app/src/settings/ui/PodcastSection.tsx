// Settings > Daily podcast. Reads and writes the podcast section of backend
// /settings through the settings store; the daily episode job reads the
// same values (roadmap decision 5).
import React from "react";
import { Pressable, Text, View } from "react-native";
import { settingsStore } from "../index";
import {
  VOICES, WRITERS, formatTime, hostList, labelFor, nextEpisode, timeSlots, timeZones, voiceCatalog,
  withHostVoice,
} from "../options";
import type { PodcastSettings } from "../types";
import { DrillRow, SectionHead, ToggleRow } from "./atoms";
import type { SheetSpec } from "./Sheet";
import type { SettingsStyles } from "./styles";

const deviceZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
})();

function save(patch: Partial<PodcastSettings>): void {
  // Pickers only offer valid values, and a network failure is kept as a
  // pending sync, so there is nothing to show the user here.
  settingsStore.setPodcast(patch).catch((e) => console.warn("settings: podcast not saved", e));
}

export function PodcastSection({ s, eink, podcast: p, openSheet }: {
  s: SettingsStyles; eink: boolean; podcast: PodcastSettings; openSheet: (spec: SheetSpec) => void;
}) {
  const off = !p.enabled;
  const voice = VOICES.find((v) => v.id === p.voiceProvider);
  const hosts = hostList(p.hostVoices);
  const t = formatTime(p.time);
  const next = nextEpisode(Date.now(), p.time, p.timezone);
  const dimText = off && eink ? s.dimText : null;

  const hostSheet = (i: number) => {
    const catalog = voiceCatalog(p.voiceProvider);
    const current = hosts[i].voice;
    const ids = current && !catalog.includes(current) ? [current, ...catalog] : catalog;
    openSheet({
      title: `Host ${i + 1} voice`,
      options: ids.map((id) => ({ id, label: id, sub: catalog.includes(id) ? `${voice?.label ?? p.voiceProvider} voice` : "Voice id" })),
      selected: current,
      onPick: (id) => save({ hostVoices: withHostVoice(p.hostVoices, i, id) }),
      custom: { label: "Voice id", placeholder: "Paste a voice id from your provider", onSubmit: (id) => save({ hostVoices: withHostVoice(p.hostVoices, i, id) }) },
    });
  };

  return (
    <View>
      <SectionHead s={s} title="Daily podcast" scope="Synced" />
      <ToggleRow
        s={s}
        label="Make a daily episode"
        sub="Your scheduler checks every 15 minutes, so a new time applies at the next check"
        on={p.enabled}
        onPress={() => save({ enabled: !p.enabled })}
        testID="podcast-enabled"
      />
      <View style={off && !eink ? s.dim : null} pointerEvents={off ? "none" : "auto"}>
        <Pressable
          style={s.timeBlock}
          accessibilityRole="button"
          testID="podcast-time"
          onPress={() => openSheet({
            title: "Episode time",
            options: timeSlots(p.time).map((hm) => {
              const f = formatTime(hm);
              return { id: hm, label: `${f.clock} ${f.ampm}` };
            }),
            selected: p.time,
            onPick: (time) => save({ time }),
          })}
        >
          <Text style={s.fieldLabel}>Episode time</Text>
          {/* AM/PM is nested so it shares the time's baseline on every engine. */}
          <Text style={[s.time, s.timeRow, dimText]}>
            {t.clock}<Text style={s.ampm}>{` ${t.ampm}`}</Text>
          </Text>
          <Text style={s.rowSub}>Every day{next ? ` · next episode ${next}` : ""}</Text>
        </Pressable>
        <DrillRow
          s={s} label="Time zone" value={p.timezone} dim={off && eink} testID="podcast-tz"
          onPress={() => openSheet({
            title: "Time zone",
            options: timeZones(deviceZone, p.timezone).map((z) => ({ id: z, label: z, sub: z === deviceZone ? "This device's time zone" : undefined })),
            selected: p.timezone,
            onPick: (timezone) => save({ timezone }),
          })}
        />
        <DrillRow
          s={s} label="Script writer" sub="Turns the day's stories into a two-host script" dim={off && eink}
          value={labelFor(WRITERS, p.scriptWriter)} testID="podcast-writer"
          onPress={() => openSheet({
            title: "Script writer", options: WRITERS, selected: p.scriptWriter,
            onPick: (scriptWriter) => save({ scriptWriter }),
          })}
        />
        <DrillRow
          s={s} label="Voice provider" dim={off && eink} testID="podcast-voice"
          sub={voice && !voice.paid ? "Free · runs on your network" : "Paid · uses the key on your server"}
          value={labelFor(VOICES, p.voiceProvider)}
          onPress={() => openSheet({
            title: "Voice provider", options: VOICES, selected: p.voiceProvider,
            // Voice ids belong to one provider, so a new provider starts with none.
            onPick: (voiceProvider) => voiceProvider !== p.voiceProvider && save({ voiceProvider, hostVoices: {} }),
          })}
        />
        <DrillRow
          s={s} label="Host 1 voice" value={hosts[0].voice || "Not set"} dim={off && eink}
          onPress={() => hostSheet(0)} testID="podcast-host1"
        />
        <DrillRow
          s={s} label="Host 2 voice" value={hosts[1].voice || "Not set"} dim={(off && eink) || !hosts[0].voice}
          sub={hosts[0].voice ? undefined : "Choose Host 1's voice first"}
          disabled={!hosts[0].voice} onPress={() => hostSheet(1)} testID="podcast-host2"
        />
      </View>
    </View>
  );
}
