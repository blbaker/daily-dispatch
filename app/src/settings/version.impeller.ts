// Desktop (Impeller) build of version.ts. There is no expo-constants or
// expo-application on desktop, so the desktop bundle step inlines the
// version from app/app.json as EXPO_PUBLIC_APP_VERSION and
// EXPO_PUBLIC_APP_BUILD (see app/desktop/scripts/lib.mts).
import type { BuildInfo } from "./types";

export function buildInfo(): BuildInfo {
  return {
    version: process.env.EXPO_PUBLIC_APP_VERSION || "",
    build: process.env.EXPO_PUBLIC_APP_BUILD || "",
    kind: "Desktop build",
  };
}
