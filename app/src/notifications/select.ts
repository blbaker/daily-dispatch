// Which notification channel a platform uses. iOS and Android (phone and
// e-ink builds) get Expo push tokens, the browser gets Web Push, and every
// other platform (Impeller desktop: Platform.OS is "impeller") polls
// GET /notifications/since, because unpackaged desktop apps have no OS push
// service.
import type { Channel } from "./types";

export function channelFor(os: string): Channel {
  if (os === "ios" || os === "android") return "expo";
  if (os === "web") return "webpush";
  return "poll";
}
