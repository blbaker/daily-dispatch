// Builds the push providers from credentials. Loaded once per Lambda
// container, on first use, so requests that never push never touch SSM.
import { SSMClient } from "@aws-sdk/client-ssm";
import { ExpoProvider, createExpoProvider } from "./expo";
import { PushSecrets, loadPushSecrets } from "./config";
import { Log, PushProvider } from "./types";
import { WebPushSend, createWebPushProvider } from "./webpush";

export interface PushProviders {
  expo: ExpoProvider;
  webpush: PushProvider;
  /** Handed to web clients so they can subscribe; null when Web Push is off. */
  vapidPublicKey: string | null;
}

export function createProviders(
  s: PushSecrets,
  o: { fetch: typeof fetch; log: Log; webpushSend?: WebPushSend },
): PushProviders {
  const expo = createExpoProvider({ accessToken: s.EXPO_ACCESS_TOKEN, fetch: o.fetch, log: o.log });
  const webpush = createWebPushProvider({
    vapid: { publicKey: s.VAPID_PUBLIC_KEY, privateKey: s.VAPID_PRIVATE_KEY, subject: s.VAPID_SUBJECT },
    send: o.webpushSend,
    log: o.log,
  });
  return { expo, webpush, vapidPublicKey: webpush.enabled ? (s.VAPID_PUBLIC_KEY ?? null) : null };
}

/** Lazy, cached loader for the live Lambda. */
export function liveProviders(o: { fetch: typeof fetch; log: Log }): () => Promise<PushProviders> {
  let loading: Promise<PushProviders> | undefined;
  return () => {
    loading ??= loadPushSecrets(process.env, new SSMClient({}), o.log).then((s) => createProviders(s, o));
    return loading;
  };
}
