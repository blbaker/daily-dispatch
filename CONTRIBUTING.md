# Contributing

Thanks for taking a look. Daily Dispatch started as a personal tool, so some
choices are opinionated on purpose. This page covers how to set up a clone,
which checks to run, and how a change gets from a branch to `main`.

If you use Claude Code, Codex or another coding agent, point it at
[AGENTS.md](AGENTS.md). It has the same checks and rules in the order an
agent needs them. `CLAUDE.md` only points there.

## Set up a clone

You need Git, Node.js 24, pnpm 10 or newer, and Python 3.12 or newer. None of
the commands on this page need AWS credentials or an API key.

Fork the repository, clone your fork, and add the original as `upstream`:

```sh
git clone https://github.com/<you>/daily-dispatch.git
cd daily-dispatch
git remote add upstream https://github.com/blbaker/daily-dispatch.git
git checkout -b feat/short-description
```

The repository has several projects that install separately:

| Directory | What it is | Package manager |
|---|---|---|
| `packages/daily-dispatch/` | The podcast CLI and library | pnpm workspace at the root |
| `backend/` | The AWS CDK stack | pnpm, own lockfile |
| `app/` | The Expo app for phone, e-ink and web | npm |
| `app/desktop/` | The same app on Impeller for macOS, Linux and Windows | npm |
| `pipeline/`, `tests/` | The Python pipeline and its tests | none needed for the tests |
| `website/` | This documentation site | pnpm, own lockfile |

## Run the checks

Run the checks for the parts you changed before you open a pull request.

The npm package:

```sh
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r test
```

The backend:

```sh
cd backend
pnpm install --frozen-lockfile --ignore-workspace
pnpm typecheck
pnpm test
pnpm exec cdk synth --quiet
```

`cdk synth` renders the CloudFormation template locally. Never run
`cdk deploy`, `cdk destroy`, or `cdk diff` against a real account as part of
a contribution. Deploying is the maintainer's job.

The app:

```sh
cd app
npm ci --legacy-peer-deps
npm run typecheck
npm test
```

The desktop app:

```sh
cd app/desktop
npm ci
npm run typecheck
npm run gate
```

The gate renders the app headless with the engine for your OS and checks
the frames. See [Desktop](docs/desktop.md).

The CI scripts and the Python pipeline, from the repository root:

```sh
node --test 'scripts/ci/*.test.mts'
python3 -m py_compile pipeline/*.py scripts/*.py
python3 -m unittest discover -s tests -v
```

The docs site:

```sh
cd website
pnpm install --frozen-lockfile --ignore-workspace
pnpm build
```

The build fails on a broken link, so run it whenever you change a file in
`docs/`, `website/` or this one.

## Write a change

- Keep each branch to one change.
- Keep files at 300 lines or fewer. If a file you need to edit is over the
  limit, split it first in its own commit.
- Write new code in TypeScript with `strict` on.
- Add a test that fails before your change and passes after it.
- Read secrets and machine-specific values from environment variables, and
  add each new variable to the matching `.env*.example` file.
- Tests never call a paid API. Fake `fetch` the way the existing tests do.

## Commit messages and pull request titles

Commits and pull request titles follow
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <description>
```

Common types are `feat`, `fix`, `docs`, `chore`, `refactor`, `test` and
`ci`. Use the imperative, lowercase, with no trailing period, for example
`fix(app): correct archive card date format`.

Release Please reads these messages to pick the next version and write the
changelog, so the type matters. A pull request is squash-merged and its
title becomes the commit message on `main`. If the title check fails, rename
the pull request; you do not need to change your commits.

## What CI checks

Every pull request runs:

- the title check, for a valid Conventional Commit
- the app typecheck and unit tests
- the backend typecheck, tests and `cdk synth`
- `py_compile` and the unit tests for the pipeline
- the builds for every platform: Android, iOS simulator, web, and the
  desktop packages for Linux, macOS and Windows
- the docs site build, when `docs/`, `website/` or this file changed

The npm package has no CI job yet, so run its checks locally.

## Open a pull request

Fill in the pull request template. It asks what changed, how you checked
each part, and what you were unsure about. A change you can see in the app
needs before and after screenshots in the description. If nothing visible
changed, say so.

Release Please keeps its own release PR open on `main`. Only the maintainer
merges it, because merging it cuts the release. See
[Releasing](docs/releasing.md).

## Conduct and security

Read the [code of conduct](CODE_OF_CONDUCT.md). Report anything that looks
like a security problem the way [SECURITY.md](SECURITY.md) describes, not in
a public issue.
