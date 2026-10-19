import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, Pressable, ActivityIndicator, AppState,
  BackHandler, Platform, ToastAndroid, useColorScheme,
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
import NotificationBanner from "./NotificationBanner";
import { openEpisode, useNotifications, type OpenTarget } from "./notifications";
import { EINK_BUILD, serverNow, useSettings, useSettingsSync } from "./settings";
import SettingsScreen from "./settings/ui/SettingsScreen";

type Tab = "today" | "archive" | "settings";

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const settings = useSettings();
  useSettingsSync();
  // E-ink mode is the Boox build, or the Reading switch on any other build.
  const EINK = EINK_BUILD || !!settings?.reading.eink;
  const theme = makeTheme(EINK, {
    scheme: useColorScheme() === "dark" ? "dark" : "light",
    textScale: settings?.reading.textScale ?? 1,
  });
  const s = styles(theme);
  // The picker sheet Settings opens; drawn after the tab bar so it covers it.
  const [overlay, setOverlay] = useState<React.ReactNode>(null);
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

  const loadList = useCallback(async (): Promise<EditionMeta[] | null> => {
    try {
      setErr(null);
      const eds = await listEditions();
      setEditions(eds);
      if (eds[0]) setLatestId(eds[0].id);
      setTick((t) => t + 1);
      return eds;
    } catch (e: any) {
      setErr(apiConfigured() ? String(e.message || e) : "API not configured");
      return null;
    }
  }, []);
  // Load on launch, and again when Settings points this device at another server.
  const server = settings ? `${serverNow().baseUrl}|${serverNow().apiKey}` : null;
  useEffect(() => { if (server !== null) loadList(); }, [loadList, server]);

  // A tapped notification opens its edition (on Today when it is the newest)
  // or plays its episode. A push that arrives while the app is open refreshes
  // the list.
  const openTarget = useCallback(async (t: OpenTarget) => {
    if (t.kind === "episode") { void openEpisode(t.id); return; }
    setArticle(null);
    const eds = await loadList();
    if (eds?.[0]?.id === t.id) { setTab("today"); return; }
    setTab("archive");
    setOpenEd(t.id);
  }, [loadList]);
  useNotifications({ onOpen: openTarget, onReceive: () => { loadList(); } });

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
    if (tab === "archive" || tab === "settings") { setTab("today"); return true; }
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
    if (t === "archive") { setTab("archive"); setOpenEd(null); }
    else setTab(t);
  };

  // White status-bar icons over the photo hero and over the dark update strip.
  const heroOnTop = tab !== "settings" && !err && !(tab === "archive" && !openEd) && !!digestId && article === null;
  const lightBar = theme.scheme === "dark" || (!EINK && (bannerShown || (heroOnTop && heroUnderStatus)));

  return (
    <View style={{ flex: 1, backgroundColor: theme.articleBg }}>
      <StatusBar style={lightBar ? "light" : "dark"} />
      <UpdateBanner eink={EINK} topInset={insets.top} onVisibleChange={setBannerShown} />
      <View style={{ flex: 1 }}>
        {tab === "settings" ? (
          <SettingsScreen theme={theme} topInset={topInset} bottomInset={insets.bottom} setOverlay={setOverlay} />
        ) : err ? (
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

      {/* bottom nav: Today | Archive | Settings, padded above the system nav bar */}
      <View style={[s.tabbar, tab === "settings" && s.tabbarGutter]}>
      <View style={[s.tabRow, tab === "settings" && s.tabRowEdge, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable style={s.tab} onPress={() => switchTab("today")}>
          <Text style={[s.tabTxt, tab === "today" && s.tabActive]}>Today</Text>
        </Pressable>
        <Pressable style={s.tab} onPress={() => switchTab("archive")}>
          <Text style={[s.tabTxt, tab === "archive" && s.tabActive]}>Archive</Text>
        </Pressable>
        <Pressable style={s.tab} onPress={() => switchTab("settings")} testID="tab-settings">
          <Text style={[s.tabTxt, tab === "settings" && s.tabActive]}>Settings</Text>
        </Pressable>
      </View>
      </View>
      {tab === "settings" && overlay ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>{overlay}</View>
      ) : null}
      <NotificationBanner eink={EINK} topInset={insets.top} onOpen={openTarget} />
    </View>
  );
}
