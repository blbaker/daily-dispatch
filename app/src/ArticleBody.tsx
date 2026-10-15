// Article reader body: hero image, category, headline, Axios Quick Take
// bullets, prose summary, the full article (in-app), linked article, and a
// "Read on the web" link out. Split out of App.tsx to keep files small.
import React from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CAT_LABEL, space, radius, Theme, Cat } from "./theme";
import type { Story } from "./api";

export function hostOf(url: string) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url || "");
  return m ? m[1].replace(/^www\./, "") : url;
}

function Divider({ theme, label }: { theme: Theme; label: string }) {
  const s = styles(theme);
  return (
    <View style={s.divider}>
      <View style={s.dividerLine} />
      <Text style={s.dividerLabel}>{label}</Text>
      <View style={s.dividerLine} />
    </View>
  );
}

function Paras({ text, style }: { text: string; style: any }) {
  return <>{text.split(/\n\n+/).map((p, i) => <Text key={i} style={style}>{p}</Text>)}</>;
}

export default function ArticleBody({ theme, st }: { theme: Theme; st: Story }) {
  const s = styles(theme);
  const c = theme.catColor[st.cat as Cat] || theme.accent;
  const link = theme.eink ? "#000" : theme.accent;
  const overview = (st.overview || []).filter((o) => o.text);
  const linked = st.linked;
  return (
    <View>
      {st.image && !theme.eink ? (
        <Image source={{ uri: st.image }} style={s.hero} resizeMode="cover" />
      ) : null}
      <View style={s.catRow}>
        <View style={[s.catDot, { backgroundColor: c }]} />
        <Text style={[s.catLabel, { color: c }]}>{CAT_LABEL[st.cat as Cat] || "Technology"}</Text>
      </View>
      <Text style={s.headline}>{st.headline}</Text>
      <Text style={s.source}>{st.source}</Text>

      {/* Axios "Quick take": bold label + one line each, category-colored rule */}
      {overview.length ? (
        <View style={[s.quick, { borderLeftColor: c }]}>
          <Text style={[s.quickTitle, { color: c }]}>QUICK TAKE</Text>
          {overview.map((o, i) => (
            <View key={i} style={s.bullet}>
              <View style={[s.bulletDot, { backgroundColor: c }]} />
              <Text style={s.bulletText}>
                {o.label ? <Text style={s.bulletLabel}>{o.label}: </Text> : null}
                {o.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {st.summary.map((p, i) => <Text key={i} style={s.summary}>{p}</Text>)}

      {st.fullText ? (
        <>
          <Divider theme={theme} label="FULL ARTICLE" />
          <Paras text={st.fullText} style={s.full} />
        </>
      ) : null}

      {linked ? (
        <>
          <Divider theme={theme} label="LINKED ARTICLE" />
          {linked.image && !theme.eink && linked.image !== st.image ? (
            <Image source={{ uri: linked.image }} style={s.hero} resizeMode="cover" />
          ) : null}
          <Text style={s.linkedTitle}>{linked.title}</Text>
          <Text style={s.source}>{hostOf(linked.url)}</Text>
          {linked.fullText ? <Paras text={linked.fullText} style={s.full} />
            : linked.desc ? <Text style={s.full}>{linked.desc}</Text> : null}
          <Pressable style={s.web} onPress={() => Linking.openURL(linked.url)}>
            <Text style={[s.webText, { color: link }]}>Open linked article on the web →</Text>
          </Pressable>
        </>
      ) : null}

      {st.url ? (
        <Pressable style={s.web} onPress={() => Linking.openURL(st.url)}>
          <Text style={[s.webText, { color: link }]}>
            {linked ? "Open original post →" : `Read on ${hostOf(st.url)} →`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function styles(t: Theme) {
  return StyleSheet.create({
    hero: { width: "100%", height: 200, borderRadius: radius.sm, backgroundColor: t.divider, marginBottom: space.md },
    catRow: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
    catDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
    catLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
    headline: { fontSize: 23, fontWeight: "700", color: t.textLight, lineHeight: 29, marginTop: 6, marginBottom: 6 },
    source: { fontSize: 13, color: t.muted, fontStyle: "italic", marginBottom: space.md },
    quick: { borderLeftWidth: 3, paddingLeft: space.md, paddingVertical: 2, marginBottom: space.lg },
    quickTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 },
    bullet: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
    bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8, marginRight: 10 },
    bulletText: { flex: 1, fontSize: 15, lineHeight: 22, color: t.textLight },
    bulletLabel: { fontWeight: "700" },
    summary: { fontSize: 16, lineHeight: 25, color: t.textLight, marginBottom: space.md },
    divider: { flexDirection: "row", alignItems: "center", marginVertical: space.md },
    dividerLine: { flex: 1, height: 1, backgroundColor: t.divider },
    dividerLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5, color: t.muted, marginHorizontal: space.sm },
    full: { fontSize: 15, lineHeight: 24, color: t.textLight, marginBottom: space.md },
    linkedTitle: { fontSize: 19, fontWeight: "700", color: t.textLight, lineHeight: 25, marginBottom: 4 },
    web: { marginTop: space.md, paddingVertical: space.sm },
    webText: { fontSize: 14, fontWeight: "700" },
  });
}
