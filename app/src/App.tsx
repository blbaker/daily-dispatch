import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, Pressable, ActivityIndicator, AppState,
  BackHandler, Platform, ToastAndroid,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import UpdateBanner from "./UpdateBanner";
import { makeTheme } from "./theme";
import { listEditions, apiConfigured, EditionMeta } from "./api";
import { styles } from "./appStyles";
import { Center, ErrScreen } from "./Center";
import DigestView from "./DigestView";
import ArchiveList from "./ArchiveList";

const EINK = String(process.env.EXPO_PUBLIC_EINK) === "true";

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
