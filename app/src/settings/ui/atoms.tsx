// Small building blocks for the Settings screen: section heads, rows,
// the on/off ring and text actions. Markup follows design/settings.
import React from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import type { SettingsStyles } from "./styles";

type S = { s: SettingsStyles };

export function Dot({ s, color }: S & { color?: string }) {
  return <View style={[s.dot, color ? { backgroundColor: color } : null]} />;
}

export function SectionHead({ s, title, scope }: S & { title: string; scope?: string }) {
  return (
    <View style={s.secHead}>
      <Dot s={s} />
      <Text style={s.secTitle} accessibilityRole="header">{title}</Text>
      {scope ? <Text style={s.scope}>{scope}</Text> : null}
    </View>
  );
}

/** DESIGN.md atom: a ring when off, a filled disc with a check when on. */
export function Ring({ s, on, dashed }: S & { on: boolean; dashed?: boolean }) {
  return (
    <View style={[s.ring, on && !dashed && s.ringOn, dashed && s.ringDashed]}>
      {on && !dashed ? <View style={s.check} /> : null}
    </View>
  );
}

function RowText({ s, label, sub, dim, subNode }: S & { label: string; sub?: string; dim?: boolean; subNode?: React.ReactNode }) {
  return (
    <View style={s.rowMain}>
      <Text style={[s.rowLabel, dim && s.dimText]}>{label}</Text>
      {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      {subNode}
    </View>
  );
}

export function ToggleRow({
  s, label, sub, on, onPress, child, disabled, einkDisabled, testID, subNode,
}: S & {
  label: string; sub?: string; on: boolean; onPress: () => void; child?: boolean; disabled?: boolean;
  /** E-ink can't fade, so a disabled row greys its label and dashes its ring. */
  einkDisabled?: boolean; testID?: string; subNode?: React.ReactNode;
}) {
  return (
    <Pressable
      style={[s.row, child && s.child]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      testID={testID}
    >
      <RowText s={s} label={label} sub={sub} dim={einkDisabled} subNode={subNode} />
      <Ring s={s} on={on} dashed={einkDisabled} />
    </Pressable>
  );
}

export function DrillRow({
  s, label, sub, value, onPress, external, style, disabled, dim, testID,
}: S & {
  label: string; sub?: string; value?: string; onPress?: () => void; external?: boolean;
  style?: ViewStyle; disabled?: boolean; dim?: boolean; testID?: string;
}) {
  return (
    <Pressable style={[s.row, style]} onPress={onPress} disabled={disabled} accessibilityRole="button" testID={testID}>
      <RowText s={s} label={label} sub={sub} dim={dim} />
      {value ? <Text style={s.value} numberOfLines={1} ellipsizeMode="middle">{value}</Text> : null}
      <Text style={external ? s.arrow : s.chevron}>{external ? "\u2192" : "\u203A"}</Text>
    </Pressable>
  );
}

export function StaticRow({ s, label, sub, right }: S & { label: string; sub?: string; right?: React.ReactNode }) {
  return (
    <View style={s.row}>
      <RowText s={s} label={label} sub={sub} />
      {right}
    </View>
  );
}

/** Text-only action; on e-ink it gets the Retry button's outline. */
export function Action({
  s, label, onPress, small, disabled, testID,
}: S & { label: string; onPress: () => void; small?: boolean; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      style={small ? s.actSmBox : s.actBox}
      testID={testID}
    >
      <Text style={small ? s.actSm : s.act}>{label}</Text>
    </Pressable>
  );
}
