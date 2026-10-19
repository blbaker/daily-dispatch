// Settings > Reading: text size for stories and articles, and e-ink mode.
// Both stay on this device.
import React from "react";
import { Pressable, Text, View } from "react-native";
import { styles as appStyles } from "../../appStyles";
import { CAT_LABEL, type Theme } from "../../theme";
import { EINK_BUILD, settingsStore } from "../index";
import type { ReadingSettings, TextScale } from "../types";
import { SectionHead, ToggleRow } from "./atoms";
import type { SettingsStyles } from "./styles";

const SIZES: { scale: TextScale; name: string; px: number }[] = [
  { scale: 0.875, name: "Small", px: 13 },
  { scale: 1, name: "Default", px: 16 },
  { scale: 1.125, name: "Large", px: 19 },
  { scale: 1.25, name: "Larger", px: 22 },
];

function save(patch: Partial<ReadingSettings>): void {
  settingsStore.setReading(patch).catch((e) => console.warn("settings: reading not saved", e));
}

export function ReadingSection({ s, theme, reading }: { s: SettingsStyles; theme: Theme; reading: ReadingSettings }) {
  const current = SIZES.find((z) => z.scale === reading.textScale) ?? SIZES[1];
  // The preview is a real story row, drawn by the app's own styles.
  const row = appStyles(theme);
  const science = theme.catColor.science;
  return (
    <View>
      <SectionHead s={s} title="Reading" scope="This device" />
      <View style={s.sizeBlock}>
        <View style={s.sizeTop}>
          <Text style={s.rowLabel}>Text size</Text>
          <Text style={s.value}>{current.name}</Text>
        </View>
        <View style={s.atoms} accessibilityRole="radiogroup" accessibilityLabel="Text size">
          {SIZES.map((z) => {
            const on = z === current;
            return (
              <Pressable
                key={z.name}
                style={[s.atom, on && s.atomOn]}
                accessibilityRole="radio"
                accessibilityLabel={z.name}
                accessibilityState={{ checked: on }}
                onPress={() => save({ textScale: z.scale })}
                testID={`text-size-${z.name.toLowerCase()}`}
              >
                <Text style={[s.atomText, { fontSize: z.px }, on && s.atomTextOn]}>A</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={s.preview} testID="text-size-preview">
          <View style={row.catRow}>
            <View style={[row.catDotSm, { backgroundColor: science }]} />
            <Text style={[row.catLabel, { color: science }]}>{CAT_LABEL.science}</Text>
          </View>
          <Text style={row.rowHeadline}>Webb finds water ice in the disk around a star only a million years old</Text>
          <Text style={row.rowSource}>NASA Science</Text>
        </View>
      </View>
      <ToggleRow
        s={s}
        label="E-ink mode"
        sub="Black and white, no photos, no animation. Always on in the Boox build"
        on={EINK_BUILD || reading.eink}
        disabled={EINK_BUILD}
        onPress={() => save({ eink: !reading.eink })}
        testID="eink-mode"
      />
    </View>
  );
}
