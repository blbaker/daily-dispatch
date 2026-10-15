import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  StyleSheet, Dimensions, RefreshControl, Linking, Image, AppState,
  BackHandler, Platform, ToastAndroid, useWindowDimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import UpdateBanner from "./UpdateBanner";
import ArticleBody from "./ArticleBody";
import { makeTheme, CAT_LABEL, space, radius, Theme, Cat } from "./theme";
import {
  listEditions, getEdition, apiConfigured,
  EditionMeta, Edition, Story,
} from "./api";

const EINK = String(process.env.EXPO_PUBLIC_EINK) === "true";

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

type Tab = "today" | "archive";

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const theme = makeTheme(EINK);
  const s = styles(theme);
  // Real system-bar insets (Android draws edge-to-edge since SDK 54).
  const insets = useSafeAreaInsets();
  const [bannerShown, setBannerShown] = useState(false);
  const [heroUnderStatus, setHeroUnderStatus] = useState(true);
  // When the update banner is up it owns the top inset; screens below it don't.
  const topInset = bannerShown ? 0 : insets.top;
  const [tab, setTab] = useState<Tab>("today");
  // edition currently open in the digest view (null on archive = show the list)
  const [openEd, setOpenEd] = useState<string | null>(null);
  // article overlay index (null = not reading an article)
  const [article, setArticle] = useState<number | null>(null);
  const [latestId, setLatestId] = useState<string | null>(null);
  const [editions, setEditions] = useState<EditionMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // bumped on every list refresh so the open digest re-fetches too
  const [tick, setTick] = useState(0);

  const loadList = useCallback(async () => {
    try {
      setErr(null);
      const eds = await listEditions();
      setEditions(eds);
      if (eds[0]) setLatestId(eds[0].id);
      setTick((t) => t + 1);
    } catch (e: any) {
      setErr(apiConfigured() ? String(e.message || e) : "API not configured");
    }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  // Real-time Today: refresh whenever the app returns to the foreground, and
  // poll every 60 s while it is open (new links land via the Pushbullet bridge).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") loadList();
    });
    const iv = setInterval(() => {
      if (AppState.currentState === "active") loadList();
    }, 60000);
    return () => { sub.remove(); clearInterval(iv); };
  }, [loadList]);

  // Which edition the digest view should show for the current tab.
  // After the 5 PM digest runs, new links go into tomorrow's in-progress
  // edition. Today keeps showing today's finished digest and lists those
  // newer links underneath it, so nothing sent today leaves the Today tab.
  const localToday = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  let todayId = latestId;
  let todayExtra: string | undefined;
  if (editions && editions[0]?.inProgress && editions[0].id > localToday && editions[1]?.id === localToday) {
    todayId = editions[1].id;
    todayExtra = editions[0].id;
  }
  const digestId = tab === "today" ? todayId : openEd;
  const extraId = tab === "today" ? todayExtra : undefined;

  const goBack = () => {
    if (article !== null) { setArticle(null); return; }
    if (tab === "archive" && openEd) { setOpenEd(null); return; }
  };
  const canBack = article !== null || (tab === "archive" && !!openEd);

  // Android hardware/gesture back: walk the stack (article -> digest ->
  // archive list -> Today). On the root screen, require a second press within
  // 2 s to exit. Refs keep the handler registered once but always current.
  const backRef = useRef<() => boolean>(() => false);
  const lastBack = useRef(0);
  backRef.current = () => {
    if (article !== null) { setArticle(null); return true; }
    if (tab === "archive" && openEd) { setOpenEd(null); return true; }
    if (tab === "archive") { setTab("today"); return true; }
    const now = Date.now();
    if (now - lastBack.current < 2000) return false; // let Android exit
    lastBack.current = now;
    if (Platform.OS === "android") {
      ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT);
    }
    return true;
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => backRef.current());
    return () => sub.remove();
  }, []);

  const switchTab = (t: Tab) => {
    setArticle(null);
    if (t === "today") { setTab("today"); }
    else { setTab("archive"); setOpenEd(null); }
  };

  // White status-bar icons over the photo hero and over the dark update strip.
  const heroOnTop = !err && !(tab === "archive" && !openEd) && !!digestId && article === null;
  const lightBar = !EINK && (bannerShown || (heroOnTop && heroUnderStatus));

  return (
    <View style={{ flex: 1, backgroundColor: theme.articleBg }}>
      <StatusBar style={lightBar ? "light" : "dark"} />
      <UpdateBanner eink={EINK} topInset={insets.top} onVisibleChange={setBannerShown} />
      <View style={{ flex: 1 }}>
        {err ? (
          <ErrScreen theme={theme} err={err} onRetry={loadList} />
        ) : tab === "archive" && !openEd ? (
          <ArchiveList
            theme={theme}
            editions={editions}
            topInset={topInset}
            onOpen={(id) => setOpenEd(id)}
            onRefresh={loadList}
          />
        ) : digestId ? (
          <DigestView
            key={`${digestId}+${extraId || ""}`}
            theme={theme}
            id={digestId}
            extraId={extraId}
            tick={tick}
            topInset={topInset}
            onHeroUnderStatus={setHeroUnderStatus}
            article={article}
            onOpenArticle={(i) => setArticle(i)}
            onCloseArticle={() => setArticle(null)}
            onRefresh={loadList}
            canBack={canBack}
            onBack={goBack}
          />
        ) : (
          <Center theme={theme}><ActivityIndicator color={theme.accent} /></Center>
        )}
      </View>

      {/* bottom nav: Today | Archive — padded above the system nav bar */}
      <View style={[s.tabbar, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable style={s.tab} onPress={() => switchTab("today")}>
          <Text style={[s.tabTxt, tab === "today" && s.tabActive]}>Today</Text>
        </Pressable>
        <Pressable style={s.tab} onPress={() => switchTab("archive")}>
          <Text style={[s.tabTxt, tab === "archive" && s.tabActive]}>Archive</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ---------------- DIGEST VIEW: slanted hero + article list (one light screen) --
   Also hosts the article overlay (swipe between articles). ------------------- */
function DigestView({
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

/* ---------------- ARCHIVE LIST (cover cards, newest first) ---------------- */
function ArchiveList({
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
              <Text style={[s.edDate, { color: theme.eink ? "#000" : "#fff" }]}>{ed.date}</Text>
              <Text style={[s.edLine, { color: theme.eink ? "#333" : "rgba(255,255,255,0.9)" }]}>
                {ed.weekday} · {ed.count} {ed.count === 1 ? "link" : "links"}{ed.inProgress ? " so far" : ""}
              </Text>
              <Text style={[s.edLead, { color: theme.eink ? "#000" : "#fff" }]} numberOfLines={2}>{ed.lead}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ---------------- ARTICLE (hero + inline images, summary/divider/full, swipe) -- */
function ArticleView({
  theme, ed, index, topInset, onIndex, onBack,
}: {
  theme: Theme; ed: Edition; index: number; topInset: number;
  onIndex: (i: number) => void; onBack: () => void;
}) {
  const s = styles(theme);
  const W = Dimensions.get("window").width;
  const ref = useRef<ScrollView>(null);
  useEffect(() => { ref.current?.scrollTo({ x: index * W, animated: false }); }, [W]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.articleBg }}>
      <View style={[s.topbar, { paddingTop: topInset + space.sm }]}>
        <Pressable onPress={onBack} hitSlop={16}>
          <Text style={[s.chevronBig, { color: theme.textLight }]}>‹</Text>
        </Pressable>
        <Text style={s.topbarTitle}>{index + 1} of {ed.stories.length}</Text>
        <View style={{ width: 34 }} />
      </View>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / W);
          if (i !== index) onIndex(i);
        }}
      >
        {ed.stories.map((st, i) => (
          <ScrollView key={i} style={{ width: W }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}>
            <ArticleBody theme={theme} st={st} />
          </ScrollView>
        ))}
      </ScrollView>
    </View>
  );
}

/* ---------------- shared ---------------- */
function ErrScreen({ theme, err, onRetry }: { theme: Theme; err: string; onRetry: () => void }) {
  const s = styles(theme);
  return (
    <Center theme={theme}>
      <Text style={s.errTitle}>Can’t load digests</Text>
      <Text style={s.errBody}>{err}</Text>
      <Pressable style={s.retry} onPress={onRetry}><Text style={s.retryText}>Retry</Text></Pressable>
    </Center>
  );
}
function Center({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.articleBg, padding: space.lg }}>
      {children}
    </View>
  );
}

const FONT = "System";
function styles(t: Theme) {
  return StyleSheet.create({
    // hero (YND cover: date top-left, 32-ish bold; lowercase light dateline)
    hero: { overflow: "hidden" },
    heroBack: { position: "absolute", left: space.md, zIndex: 5 },
    heroDate: { fontSize: 34, fontWeight: "700", letterSpacing: -0.5, lineHeight: 38,
      textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 10 },
    heroSub: { fontSize: 15, fontWeight: "400", letterSpacing: 0.6, marginTop: 2,
      textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },

    // lead story card under the slant (YND cover card)
    lead: { paddingHorizontal: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: t.divider },
    numDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginRight: 8 },
    numDotTxt: { color: "#fff", fontSize: 12, fontWeight: "700" },
    leadHeadline: { fontSize: 22, fontWeight: "600", color: t.textLight, lineHeight: 28, marginTop: 4 },
    // "sent since 5 PM" divider on the Today list
    section: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: t.divider },
    sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, color: t.eink ? "#000" : t.accent },
    sectionSub: { fontSize: 13, color: t.muted, marginTop: 2 },

    // article list rows
    row: { flexDirection: "row", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: t.divider },
    thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: t.divider },
    catRow: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
    catDotSm: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
    catLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
    rowHeadline: { fontSize: 16, fontWeight: "600", color: t.textLight, lineHeight: 21 },
    rowSource: { fontSize: 12, color: t.muted, marginTop: 3 },

    // archive
    archiveTitle: { fontSize: 28, fontWeight: "800", color: t.textLight, letterSpacing: -0.5 },
    archiveSub: { fontSize: 13, color: t.muted, marginTop: 2 },
    emptyText: { color: t.muted, textAlign: "center", padding: space.xl },
    edCard: { minHeight: 200, marginBottom: t.eink ? space.md : 2, marginHorizontal: t.eink ? space.md : 0, justifyContent: "flex-end", overflow: "hidden", borderWidth: t.eink ? 1 : 0, borderColor: "#000" },
    edBody: { padding: space.lg },
    edDate: { fontSize: 40, fontWeight: "800", letterSpacing: -1, lineHeight: 42 },
    edLine: { fontSize: 13, marginTop: 4, textTransform: "capitalize" },
    edLead: { fontSize: 15, fontWeight: "600", lineHeight: 20, marginTop: 10 },
    latestBadge: { alignSelf: "flex-start", backgroundColor: t.eink ? "#000" : "#fff", color: t.eink ? "#fff" : "#121212", fontSize: 9, fontWeight: "800", letterSpacing: 1.6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, marginBottom: 8, overflow: "hidden" },

    // article view
    topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, paddingTop: 44, paddingBottom: space.sm, backgroundColor: t.articleBg, borderBottomWidth: 1, borderBottomColor: t.divider },
    topbarTitle: { fontSize: 15, fontWeight: "700", color: t.textLight },
    chevron: { fontSize: 34, fontWeight: "800", lineHeight: 34 },
    chevronBig: { fontSize: 40, fontWeight: "800", lineHeight: 40, width: 34 },

    // tabbar
    tabbar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: t.divider, backgroundColor: t.articleBg, paddingBottom: 22, paddingTop: 10 },
    tab: { flex: 1, alignItems: "center" },
    tabTxt: { fontSize: 14, fontWeight: "600", color: t.muted },
    tabActive: { color: t.eink ? "#000" : t.accent, fontWeight: "800" },

    errTitle: { color: t.textLight, fontSize: 18, fontWeight: "700", marginBottom: 6 },
    errBody: { color: t.muted, textAlign: "center" },
    retry: { marginTop: space.lg, borderWidth: 1, borderColor: t.accent, borderRadius: radius.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
    retryText: { color: t.eink ? "#000" : t.accent, fontWeight: "700" },
  });
}
