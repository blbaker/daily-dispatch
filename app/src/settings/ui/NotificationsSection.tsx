// Settings > Notifications. The three switches are the notifications
// module's prefs (task 6); the line under the master switch is this
// device's registration status.
import React from "react";
import { View } from "react-native";
import {
  DEFAULT_PREFS, enableNotifications, useNotificationPrefs, useNotificationStatus, type NotificationStatus,
} from "../../notifications";
import { Action, SectionHead, ToggleRow } from "./atoms";
import type { SettingsStyles } from "./styles";

function statusLine(st: NotificationStatus): string {
  switch (st.state) {
    case "registered": return "This device is registered with your server";
    case "needs-permission": return "This device has not been allowed to show notifications yet";
    case "denied": return "Blocked in this device's settings";
    case "unsupported": return st.detail || "This device can't show notifications";
    case "error": return st.detail || "This device could not register with your server";
    default: return "Not registered yet";
  }
}

export function NotificationsSection({ s, eink }: { s: SettingsStyles; eink: boolean }) {
  const { prefs, setPrefs } = useNotificationPrefs();
  const status = useNotificationStatus();
  const p = prefs ?? DEFAULT_PREFS;
  const canAsk = status.state === "needs-permission" || status.state === "off" || status.state === "error";

  const toggleMaster = async () => {
    const on = !p.enabled;
    await setPrefs({ enabled: on });
    // Browsers only show the permission prompt from a tap, so ask here.
    if (on) await enableNotifications();
  };

  const off = !p.enabled;
  return (
    <View>
      <SectionHead s={s} title="Notifications" scope="This device" />
      <ToggleRow
        s={s}
        label="Allow notifications"
        sub={statusLine(status)}
        on={p.enabled}
        onPress={() => void toggleMaster()}
        testID="notif-master"
        subNode={p.enabled && canAsk ? (
          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <Action s={s} small label="Allow on this device" onPress={() => void enableNotifications()} />
          </View>
        ) : null}
      />
      <View style={off && !eink ? s.dim : null} pointerEvents={off ? "none" : "auto"}>
        <ToggleRow
          s={s} child label="New edition" sub="When the 5 PM digest is published"
          on={p.newEdition} disabled={off} einkDisabled={off && eink}
          onPress={() => void setPrefs({ newEdition: !p.newEdition })} testID="notif-edition"
        />
        <ToggleRow
          s={s} child label="New episode" sub="When the daily podcast is ready to play"
          on={p.newEpisode} disabled={off} einkDisabled={off && eink}
          onPress={() => void setPrefs({ newEpisode: !p.newEpisode })} testID="notif-episode"
        />
      </View>
    </View>
  );
}
