import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { space, Theme } from "./theme";
import type { EditionMeta } from "./api";
import { styles } from "./appStyles";
import { Center } from "./Center";

function shade(hex: string, amt: number) {
  const h = hex.replace("#", "");
  let r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ---------------- ARCHIVE LIST (cover cards, newest first) ---------------- */
export default function ArchiveList({
  theme, editions, topInset, onOpen, onRefresh,
}: {
  theme: Theme; editions: EditionMeta[] | null; topInset: number;
  onOpen: (id: string) => void; onRefresh: () => void;
}) {
  const s = styles(theme);
  const [refreshing, setRefreshing] = useState(false);
  if (!editions) return <Center theme={theme}><ActivityIndicator color={theme.accent} /></Center>;

  return (
    <ScrollView
      style={{ backgroundColor: theme.articleBg }}
      contentContainerStyle={{ paddingBottom: space.xl }}
      refreshControl={
        <RefreshControl refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await onRefresh(); setRefreshing(false); }}
          tintColor={theme.accent} />
      }
    >
      <View style={{ paddingHorizontal: space.lg, paddingTop: topInset + space.lg, paddingBottom: space.sm }}>
        <Text style={s.archiveTitle}>Archive</Text>
        <Text style={s.archiveSub}>Every edition · newest first</Text>
      </View>
      {editions.length === 0 && (
        <Text style={s.emptyText}>No editions yet. They appear after the 5 PM digest.</Text>
      )}
      {editions.map((ed, i) => {
        const wash = theme.washes[i % theme.washes.length];
        const hero = ed.hero || "";
        return (
          <Pressable key={ed.id} onPress={() => onOpen(ed.id)} style={s.edCard}>
            {hero && !theme.eink ? (
              <Image source={{ uri: hero }} style={StyleSheet.absoluteFill as any} resizeMode="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill as any, { backgroundColor: theme.eink ? "#eee" : shade(wash, 0.1) }]} />
            )}
            {!theme.eink && <View style={[StyleSheet.absoluteFill as any, { backgroundColor: "rgba(0,0,0,0.4)" }]} />}
            <View style={s.edBody}>
              {i === 0 ? <Text style={s.latestBadge}>LATEST</Text> : null}
              <Text style={[s.edDate, { color: theme.eink ? theme.textLight : "#fff" }]}>{ed.date}</Text>
              <Text style={[s.edLine, { color: theme.eink ? theme.mutedDark : "rgba(255,255,255,0.9)" }]}>
                {ed.weekday} · {ed.count} {ed.count === 1 ? "link" : "links"}{ed.inProgress ? " so far" : ""}
              </Text>
              <Text style={[s.edLead, { color: theme.eink ? theme.textLight : "#fff" }]} numberOfLines={2}>{ed.lead}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
