// Metro config for the desktop build (platform "impeller").
//
// The app source lives one level up in ../src and is shared with the phone and
// web builds, which run on Expo SDK 54 / React Native 0.81. The desktop engine
// is compiled against React Native 0.86.2, so this project carries its own
// react-native and every bare import from ../src must resolve HERE, never from
// the phone app's node_modules. A bundle that mixed the two would load 0.81 JS
// against 0.86 native code.
const crypto = require("crypto");
const path = require("path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { withImpeller } = require("react-native-impeller-platform/src/metro-shims");
const { expoPublicEnv } = require("./babel-inline-env");

const desktopRoot = __dirname;
const appSrc = path.resolve(desktopRoot, "..", "src");
const shimDir = path.join(desktopRoot, "shims");
const anchor = path.join(desktopRoot, "index.ts");

// Packages the shared source imports that have no desktop build. Each maps to
// a small module in shims/ with a working desktop fallback. Modules that are
// only reached through src/updates.ts (expo-application, expo-file-system,
// expo-intent-launcher) need no entry: src/updates.impeller.ts replaces that
// file on this platform, so the bundle never imports them.
const ALIASES = {
  "@react-native-async-storage/async-storage": "async-storage.ts",
  "react-native-safe-area-context": "safe-area-context.tsx",
  "expo-status-bar": "status-bar.tsx",
};

const isBare = (name) => !name.startsWith(".") && !path.isAbsolute(name);

function resolveRequest(context, moduleName, platform) {
  const alias = ALIASES[moduleName];
  if (alias) return { type: "sourceFile", filePath: path.join(shimDir, alias) };
  const origin = context.originModulePath || "";
  if (isBare(moduleName) && origin && !origin.startsWith(desktopRoot + path.sep)) {
    // Resolve as if the import were written in this project.
    const fromHere = { ...context, originModulePath: anchor };
    return context.resolveRequest(fromHere, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
}

// EXPO_PUBLIC_* values are inlined at transform time (see babel.config.js).
// Metro's cache key does not include the environment, so fold the values into
// cacheVersion: a different API URL then means a fresh transform.
const envHash = crypto.createHash("sha256").update(JSON.stringify(expoPublicEnv())).digest("hex");

const config = mergeConfig(getDefaultConfig(desktopRoot), {
  projectRoot: desktopRoot,
  watchFolders: [appSrc],
  cacheVersion: `dd-desktop-${envHash.slice(0, 16)}`,
  resolver: { resolveRequest },
});

module.exports = withImpeller(config);
