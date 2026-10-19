# Desktop app (macOS, Linux, Windows)

The desktop app is the same React Native code as the phone app in `app/src`,
rendered by the Impeller engine from
[react-native-impeller-platform](https://www.npmjs.com/package/react-native-impeller-platform).
There is no Electron and no web view. The engine is a native binary that npm
installs for your OS and CPU.

Supported hosts are the ones the engine ships for: macOS on Apple silicon
(darwin-arm64), Linux x64 and Windows x64.

## How it is put together

The phone and web builds run on Expo SDK 54 with React Native 0.81. The
engine is compiled against React Native 0.86.2, so the desktop build lives in
its own small project, `app/desktop`, with its own `react-native`. Its Metro
config pulls the shared source from `app/src` and resolves every package
import from `app/desktop/node_modules`, so the phone app's copy of React
Native never ends up in a desktop bundle.

A few things the phone app uses have no desktop build. Each one has a
desktop replacement:

- `@react-native-async-storage/async-storage` maps to `shims/async-storage.ts`,
  which stores values through the engine's AppStorage module. The offline
  cache of editions works the same as on the phone.
- `react-native-safe-area-context` maps to `shims/safe-area-context.tsx`. A
  desktop window has no notch or system bars, so the insets are zero.
- `expo-status-bar` maps to `shims/status-bar.tsx`, which renders nothing.
- `src/updates.impeller.ts` replaces `src/updates.ts` on this platform. The
  phone app updates itself by downloading an APK, which needs
  `expo-application`, `expo-file-system` and `expo-intent-launcher`. The
  desktop app is updated by installing a newer release archive, so this file
  reports no update and the update banner stays hidden.
- `shims/processColor.ts` works around an engine bug. React Native's generic
  C++ platform stores the colour `transparent` as 0, which is also its
  "no colour set" value, so a transparent border was drawn in the default
  black. The shim sends a fully transparent value that is not 0.

The `EXPO_PUBLIC_*` variables (API URL, API key, e-ink flag) are inlined at
bundle time by a small Babel plugin, the same way `babel-preset-expo` does it
for the phone and web builds.

## Requirements

- Node.js 22.18 or newer (the scripts are TypeScript run by Node directly).
- Linux: an X11 or XWayland session, Mesa EGL and GLES (`libegl1`,
  `libgles2`, `libgl1-mesa-dri`), `libx11-6`, `libssl3`, `libatomic1` and
  at least one font through fontconfig.
- macOS: macOS 13 or newer on Apple silicon.
- Windows: Windows 10 or 11, x64. The engine ships its own MSVC runtime
  and ANGLE DLLs.

## Run it

From `app/`:

```bash
npm run desktop:install   # once, installs app/desktop dependencies
npm run desktop:demo      # opens the app against built-in sample editions
npm run desktop           # opens the app against your backend
```

`desktop` reads `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_API_KEY` from the shell
or from `app/.env`, the same file the phone build uses. Without them the app
shows "API not configured". `desktop:demo` needs neither: it starts a local
mock of the backend on 127.0.0.1 that serves the sample editions in
`app/desktop/fixtures`.

Extra arguments go to the engine. From `app/` they need an extra `--`
because npm forwards the call once:

```bash
npm run desktop:demo -- -- --color-scheme dark
cd desktop && npm run demo -- --width 1024 --height 768
```

## Package it

Packages are built per OS, on that OS, because the engine is native code.

```bash
cd app/desktop
npm ci
EXPO_PUBLIC_API_URL=https://your-api.example.com EXPO_PUBLIC_API_KEY=... npm run package
```

The output goes to `app/desktop/dist/`:

- Linux: `daily-dispatch-linux-x64/` with a `daily-dispatch` launcher script,
  plus `daily-dispatch-linux-x64.tar.gz`.
- Windows: `daily-dispatch-win32-x64/` with `Daily Dispatch.cmd`, plus
  `daily-dispatch-win32-x64.zip`.
- macOS: `daily-dispatch-darwin-arm64/Daily Dispatch.app`, plus
  `daily-dispatch-darwin-arm64.tar.gz`.

Each package holds the release JS bundle under `app/` and a copy of the
engine and its libraries under `engine/` (inside `Contents/Resources` for the
macOS app). Nothing else needs to be installed on the target machine apart
from the Linux system libraries listed above.

The API URL and key are baked into the bundle when you package, so a package
built for your backend should not be shared publicly.

The macOS app is not signed or notarized. That needs an Apple Developer
account. On first launch macOS will refuse to open a downloaded copy until
you allow it under System Settings, Privacy & Security.

Running `npm run package` again moves the previous output aside to
`dist/.previous-*` instead of deleting it.

## Check it

```bash
cd app/desktop
npm run typecheck   # app/src + desktop shims against React Native 0.86 types
npm run gate        # headless render check on this machine's engine
```

The gate bundles the app with a test entry, starts the mock API, and runs the
engine headless three times at 480x900:

- Today with no input: the hero photo, its slanted edge and the lead story.
- A tap on the Archive tab: the edition cards.
- A tap on the lead story: the article reader.

Each frame must be non-blank and different from the others, the app must have
fetched the latest edition from the mock API, and the offline cache must have
been written to disk. A pixel just right of the hero's slanted edge must show
the photo, which catches the transparent-border bug above. As a control, the
gate also runs a bundle that throws on startup and fails unless that run is
judged broken. It prints `DESKTOP_GATE_PASS` or `DESKTOP_GATE_FAIL` and exits
0 or 1. Frames and logs land in `app/desktop/build/gate/`.

The test entry (`gate/entry.ts`) wraps `fetch` so the engine treats an open
request as pending work. Without it a headless tap can land on the loading
spinner before the edition arrives, and the result would depend on timing.

## What has been checked

- Linux x64: gate passes, `npm run desktop:demo` opens a window under Xvfb,
  and an extracted package runs from another directory.
- Windows x64: `npm ci` and the gate pass natively on Windows, an extracted
  package renders headless, and the packaged `Daily Dispatch.cmd` opened a
  window that rendered. `npm ci`, the gate and `npm run package` also pass
  from Git Bash, the shell the Windows CI job uses.
- macOS arm64: `npm ci` and the gate pass on an M-series Mac over ssh, and the
  engine inside an extracted `Daily Dispatch.app` renders headless. The
  windowed app was not opened.

## Known gaps

- No push notifications yet. The desktop notification module is separate
  work in the engine.
- No in-app updates. Install the newer release instead.
- The app has a light theme only, so `--color-scheme dark` renders the same
  frame.
- The scroll indicator stays visible on desktop. It shows up as a thin bar
  along the right edge.
