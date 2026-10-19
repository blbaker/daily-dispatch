# Releasing daily-dispatch to npm

The `daily-dispatch` package in `packages/daily-dispatch` is published by
GitHub Actions with npm trusted publishing. The repository stores no npm
token, and every release waits on npm as a staged version until a
maintainer approves it with 2FA.

## How a release works

1. Conventional commits land on `main`. Release Please opens or updates a
   release PR titled `chore(main): release X.Y.Z`. It bumps
   `.release-please-manifest.json`, the `version` in
   `packages/daily-dispatch/package.json`, and `CHANGELOG.md`.
2. A maintainer merges the release PR. Release Please creates the tag
   `vX.Y.Z` and a GitHub release.
3. The tag starts `.github/workflows/release.yml`. It runs the gates in
   `package.yml` (the same workflow every pull request runs), then the
   publish job:
   - checks that the tag matches the package version, and that the package
     metadata and the tarball contents are what we intend;
   - runs `npm publish --dry-run`;
   - when the repository variable `DD_PUBLISH_ENABLED` is `true`, runs
     `npm stage publish --provenance`. GitHub's OIDC token authenticates the
     job, and npm attaches a provenance statement.
4. The staged version stays private until a maintainer approves it.

The app's version in `app/app.json` is not part of this. `scripts/release.sh`
owns it.

## One-time setup

Do these in order. Steps 1 and 2 need your npm account with 2FA, and npm
11.15.0 or newer on your machine:

```sh
npm install -g npm@11.21.1
npm login
```

### 1. Create the package name with a throwaway staged version

`npm trust` only works on a package that already exists, and `daily-dispatch`
does not exist yet. Staging a throwaway prerelease creates the name. Reject
it right away so nothing is ever published under it.

```sh
git clone https://github.com/blbaker/daily-dispatch.git
cd daily-dispatch
pnpm install --frozen-lockfile
pnpm -r build
cd packages/daily-dispatch
npm version 0.0.0-bootstrap.0 --no-git-tag-version
npm stage publish --tag bootstrap --provenance=false
```

npm needs `--tag` for a prerelease version. `--provenance=false` is needed
here because `package.json` asks for provenance, and only a CI run can
produce it.

Then reject the staged version and put the real version back:

```sh
npm stage list daily-dispatch
npm stage reject STAGE_ID
git checkout -- package.json
```

Replace `STAGE_ID` with the ID that `npm stage list` prints for
`0.0.0-bootstrap.0`. Don't approve it.

### 2. Add the trusted publisher

Do this no more than two days before the first release: npm expires a
trusted publisher that goes unused for two days.

```sh
npm trust github daily-dispatch \
  --file release.yml \
  --repository blbaker/daily-dispatch \
  --environment npm-publish \
  --allow-stage-publish \
  --yes
npm trust list daily-dispatch
```

`npm trust` always asks for 2FA, through a link it opens in the browser.
`--allow-stage-publish` without `--allow-publish` means a workflow run can
only stage a version, never publish one directly. The same setting is on
npmjs.com under the package's Settings, Trusted publishing.

### 3. Add the GitHub secret and variable

A tag that Release Please creates with the default `GITHUB_TOKEN` does not
start other workflows, so `release.yml` would never run after a merge. Give
Release Please its own token: a fine-grained personal access token for
`blbaker/daily-dispatch` only, with Contents and Pull requests set to read and
write. Then store it, and turn publishing on:

```sh
gh secret set RELEASE_PLEASE_TOKEN --repo blbaker/daily-dispatch
gh variable set DD_PUBLISH_ENABLED --body true --repo blbaker/daily-dispatch
```

`gh secret set` prompts for the token value.

Optional, once the repository is public (private repositories need a paid
plan for this): require your approval before the publish job starts.

```sh
gh api -X PUT repos/blbaker/daily-dispatch/environments/npm-publish --input - <<EOF
{"reviewers": [{"type": "User", "id": $(gh api users/blbaker --jq .id)}]}
EOF
```

### 4. Approve the first release

The first release is 0.1.0, the version already in the files. Release Please
would otherwise propose 0.2.0, because the manifest records 0.1.0 as the
current version. The commit that set up this release config carries a
`Release-As: 0.1.0` footer to prevent that. Check the release PR's title
before you merge it. If it says anything other than 0.1.0, push this commit
to `main` and wait for the PR to update:

```sh
git commit --allow-empty -m "chore: release 0.1.0" -m "Release-As: 0.1.0"
git push origin main
```

Merge the release PR, then watch the release run. Each job's result is
listed separately:

```sh
gh run list --workflow release.yml --limit 1
gh run view RUN_ID --json jobs --jq '.jobs[] | "\(.conclusion)\t\(.name)"'
```

Replace `RUN_ID` with the ID from the first command. When `publish` succeeds,
check the staged version and approve it:

```sh
npm stage list daily-dispatch
npm stage view STAGE_ID
npm stage approve STAGE_ID
```

`npm stage view` shows the version and file list. Approve only a staged
version you expect. You can also approve on npmjs.com.

Finally, install it like a user would:

```sh
cd "$(mktemp -d)"
npm install daily-dispatch
npx daily-dispatch --help
npm audit signatures
```

`npm audit signatures` should report a verified attestation for
`daily-dispatch`.

## Every later release

Merge the release PR, then approve the staged version with
`npm stage list daily-dispatch` and `npm stage approve STAGE_ID`.

## What stops an accidental publish

- `release.yml` runs on a pushed `v*` tag and nothing else.
- The publish job needs the gates job, which calls `package.yml`.
- The staging step runs only when `DD_PUBLISH_ENABLED` is `true`. To turn
  publishing off, run
  `gh variable delete DD_PUBLISH_ENABLED --repo blbaker/daily-dispatch`.
- The trusted publisher allows staged publishing only, and each staged
  version needs a maintainer's 2FA approval.
- `tools/release/workflows-rules.ts` fails CI if a workflow change weakens
  any of the above.

## Checks you can run locally

```sh
pnpm install --frozen-lockfile
pnpm -r build
pnpm run release:check
pnpm run release:test
pnpm run release:rehearse
```

- `release:check` runs the metadata gate, the tarball gate, and the workflow
  policy plus actionlint.
- `release:test` seeds one violation per rule and checks that each gate
  fails.
- `release:rehearse` publishes the package to a throwaway registry on
  127.0.0.1, installs it by name in an empty directory, and runs the
  installed CLI. Nothing leaves your machine except the download of the
  registry server itself.
