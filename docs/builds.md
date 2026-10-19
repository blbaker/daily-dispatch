# App builds and release artifacts

Two workflows build the app for every platform:

- `.github/workflows/build.yml` runs on every pull request and every push to
  `main`. Each job uploads what it built as a workflow artifact.
- `.github/workflows/release-artifacts.yml` runs on a `v*` tag. It calls
  `build.yml` for the tagged commit, checks that every file is there, and
  attaches the files plus `SHA256SUMS.txt` to the tag's GitHub Release.

Neither workflow submits to an app store, publishes an in-app update or
deploys anything.

## What gets built

| Job | Runner | File |
|-----|--------|------|
| Android APKs | `ubuntu-24.04` | `daily-dispatch-android-phone.apk`, `daily-dispatch-android-eink.apk` |
| iOS simulator app | `macos-15` | `daily-dispatch-ios-simulator.tar.gz` |
| Web export | `ubuntu-24.04` | `daily-dispatch-web.tar.gz` |
| Desktop, Linux | `ubuntu-24.04` | `daily-dispatch-linux-x64.tar.gz` |
| Desktop, macOS | `macos-15` (Apple silicon) | `daily-dispatch-darwin-arm64.tar.gz` |
| Desktop, Windows | `windows-2025` | `daily-dispatch-win32-x64.zip` |

Each job also uploads `THIRD_PARTY_NOTICES-<target>.txt` for what it built
(`android`, `ios`, `web`, `linux-x64`, `darwin-arm64`, `win32-x64`); see
[Third-party notices](#third-party-notices). A separate job runs the unit
tests for the scripts in `scripts/ci`.

CI builds have no API URL or key baked in (`EXPO_PUBLIC_API_URL` and
`EXPO_PUBLIC_API_KEY` are empty), so a downloaded build shows "API not
configured" until you build one for your own backend. The desktop packages
are made the same way as `npm run package` in `app/desktop`; see
[desktop.md](desktop.md).

## Android signing

The phone and e-ink APKs are the same app with a different JS bundle: the
e-ink one is built with `EXPO_PUBLIC_EINK=true`. Both are release builds with
the JS bundle inside, so they start without a dev server.

They are signed with your release key when these repository secrets exist:

- `ANDROID_KEYSTORE_BASE64`: the keystore file, from `base64 -w0 release.jks`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Without them, the APKs keep the debug signature of the generated project and
their names end in `-debug-signed`. That key is public, so a debug-signed APK
is fine for trying the app but not for handing out as a release. Pull request
builds always use the debug key, even when the secrets exist, because their
code has not been reviewed yet.

If `ANDROID_KEYSTORE_BASE64` is set, the job checks the other three secrets
and opens the keystore before it starts the build, so a missing or wrong
secret fails in seconds.

`scripts/ci/build-android.mts` builds both variants and then checks them. The
job fails if:

- an APK has no `assets/index.android.bundle`,
- the two APKs carry the same JS bundle (the e-ink flag did not reach one),
- a release-signed build carries the debug certificate, or a debug build
  carries some other certificate.

APKs from a GitHub Release cannot update a copy that was installed through
the in-app updater (`scripts/release.sh`) unless both were signed with the
same key.

## iOS

The iOS job makes an unsigned build for the simulator, which needs no Apple
account. To try it on a Mac with Xcode:

```bash
tar -xzf daily-dispatch-ios-simulator.tar.gz
xcrun simctl install booted DailyDispatch.app
xcrun simctl launch booted com.baker.dailydispatch
```

A build for real devices needs an Apple Developer account and is not made in
CI.

## Cutting a release

Push a version tag (`v1.2.3`, or `v1.2.3-rc.1`). The workflow builds the
tagged commit and attaches the files to the release with that name, creating
the release if it does not exist yet. Running it again for the same tag
replaces the files.

GitHub does not start workflows from a tag that another workflow pushed with
the default `GITHUB_TOKEN`. Release Please uses that token unless it is
given another one, so a tag it creates will not start this workflow on its
own. Either run it by hand:

```bash
gh workflow run release-artifacts.yml -f tag=v1.2.3
```

or give Release Please a fine-grained token with contents and pull request
write access, stored as a repository secret and passed as its `token` input.

## Running the steps locally

Every CI step runs from the repository's own scripts. From the repository
root, with Node 24:

```bash
# Unit tests for the CI scripts
node --test 'scripts/ci/*.test.mts'

# Android (needs JDK 17 and ANDROID_HOME pointing at an Android SDK)
cd app && npm ci --legacy-peer-deps
npx expo prebuild --platform android --no-install
node ../scripts/ci/build-android.mts --out dist-android

# Web
npx expo export --platform web --output-dir dist-web/daily-dispatch-web

# Desktop, for the machine you are on
cd desktop && npm ci && npm run gate && npm run package
```

`build-android.mts` signs with a release key when `ANDROID_KEYSTORE_FILE`
points at a keystore and the three password and alias variables above are
set.

To check a folder of release files the way the release job does:

```bash
node scripts/ci/release-assets.mts path/to/folder
```

It fails unless each of the seven builds above and its six notices files
are there exactly once, are not empty and start with the right zip, gzip or
notices header, and it writes `SHA256SUMS.txt` into the folder.

## Third-party notices

Every build carries other people's code, so every file attached to a release
has a `THIRD_PARTY_NOTICES-<target>.txt` next to it (the two APKs share
`THIRD_PARTY_NOTICES-android.txt`). `scripts/ci/generate-notices.mts` writes
it, early in each build job so that a license problem fails in a minute
rather than after the build. For each package it prints the name, version,
license id and full license text. The output is the same on every run for
the same installed packages.

What each file covers:

- **npm**, all targets: the production dependencies in `app/package-lock.json`
  (Android, iOS, web) or `app/desktop/package-lock.json` (desktop). Dev
  dependencies are left out. This list also names build tools such as Metro
  and Babel that do not ship in the app, which errs on the safe side.
  Packages built for one OS and CPU (npm's `os` and `cpu` fields) count only
  for the desktop target they match, which is how the Impeller engine package
  gets in and build-machine binaries such as lightningcss stay out.
- **Maven**, Android: the modules on the app's release runtime classpath
  (AndroidX, Fresco, OkHttp and so on). The generator runs a Gradle task from
  `scripts/ci/notices/android-poms.init.gradle` in `app/android`, which lists
  every module with its POM. The license comes from the POM, or from a parent
  POM when the module's own POM names none.
- **CocoaPods**, iOS: the pods in `app/ios/Podfile.lock`, with the license
  text CocoaPods collected in `Pods-<target>-acknowledgements.plist`. Both
  files only exist after `pod install`, which needs macOS, so the iOS CI job
  generates this file; it cannot be made on Linux.
- Maven modules and pods that are built from an npm package's folder (the
  Expo modules, the React Native pods) are listed as part of that package
  instead of separately.

A package passes when it declares a license and comes with its text. When a
package declares an SPDX id but ships no license file, and for Maven modules,
whose POMs only name a license, the file points to a standard text for that
id from `scripts/ci/notices/licenses/`. The run fails on a package with no
license id, or with an id that has no text and no standard text, unless
`scripts/ci/notices/allowlist.json` lists it with a reason.
[scripts/ci/notices/README.md](../scripts/ci/notices/README.md) describes
the allowlist.

Known gaps:

- The Impeller engine packages and `react-native-impeller-platform` ship no
  license files. The desktop notices use that project's LICENSE and a note on
  the components inside the engine (Impeller, Hermes, GLFW, ANGLE, Boost and
  React Native's C++ core) taken from its repository. Some components the
  engine compiles in (folly, glog, fmt, double-conversion, fast_float,
  OpenSSL on Windows, react-native-svg, stb) have no license text there yet.
- The iOS half has only run against test fixtures so far. Its first real run
  is the iOS CI job; a pod whose podspec finds no license file will need an
  allowlist entry.

To make a notices file locally, install the app's packages first:

```bash
# Android (after npx expo prebuild --platform android in app/), or web
cd app && node ../scripts/ci/generate-notices.mts --target android --out dist-android
node ../scripts/ci/generate-notices.mts --target web --out dist-web

# Desktop, for the machine you are on
cd app/desktop && node ../../scripts/ci/generate-notices.mts --target linux-x64 --out dist
```

## Cost

The iOS build and the macOS desktop build run on macOS runners. On a private
repository, macOS minutes are billed at a higher rate than Linux minutes and
use up the Actions allowance faster. Public repositories run on standard
runners for free. Job run times will be added here from the first CI run.
