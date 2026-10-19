// Licenses shown under About > Open-source licenses: the app, then every
// runtime dependency in package.json. test/settings/licenses.test.ts checks
// this list against package.json and each package's declared license.
export interface LicenseEntry {
  name: string;
  license: string;
}

export const LICENSES: LicenseEntry[] = [
  { name: "Daily Dispatch", license: "MIT" },
  { name: "@react-native-async-storage/async-storage", license: "MIT" },
  { name: "expo", license: "MIT" },
  { name: "expo-application", license: "MIT" },
  { name: "expo-constants", license: "MIT" },
  { name: "expo-file-system", license: "MIT" },
  { name: "expo-intent-launcher", license: "MIT" },
  { name: "expo-notifications", license: "MIT" },
  { name: "expo-status-bar", license: "MIT" },
  { name: "expo-system-ui", license: "MIT" },
  { name: "react", license: "MIT" },
  { name: "react-dom", license: "MIT" },
  { name: "react-native", license: "MIT" },
  { name: "react-native-safe-area-context", license: "MIT" },
  { name: "react-native-web", license: "MIT" },
];

export const SOURCE_URL = "https://github.com/blbaker/daily-dispatch";
