# Contributing to Daily Dispatch

Thanks for taking a look at this. It started as a personal tool, so a few
things are opinionated on purpose. This doc covers how to get set up, how
the branch and commit flow works, and what CI checks before a PR can merge.

## Getting set up

You need git, Node 24, pnpm 10 or newer, and Python 3.12 or newer. The
commands below are the ones a fresh clone was checked with; none of them
need AWS credentials or any API key.

Fork the repo, clone your fork, and add the upstream remote:

```
git clone https://github.com/<you>/daily-dispatch.git
cd daily-dispatch
git remote add upstream https://github.com/blbaker/daily-dispatch.git
```

Create a branch off `main` for your change:

```
git checkout -b feat/short-description
```

### App

```
cd app
npm install --legacy-peer-deps
cp .env.example .env   # fill in your own API URL/key, or leave blank to browse the UI with no data
npx tsc --noEmit        # typecheck
npm run web              # run it in a browser
```

### Backend

```
cd backend
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit  # typecheck
pnpm exec cdk synth     # renders the CloudFormation template, no AWS credentials needed
```

Never run `cdk deploy`, `cdk diff` against a real account, or `cdk destroy`
as part of a contribution. Those are the maintainer's call, run by hand,
against their own AWS account.

### Pipeline (Python)

```
cd pipeline
python3 -m py_compile *.py
cd ..
python3 -m unittest discover -s tests -v
```

No virtualenv is required for the pure-parser scripts; `pushbullet_bridge.py`
needs `websocket-client` if you're running the live listener, but that's
not required to run the tests.

## Branch and commit conventions

Commit messages (and PR titles) follow
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <description>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`.
Use the imperative, lowercase, no trailing period: `fix(app): correct
archive card date format`, not `Fixed a bug.`

This matters here specifically because [release-please](https://github.com/googleapis/release-please)
reads these commits to decide the next version number and write the
changelog. A PR titled `feat: add dark mode` becomes a minor version bump;
`fix: ...` becomes a patch; anything with a `BREAKING CHANGE:` footer
becomes a major bump. CI checks that your PR title is a valid Conventional
Commit -- if it fails, just rename the PR title, no need to force-push.

Squash-merge your PR (the default in this repo) so the PR title becomes the
commit message on `main`.

## What CI checks

Every PR runs:

- **PR title check** -- your PR title must be a valid Conventional Commit.
- **App typecheck** -- `tsc --noEmit` in `app/`.
- **Backend typecheck + synth** -- `tsc --noEmit` and `cdk synth` in
  `backend/`, no AWS credentials, no deploy.
- **Python checks** -- `py_compile` on every pipeline script, plus the unit
  tests in `tests/`.

Run the same commands locally before opening a PR; it's faster than
waiting on the workflow.

## Opening a PR

Use the PR template -- it asks what changed, how you verified it, and
whether the UI changed. On that last point: this repo's maintainer treats
any visual change to the app as something that needs a screenshot in the
PR description. If your change doesn't touch the UI, say so; if it does,
attach before/after screenshots.

## Scope of a release

[release-please](https://github.com/googleapis/release-please) opens a
release PR automatically once there are release-worthy commits on `main`.
That PR is maintainer-only to merge -- it's how the changelog and version
number get finalized. Merging it doesn't publish or deploy anything; there
is no publish step in this repo's CI. APKs are built and uploaded by the
maintainer with `scripts/release.sh`, by hand.

## Code of conduct and security

See `CODE_OF_CONDUCT.md` for how we expect people to treat each other here,
and `SECURITY.md` if you've found something that looks like a security
issue rather than a regular bug.
