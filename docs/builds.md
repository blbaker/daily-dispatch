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

A separate job runs the unit tests for the scripts in `scripts/ci`.

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

or create the `RELEASE_PLEASE_TOKEN` repository secret described in
`docs/releasing.md`. `release-please.yml` passes it to Release Please, and
the tags it then creates start this workflow and `release.yml`.

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

It fails unless each of the seven files above is there exactly once, is not
empty and starts with the right zip or gzip header, and it writes
`SHA256SUMS.txt` into the folder.

## Cost

The iOS build and the macOS desktop build run on macOS runners. On a private
repository, macOS minutes are billed at a higher rate than Linux minutes and
use up the Actions allowance faster. Public repositories run on standard
runners for free. Job run times will be added here from the first CI run.
