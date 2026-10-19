// Settings > About: version, updates, source and licenses.
import React, { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { requestUpdateCheck } from "../../updateRequests";
import { checkForUpdate, updatesSupported } from "../../updates";
import { LICENSES, SOURCE_URL } from "../licenses";
import { buildInfo } from "../version";
import { Action, DrillRow, SectionHead, StaticRow } from "./atoms";
import type { SheetSpec } from "./Sheet";
import type { SettingsStyles } from "./styles";

export const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function AboutSection({ s, openSheet }: { s: SettingsStyles; openSheet: (spec: SheetSpec) => void }) {
  const info = buildInfo();
  const supported = updatesSupported();
  const [upd, setUpd] = useState(
    supported ? "Checks for a newer build when the app opens" : "New builds come out as GitHub releases",
  );
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    setUpd("Checking for a newer build");
    const rel = await checkForUpdate();
    setBusy(false);
    if (rel) {
      setUpd(`${rel.versionName} is available · the banner at the top downloads it`);
      requestUpdateCheck();
    } else {
      setUpd(`You're on the latest version · checked ${clockTime(Date.now())}`);
    }
  };

  // Look once on open, so the line says when this build was last checked.
  useEffect(() => {
    if (supported) void check();
  }, []);

  return (
    <View>
      <SectionHead s={s} title="About" />
      <StaticRow
        s={s}
        label="Version"
        sub={`${info.kind}${info.build ? ` ${info.build}` : ""}`}
        right={<Text style={s.value}>{info.version}</Text>}
      />
      <StaticRow
        s={s}
        label="Updates"
        sub={upd}
        right={supported ? (
          <Action s={s} label="Check now" onPress={() => void check()} disabled={busy} testID="update-check" />
        ) : (
          <Action s={s} label="Releases" onPress={() => void Linking.openURL(`${SOURCE_URL}/releases`)} />
        )}
      />
      <DrillRow
        s={s} external label="Source code" sub={SOURCE_URL.replace(/^https:\/\//, "")}
        onPress={() => void Linking.openURL(SOURCE_URL)}
      />
      <DrillRow
        s={s} label="Open-source licenses" sub="MIT for the app, plus a notice for every dependency"
        testID="licenses"
        onPress={() => openSheet({
          title: "Open-source licenses",
          options: LICENSES.map((l) => ({ id: l.name, label: l.name, sub: l.license })),
        })}
      />
    </View>
  );
}
