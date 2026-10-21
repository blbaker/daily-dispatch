# Releasing

A release has up to four parts, and each one has a different trigger. Only the
first is automatic.

| Part | How it is made | Who runs it |
|---|---|---|
| Version number and changelog | Release Please, from the commits on `main` | GitHub Actions, then a maintainer merges its PR |
| App files on the GitHub Release | `release-artifacts.yml`, on a `v*` tag | GitHub Actions |
| In-app Android update | `scripts/release.sh` | A maintainer, by hand |
| Docs site | `pages.yml`, on every push to `main` | GitHub Actions |

## Version and changelog

`release-please.yml` runs on every push to `main`. It reads the Conventional
Commit messages since the last release and keeps a release PR open with the
next version number and the new `CHANGELOG.md` entries:

- `fix:` bumps the patch version.
- `feat:` bumps the minor version.
- A `BREAKING CHANGE:` footer bumps the major version. While the version is
  below 1.0.0 it bumps the minor version instead.

The version lives in `.release-please-manifest.json`, and Release Please
also writes it into `expo.version` in `app/app.json`. Merging the release PR
creates the `vX.Y.Z` tag and the GitHub Release. Only a maintainer merges it.

## App files on the release

`release-artifacts.yml` builds the tagged commit for every platform and
attaches the files to the tag's GitHub Release, along with `SHA256SUMS.txt`:
the Android phone and e-ink APKs, the iOS simulator build, the web export,
and the desktop packages for Linux, macOS and Windows.

A tag that Release Please creates with the default `GITHUB_TOKEN` does not
start other workflows, so start this one by hand after merging the release
PR:

```sh
gh workflow run release-artifacts.yml -f tag=v1.2.3
```

[App builds](builds.md) covers what each job builds, how Android release
signing works, and how to run every step on your own machine.

## In-app Android updates

The Android app checks `GET /app/latest` on your backend and shows an update
banner when a newer build is there. `scripts/release.sh` publishes one:

```sh
scripts/release.sh "Short release notes"
```

It bumps `versionCode`, builds the phone and e-ink APKs, checks them, uploads
them to the release bucket from the backend stack, and keeps the newest three
releases. Pass `--no-bump` to rebuild without changing `versionCode`.

It expects:

- `ANDROID_HOME` and `JAVA_HOME` pointing at your Android SDK and JDK
- AWS credentials that can write to the release bucket
- `RELEASE_BUCKET`, the `ReleaseBucketOut` output of the backend stack
- `APK_OUT_DIR` for the built files, and optionally `APK_MIRROR_DIR` for a
  second copy

`backend/.env.example` lists these variables. An APK from a GitHub Release
can only update a copy installed through this updater when both were signed
with the same key.

## The npm package

The tag also runs `release.yml`, which stages `daily-dispatch` on npm through
trusted publishing. A maintainer approves each staged version on npmjs.com
with 2FA before it goes public. The one-time setup and the approval steps are
in [Releasing to npm](releasing-npm.md).

## Docs site

`pages.yml` builds this site from `website/` and the Markdown files in
`docs/` on every push to `main` that touches them, and deploys it to GitHub
Pages. A pull request that touches the same files only builds the site, so a
broken link fails the check before it merges. Pages has to be turned on once
in the repository settings, with GitHub Actions as the source.
