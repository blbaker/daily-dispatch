// Settings > Server: API URL and key for this device, and a connection
// test (GET /health, then the key against GET /settings).
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, TextInput, View } from "react-native";
import type { Theme } from "../../theme";
import { effectiveServer, testConnection, type ConnectionResult } from "../api";
import { BUILD_SERVER, settingsStore } from "../index";
import type { ServerSettings } from "../types";
import { Action, Dot, SectionHead } from "./atoms";
import type { SettingsStyles } from "./styles";

type Test = { state: "idle" } | { state: "testing" } | ConnectionResult;

function Progress({ s, eink }: { s: SettingsStyles; eink: boolean }) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (eink) return;
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [eink, x]);
  // E-ink has no motion, so it shows the status line alone.
  if (eink) return null;
  const left = x.interpolate({ inputRange: [0, 1], outputRange: ["-35%", "100%"] });
  return (
    <View style={s.track}>
      <Animated.View style={[s.fill, { marginLeft: left }]} />
    </View>
  );
}

export function ServerSection({ s, theme, server }: { s: SettingsStyles; theme: Theme; server: ServerSettings }) {
  const eff = effectiveServer(server, BUILD_SERVER);
  const [url, setUrl] = useState(eff.baseUrl);
  const [key, setKey] = useState(eff.apiKey);
  const [show, setShow] = useState(false);
  const [focus, setFocus] = useState<"url" | "key" | null>(null);
  const [test, setTest] = useState<Test>({ state: "idle" });
  const c = theme.surface;

  // Saving null keeps following the build's value; a typed value overrides it.
  const commit = (patch: Partial<ServerSettings>) => {
    settingsStore.setServer(patch).catch((e) => console.warn("settings: server not saved", e));
  };
  const saveUrl = () => url.trim() !== eff.baseUrl && commit({ apiUrl: url.trim() });
  const saveKey = () => key.trim() !== eff.apiKey && commit({ apiKey: key.trim() });

  const run = async (u = url, k = key) => {
    setTest({ state: "testing" });
    const r = await testConnection({ baseUrl: u, apiKey: k });
    setTest(r);
    // A podcast edit may have been waiting for a server that answers.
    if (r.state === "ok") void settingsStore.sync();
  };
  // Test once on open, so the section says whether the saved server works.
  useEffect(() => {
    if (eff.baseUrl) void run(eff.baseUrl, eff.apiKey);
  }, []);

  const label =
    test.state === "testing" ? "Testing" : test.state === "ok" ? "Connected"
    : test.state === "bad-key" ? "Key rejected" : test.state === "error" ? "No connection" : "Not tested";
  const detail =
    test.state === "testing" ? "Calling /health"
    : test.state === "ok" ? `/health answered in ${test.ms} ms`
    : test.state === "bad-key" ? "/health answered, but /settings refused this key"
    : test.state === "error" ? test.detail : "Test to check this device can reach your server";
  const dotColor = test.state === "ok" ? c.good : test.state === "idle" || test.state === "testing" ? c.muted : c.bad;

  return (
    <View>
      <SectionHead s={s} title="Server" scope="This device" />
      <View style={s.field}>
        <Text style={s.fieldLabel}>API URL</Text>
        <TextInput
          style={[s.input, focus === "url" && s.inputFocus]}
          value={url}
          onChangeText={setUrl}
          onFocus={() => setFocus("url")}
          onBlur={() => { setFocus(null); saveUrl(); }}
          onSubmitEditing={saveUrl}
          placeholder="https://your-server.example"
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          testID="server-url"
        />
      </View>
      <View style={s.field}>
        <Text style={s.fieldLabel}>API key</Text>
        <View style={[s.fieldRow, focus === "key" && s.fieldRowFocus]}>
          <TextInput
            style={[s.input, s.inputBare]}
            value={key}
            onChangeText={setKey}
            onFocus={() => setFocus("key")}
            onBlur={() => { setFocus(null); saveKey(); }}
            onSubmitEditing={saveKey}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoCorrect={false}
            testID="server-key"
          />
          <Action s={s} small label={show ? "Hide" : "Show"} onPress={() => setShow((v) => !v)} />
        </View>
      </View>
      <View style={s.test}>
        <Action
          s={s} label="Test connection" disabled={test.state === "testing"} testID="server-test"
          onPress={() => { saveUrl(); saveKey(); void run(); }}
        />
        {test.state === "testing" ? <Progress s={s} eink={theme.eink} /> : null}
        <View style={s.status} testID="server-status">
          {test.state === "testing" ? null : <Dot s={s} color={dotColor} />}
          <Text style={s.statusLabel}>{label}</Text>
          <Text style={s.statusDetail}>{detail}</Text>
        </View>
      </View>
    </View>
  );
}
