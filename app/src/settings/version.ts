// This build's version for Settings > About. Native builds read the
// installed package; the web export reads app.json through expo-constants.
// version.impeller.ts replaces this file in the desktop bundle.
import * as Application from "expo-application";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { EINK_BUILD } from "./index";
import type { BuildInfo } from "./types";

export function buildInfo(): BuildInfo {
  const cfg = Constants.expoConfig;
  const kind =
    Platform.OS === "android" ? (EINK_BUILD ? "Boox e-ink build" : "Phone build")
    : Platform.OS === "ios" ? "iPhone build"
    : "Web build";
  return {
    version: Application.nativeApplicationVersion ?? cfg?.version ?? "",
    build: Application.nativeBuildVersion ?? String(cfg?.android?.versionCode ?? ""),
    kind,
  };
}
