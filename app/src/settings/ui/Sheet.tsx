// The picker sheet: a scrim, then a panel pinned to the bottom edge with a
// title, Done, and a list of options marked with the on/off ring. The app
// renders it above the tab bar (see App.tsx), as the mockup does.
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { space, type Theme } from "../../theme";
import { Action, Ring } from "./atoms";
import { settingsStyles } from "./styles";

export interface SheetOption {
  id: string;
  label: string;
  sub?: string;
}

export interface SheetSpec {
  title: string;
  options: SheetOption[];
  /** The chosen id. Leave out for a read-only list, such as licenses. */
  selected?: string;
  onPick?: (id: string) => void;
  /** A free-text entry under the list, for ids no list can hold. */
  custom?: { label: string; placeholder: string; onSubmit: (value: string) => void };
}

export function Sheet({ theme, spec, onClose, bottomInset }: {
  theme: Theme; spec: SheetSpec; onClose: () => void; bottomInset: number;
}) {
  const s = settingsStyles(theme);
  const c = theme.surface;
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const pick = spec.onPick !== undefined;
  const submit = () => {
    const v = text.trim();
    if (!v || !spec.custom) return;
    spec.custom.onSubmit(v);
    onClose();
  };
  return (
    <View style={StyleSheet.absoluteFill} testID="settings-sheet">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} onPress={onClose} accessibilityLabel="Close" />
      <View style={sheet.dock} pointerEvents="box-none">
      <View style={[sheet.panel, { backgroundColor: c.bg, borderTopColor: c.rule, paddingBottom: bottomInset + space.md }]}>
        <View style={[sheet.head, { borderBottomColor: c.rule }]}>
          <Text style={[sheet.title, { color: c.text }]}>{spec.title}</Text>
          <Action s={s} small label="Done" onPress={onClose} />
        </View>
        <ScrollView>
          {spec.options.map((o) => {
            const on = o.id === spec.selected;
            const body = (
              <>
                <View style={s.rowMain}>
                  <Text style={s.rowLabel}>{o.label}</Text>
                  {o.sub ? <Text style={s.rowSub}>{o.sub}</Text> : null}
                </View>
                {pick ? <Ring s={s} on={on} /> : null}
              </>
            );
            return pick ? (
              <Pressable
                key={o.id}
                style={s.row}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => { spec.onPick?.(o.id); onClose(); }}
              >
                {body}
              </Pressable>
            ) : (
              <View key={o.id} style={s.row}>{body}</View>
            );
          })}
          {spec.custom ? (
            <View style={s.field}>
              <Text style={s.fieldLabel}>{spec.custom.label}</Text>
              <View style={[s.fieldRow, focus && s.fieldRowFocus]}>
                <TextInput
                  style={[s.input, s.inputBare]}
                  value={text}
                  onChangeText={setText}
                  onFocus={() => setFocus(true)}
                  onBlur={() => setFocus(false)}
                  onSubmitEditing={submit}
                  placeholder={spec.custom.placeholder}
                  placeholderTextColor={c.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Action s={s} small label="Use" onPress={submit} />
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
      </View>
    </View>
  );
}

const sheet = StyleSheet.create({
  dock: { position: "absolute", left: 0, right: 0, bottom: 0, top: "20%", alignItems: "center", justifyContent: "flex-end" },
  panel: { width: "100%", maxWidth: 720, borderTopWidth: 1, maxHeight: "100%" },
  head: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1,
  },
  title: { fontSize: 15, fontWeight: "700" },
});
