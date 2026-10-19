// iOS and Android (phone and e-ink builds): expo-notifications. Asks for
// permission, gets an Expo push token, and turns taps into open events.
// Delivery needs credentials only Baker can create (FCM v1 key and
// google-services.json for Android, an APNs key for iOS, and an EAS project
// id); without them credential() throws and the status says why. See
// docs/push-setup.md.
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { targetFromData } from "./target";
import type { AdapterEvents, Credential, Permission, PushAdapter } from "./types";

const ANDROID_CHANNEL = "default";

// Show pushes that arrive while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return fromEnv || extra?.eas?.projectId || Constants.easConfig?.projectId || undefined;
}

export function createNativeAdapter(): PushAdapter {
  return {
    channel: "expo",
    platform: Platform.OS === "ios" ? "ios" : "android",

    async permission(prompt): Promise<Permission> {
      if (Platform.OS === "android") {
        // Android 13+ shows the permission prompt only once a channel exists.
        await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
          name: "New editions and episodes",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      let p = await Notifications.getPermissionsAsync();
      if (p.granted) return "granted";
      if (!p.canAskAgain) return "denied";
      if (!prompt) return "prompt";
      p = await Notifications.requestPermissionsAsync();
      return p.granted ? "granted" : "denied";
    },

    async credential(): Promise<Credential> {
      const id = projectId();
      if (!id) {
        throw new Error("No EAS project id: set EXPO_PUBLIC_EAS_PROJECT_ID or extra.eas.projectId (docs/push-setup.md)");
      }
      try {
        const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
        return { token: token.data };
      } catch (e) {
        // On Android this is usually a build without google-services.json.
        throw new Error(`No push token: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    listen(events: AdapterEvents) {
      const opened = (r: Notifications.NotificationResponse) => {
        const t = targetFromData(r.notification.request.content.data);
        if (t) events.open(t);
      };
      const tap = Notifications.addNotificationResponseReceivedListener(opened);
      const received = Notifications.addNotificationReceivedListener((n) =>
        events.receive((n.request.content.data ?? {}) as Record<string, string>),
      );
      // A tap that launched the app arrived before this listener existed.
      void Notifications.getLastNotificationResponseAsync().then((r) => {
        if (!r) return;
        opened(r);
        Notifications.clearLastNotificationResponse();
      });
      return () => {
        tap.remove();
        received.remove();
      };
    },
  };
}
