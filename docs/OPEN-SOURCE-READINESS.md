# Open-source readiness audit

Audit of this repo before it goes public, run on 2026-10-19. It covers
`main` at `86acffa` (4 commits) and the 10 work branches that existed
locally at the time, 14 commits in all. The repo has no remote yet, so
nothing here has been published. Fixes for the HEAD findings are on the
`chore/oss-audit` branch.

## Summary

Findings, most severe first. Counts are taken at `86acffa`.

| Id | Severity | Finding | Count | Status |
|----|----------|---------|-------|--------|
| M1 | Medium | Personal references in code, comments and tests | 21 lines in 8 files | 20 fixed at HEAD, 1 kept; all still in history |
| L1 | Low | `CODEOWNERS` owner had no path pattern, so GitHub ignored it | 1 file | Fixed |
| L2 | Low | `app` and `backend` package.json had no `license` field | 2 files | Fixed |
| L3 | Low | `.gitignore` missed build output outside two paths and `.env*` variants | 1 file | Fixed |
| L4 | Low | README said `cdk deploy` prints the API key; the stack has no such output | 1 line | Fixed |
| L5 | Low | `.env*.example` files left out 10 variables the code reads | 2 files | Fixed |
| L6 | Low | `pipeline/build_ynd_app.py` was over the 300-line limit and needed an edit | 312 lines | Split to 285 |
| L7 | Low | Android application id contains the maintainer's surname | 1 line | Kept, decision below |

There were no secrets, large files, home paths, IP addresses, chat or
voice ids, account ids, deployed URLs, employer terms, or internal agent
notes, at HEAD or anywhere in history.

## Secrets over all history

```
git log -p --all | grep -cE 'AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-|BEGIN [A-Z ]*PRIVATE KEY'
git log --all --diff-filter=A --name-only --format= | grep -E '(^|/)\.env'
```

The first command finds 0 matches across all 14 commits. The only `.env`
files ever added are the three templates (`.env.pipeline.example`,
`app/.env.example`, `backend/.env.example`). The only values those
templates have ever held are defaults: a region, the local Ollama URL and
model, the `claude -p` command, and `EXPO_PUBLIC_EINK=false`.

## Large blobs

The largest blob in history is `app/package-lock.json` at 304.7 KB. The
next largest is 29.4 KB, and the whole object store is 488 KiB. Nothing
comes near GitHub's 50 MB warning. The repo tracks no images, PDFs,
binaries or fonts.

## Personal and internal info

Each check ran at every one of the 14 commits and at the new HEAD. Lock
files are left out of the text checks and checked by registry host
instead. Every check was first run against a commit seeded with a fake
value of its kind, to confirm it reports a hit.

| Check | Pattern (summary) | HEAD | History |
|-------|-------------------|------|---------|
| Home paths | `/home/<user>`, `/Users/<user>`, Windows user dirs | 0 | 0 |
| LAN and tailnet IPs | `192.168.x`, `10.x`, `172.16-31.x`, `100.64-127.x` | 0 | 0 |
| Chat ids (Discord style) | 17 to 20 digit numbers | 0 | 0 |
| Cloud account ids | 12 digit numbers | 0 | 0 |
| Voice ids (ElevenLabs style) | 20 character mixed-case ids | 0 | 0 |
| Deployed API URLs | Lambda Function URL, API Gateway, CloudFront, tailnet DNS | 0 | 0 |
| Hostnames | `.local`, `.lan`, `.internal`, `.home.arpa` | 0 | 0 |
| Lock file hosts | any host other than registry.npmjs.org | 0 | 0 |

The cloud account check skips `"123456789012"` in `.github/workflows/ci.yml`.
That value is AWS's documented placeholder account, used only so CI can run
`cdk synth`. A local `cdk synth` with no account and no credentials also
passes, so CI could drop it.

### M1: personal references

A separate check for the maintainer's own names, places, machines and
tools found 21 lines in 8 files, all added in `37578d4` (the first commit)
and still present at `86acffa`. None of them is a secret. They are listed
here by kind, without repeating the values.

| Path | What it named | Fixed in |
|------|---------------|----------|
| `tests/test_config_and_store.py` | maintainer's first name and home town, as test literals | `162474c` |
| `pipeline/build_ynd_app.py` (now `pipeline/categories.py`) | local college and pro sports teams in a keyword rule | `162474c` |
| `backend/lib/digest-stack.ts` | maintainer's name and the type of machine he runs | `162474c` |
| `backend/lambda/handler.js` | maintainer's name, and the time his digest job runs | `162474c` |
| `pipeline/config.py` | maintainer's name and his agent tool | `162474c` |
| `pipeline/pushbullet_bridge.py`, `.env.pipeline.example` | webhook env vars named after his agent tool | `162474c` |
| `pipeline/pushbullet_bridge.py` | the time his digest job runs | `f7017c0` |

The webhook variables are now `LINK_WEBHOOK_URL` and `LINK_WEBHOOK_SECRET`.
Nobody runs this copy of the pipeline yet, so the rename breaks no one.
After these commits the same check finds one line at HEAD: the README
lists the maintainer's agent tool as one example of a scheduler. That tool
is public software and the line is accurate, so it stays until the README
rewrite.

### Reviewed and kept

- **Maintainer identity.** `LICENSE` names Brandon Baker as copyright
  holder. `CODEOWNERS`, the README and CONTRIBUTING use the `blbaker`
  GitHub handle. Every commit uses a GitHub noreply address. All of this
  is meant to be public.
- **L7, the Android application id** in `app/app.json` contains the
  maintainer's surname. Changing it makes Android treat the app as a new
  app, so installed copies would stop getting in-app updates. That is the
  maintainer's call; see "Decisions for Baker" below.
- **Public service URLs** (Pushbullet, ElevenLabs, GitHub, skills.sh,
  Contributor Covenant) and the `127.0.0.1:11434` Ollama default are not
  personal.
- **The 5 PM cutoff** in the app and in `pipeline/digest_editions.py` is
  product behavior (the "sent since 5 PM" list), not personal data. Making
  it configurable belongs with the daily schedule work.
- **Product names.** Boox is the e-ink device the app targets. Yahoo News
  Digest is named as the design the app is modelled on; no Yahoo logos,
  fonts or images ship.
- **A design reference id** in an `app/src/App.tsx` comment points to a
  reference image that is not in the repo. It is harmless, and the file is
  534 lines, so it was not edited here.

## Employer terms

The check found 0 hits at HEAD and in all 14 commits. It used the maintainer's
private list of employer names, client names, codenames and ticket-key
prefixes, plus a generic ticket-key pattern (`[A-Z][A-Z0-9]{1,9}-[0-9]+`).
The private list stays out of this repo for the same reason the terms do.

## Internal agent docs

The repo has no state or handoff files, delivery notes, rescued
folders, or screenshot dumps. The two skills in `.claude/skills/`
(`daily-digest` and `link-talk-podcast`) are part of the product, the
README documents them, and they stay.

## Licenses

- The root `LICENSE` is MIT. `app/package.json` and `backend/package.json`
  had no `license` field and now say `MIT` (`b55d0f0`), along with the
  root entry in `app/package-lock.json`.
- Nothing is vendored. Dependencies come from npm and PyPI at install time,
  and the repo redistributes none of them, so it needs no
  `THIRD_PARTY_NOTICES` file today.
- Released builds do bundle third-party code (React Native, Expo, the
  Impeller engine and their dependencies). Every file attached to a GitHub
  Release now has a `THIRD_PARTY_NOTICES-<target>.txt` next to it, written
  by `scripts/ci/generate-notices.mts`; see
  [builds.md](builds.md#third-party-notices) for what it covers and its
  known gaps.

## History findings and options

M1 is the only history finding. It is in all four `main` commits from
`37578d4` on, and in every work branch, since they all start at `86acffa`.
Severity is medium at most: no secret, path, address or id, only names
and a few details about the maintainer's setup.

1. **Keep the history as it is.** This is the recommended option. The
   content is low risk and the fixes are normal commits on top.
2. **Squash to a fresh root commit before the first push.** Create the
   public repo from one commit holding the tree of `main`. This loses the
   commit history, which will include every work branch's commits by then.
3. **Run `git filter-repo --replace-text` on a fresh clone** and push the
   result to a new repo. This keeps the history but changes every SHA.

Options 2 and 3 are cheap only before the first push. Running either now
would strand the 10 work branches, so the time to do it is after they merge
and before `git push`. History rewrites are the maintainer's to run.

## Decisions for Baker

- Keep or rewrite history (options above).
- Keep or change the Android application id (L7). Changing it means
  existing installs need a manual reinstall to get updates again.

## Settings to turn on when the repo goes public

- Private vulnerability reporting (SECURITY.md tells reporters to use it).
- Squash merging as the only or default merge method (CONTRIBUTING says
  PRs are squash-merged).
- Branch protection on `main` that requires the CI checks.
- Secret scanning with push protection, and Dependabot alerts.
- GitHub Pages, once the repo is public.

## Open items for other work

- `AGENTS.md` (the single agent instruction file) and `CLAUDE.md` pointing
  to it are not in the tree yet. The tooling that writes them needs the
  maintainer's approval.
- Files still over 300 lines: `app/src/App.tsx` (534) and
  `pipeline/push_to_api.py` (355).
- `cdk synth` warns that the Lambda's `nodejs20.x` runtime is deprecated;
  AWS stops allowing new functions on it on 2027-02-01.
- The Release Please manifest starts at `0.1.0` while `app/app.json` is at
  `1.0.209`, and `scripts/release.sh` also writes `expo.version`. Two
  version writers will disagree on the first release.

## Re-running the checks

From the repo root. Each `git grep` should exit 1 (no matches).

```
git grep -nIE 'AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-|BEGIN [A-Z ]*PRIVATE KEY' HEAD -- .
git grep -nIE '/home/[a-z]|/Users/[A-Za-z]|/mnt/[a-z]/Users' HEAD -- . ':!*lock*'
git grep -nIE '192\.168\.[0-9]|(^|[^0-9.])10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|(^|[^0-9.])100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}' HEAD -- . ':!*lock*'
git grep -nIE '(^|[^0-9])[0-9]{17,20}([^0-9]|$)' HEAD -- . ':!*lock*'
git grep -nIE '(^|[^0-9])[0-9]{12}([^0-9]|$)' HEAD -- . ':!*lock*' | grep -v '"123456789012"'
git grep -hoIwE '[A-Za-z0-9]{20}' HEAD -- . ':!*lock*' | grep '[0-9]' | grep '[A-Z]' | grep '[a-z]'
git grep -nIE 'lambda-url\.|execute-api\.|cloudfront\.net|\.s3\.amazonaws\.com/|\.ts\.net' HEAD -- . ':!*lock*'
git grep -nIwE '[a-z0-9-]+\.(local|lan|internal|home\.arpa)' HEAD -- . ':!*lock*'
git ls-files -ci --exclude-standard
```

The last command should print nothing.
