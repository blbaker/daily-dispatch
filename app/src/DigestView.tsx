import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from "react-native";
import { CAT_LABEL, space, Theme, Cat } from "./theme";
import { getEdition, Edition } from "./api";
import { styles } from "./appStyles";
import { Center } from "./Center";
import ArticleView from "./ArticleView";

/* ---------------- DIGEST VIEW: slanted hero + article list (one light screen) --
   Also hosts the article overlay (swipe between articles). ------------------- */
export default function DigestView({
  theme, id, extraId, tick, topInset, onHeroUnderStatus, article, onOpenArticle, onCloseArticle,
  onRefresh, canBack, onBack,
}: {
  theme: Theme; id: string; extraId?: string; tick: number; topInset: number;
  onHeroUnderStatus: (under: boolean) => void; article: number | null;
  onOpenArticle: (i: number) => void; onCloseArticle: () => void;
  onRefresh: () => void; canBack: boolean; onBack: () => void;
}) {
  const s = styles(theme);
  const [base, setBase] = useState<Edition | null>(null);
  const [extra, setExtra] = useState<Edition | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const reading = useRef(article !== null);
  reading.current = article !== null;
  const underRef = useRef(true);
  // Hero geometry measured from the Yahoo News Digest cover reference
  // (ynd-01): the photo's bottom edge sits at 65% of screen height on the
  // left and 75% on the right, i.e. it drops left->right at ~1:5 of the
  // width. Sized against the scroll viewport so the lead story always sits
  // under the slant, above the fold, like the YND cover card.
  const { width: winW, height: winH } = useWindowDimensions();
  const [vpH, setVpH] = useState(winH - 60);
  const slant = Math.round(winW * 0.186);
  const heroH = Math.round(Math.max(winW * 1.05, vpH * 0.75));

  const load = useCallback(async () => {
    try {
      setErr(null);
      const [b, x] = await Promise.all([
        getEdition(id),
        extraId ? getEdition(extraId).catch(() => null) : Promise.resolve(null),
      ]);
      setBase(b);
      setExtra(x);
    } catch (e: any) { setErr(String(e.message || e)); }
  }, [id, extraId]);
  useEffect(() => { load(); }, [load]);
  // background refresh (foreground/poll) — skipped mid-article so the pager
  // doesn't shift under the reader
  useEffect(() => { if (tick > 0 && !reading.current) load(); }, [tick]);

  if (err) return <Center theme={theme}><Text style={s.errBody}>{err}</Text></Center>;
  if (!base) return <Center theme={theme}><ActivityIndicator color={theme.accent} /></Center>;

  // one continuous edition so swiping runs through the after-5 PM links too
  const splitAt = base.stories.length;
  const ed: Edition = extra?.stories.length
    ? { ...base, stories: [...base.stories, ...extra.stories] }
    : base;

  // Article overlay takes over when reading.
  if (article !== null) {
    return (
      <ArticleView
        theme={theme}
        ed={ed}
        index={article}
        topInset={topInset}
        onIndex={onOpenArticle}
        onBack={onBack}
      />
    );
  }

  const lead = ed.stories[0];
  const hero = lead?.image || ed.hero || ed.stories.find((x) => x.image)?.image || "";
  const wash = theme.washes[0];
  const onPhoto = theme.eink ? "#000" : "#fff";
  const leadColor = lead ? theme.catColor[lead.cat as Cat] || theme.accent : theme.accent;
  // lead card's category row sits inside the white wedge (YND cover card)
  const leadLift = Math.round(slant * 0.2 + 11);

  return (
    <ScrollView
      style={{ backgroundColor: theme.articleBg }}
      contentContainerStyle={{ paddingBottom: space.xl }}
      onLayout={(e) => setVpH(e.nativeEvent.layout.height)}
      scrollEventThrottle={32}
      onScroll={(e) => {
        // status-bar icons flip dark once the photo scrolls out from under them
        const under = e.nativeEvent.contentOffset.y < heroH - slant - topInset;
        if (under !== underRef.current) { underRef.current = under; onHeroUnderStatus(under); }
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); await onRefresh(); setRefreshing(false); }}
          tintColor={theme.accent}
        />
      }
    >
      {/* SLANTED HERO: full-bleed photo under the status bar, date top-left */}
      <View style={[s.hero, { height: heroH }]}>
        {hero && !theme.eink ? (
          <Image source={{ uri: hero }} style={StyleSheet.absoluteFill as any} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill as any, { backgroundColor: theme.eink ? "#e8e8e8" : wash }]} />
        )}
        {!theme.eink && <View style={[StyleSheet.absoluteFill as any, { backgroundColor: "rgba(0,0,0,0.28)" }]} />}
        {/* page-colored wedge: bottom-left corner, full width, cuts the diagonal */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute", left: 0, bottom: -1, width: 0, height: 0,
            borderBottomWidth: slant + 1, borderBottomColor: theme.articleBg,
            borderRightWidth: winW, borderRightColor: "transparent",
          }}
        />
        {canBack && (
          <Pressable onPress={onBack} hitSlop={16} style={[s.heroBack, { top: topInset + 4 }]}>
            <Text style={[s.chevron, { color: onPhoto }]}>‹</Text>
          </Pressable>
        )}
        <View style={{ paddingHorizontal: space.lg, paddingTop: topInset + (canBack ? 52 : space.lg) }}>
          <Text style={[s.heroDate, { color: onPhoto }]}>{ed.date}</Text>
          <Text style={[s.heroSub, { color: theme.eink ? "#333" : "rgba(255,255,255,0.92)" }]}>
            {ed.weekday.toLowerCase()} · {splitAt} {splitAt === 1 ? "story" : "stories"}
            {extra?.stories.length ? ` + ${extra.stories.length} new` : ""}
          </Text>
        </View>
      </View>

      {/* LEAD STORY: the YND cover card, tucked into the wedge */}
      {lead ? (
        <Pressable style={[s.lead, { marginTop: -leadLift }]} onPress={() => onOpenArticle(0)}>
          <View style={s.catRow}>
            <View style={[s.numDot, { backgroundColor: leadColor }]}>
              <Text style={s.numDotTxt}>1</Text>
            </View>
            <Text style={[s.catLabel, { color: leadColor }]}>{CAT_LABEL[lead.cat as Cat] || "Technology"}</Text>
          </View>
          <Text style={s.leadHeadline}>{lead.headline}</Text>
          <Text style={s.rowSource}>{lead.source}</Text>
        </Pressable>
      ) : null}

      {/* THE REST OF THE EDITION — same light screen */}
      {ed.stories.map((st, i) => {
        if (i === 0) return null;
        const c = theme.catColor[st.cat as Cat] || theme.accent;
        return (
          <React.Fragment key={i}>
            {i === splitAt && extra ? (
              <View style={s.section}>
                <Text style={s.sectionLabel}>SENT SINCE 5 PM</Text>
                <Text style={s.sectionSub}>These go into tomorrow's digest.</Text>
              </View>
            ) : null}
          <Pressable style={s.row} onPress={() => onOpenArticle(i)}>
            {st.image && !theme.eink ? (
              <Image source={{ uri: st.image }} style={s.thumb} resizeMode="cover" />
            ) : null}
            <View style={{ flex: 1 }}>
              <View style={s.catRow}>
                <View style={[s.catDotSm, { backgroundColor: c }]} />
                <Text style={[s.catLabel, { color: c }]}>{CAT_LABEL[st.cat as Cat] || "Technology"}</Text>
              </View>
              <Text style={s.rowHeadline}>{st.headline}</Text>
              <Text style={s.rowSource}>{st.source}</Text>
            </View>
          </Pressable>
          </React.Fragment>
        );
      })}
    </ScrollView>
  );
}
