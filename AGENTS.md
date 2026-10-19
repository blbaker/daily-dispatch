# Instructions for AI coding agents

This is the only agent instruction file in the repo. `CLAUDE.md` points here.
Humans should read [CONTRIBUTING.md](CONTRIBUTING.md); this file covers the
same ground in the order an agent needs it.

## Layout

- `app/` -- Expo (React Native) app, phone and e-ink builds.
- `app/desktop/` -- the same app on macOS, Linux and Windows through
  `react-native-impeller-platform`. See [docs/desktop.md](docs/desktop.md).
- `backend/` -- AWS CDK stack: DynamoDB, a Lambda behind a Function URL, an
  S3 bucket for app updates and one for podcast episodes, push fan-out.
- `packages/daily-dispatch/` -- the `daily-dispatch` npm package: podcast
  script writers, voice providers, audio assembly and the CLI.
- `pipeline/` -- Python scripts that capture links, write the digest, and
  rebuild the archive app.
- `.claude/skills/` -- the `daily-digest` and `link-talk-podcast` skills.
- `tests/` -- Python unit tests for the pipeline.
- `scripts/ci/` -- build and release checks run by CI.
- `scripts/release.sh`, `scripts/publish_release.py` -- maintainer release
  scripts. Do not run them.

## Checks

None of these need credentials. Run the ones that cover what you changed.

```
pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r test
cd backend && pnpm install --frozen-lockfile --ignore-workspace && pnpm typecheck && pnpm test && pnpm exec cdk synth --quiet
cd app && npm install --legacy-peer-deps && npx tsc --noEmit
cd app/desktop && npm ci && npm run typecheck
node --test 'scripts/ci/*.test.mts'
python3 -m unittest discover -s tests
```

## How to work

- Keep files at 300 lines or fewer. If a file you need to change is over the
  limit, split it first, in its own commit, with no behavior change.
- One change per branch. Edit only what the change needs.
- Use Conventional Commits. Release Please builds the changelog from them.
- New code is TypeScript with `strict` on.
- Write the failing test first. A new check needs a test that seeds a
  violation and watches the check fail.
- Fix the root cause. No empty `catch`, and no sleeps to hide a race.
- Comments say why the code does something, not what it does.
- Visual changes need before and after screenshots in the PR.

## Keep personal data out

No secrets, home directory paths, LAN or tailnet IPs, chat or voice ids,
account ids, or deployed URLs in tracked files. Read them from environment
variables and add the variable to the matching `.env*.example` file. Before
you commit, run the greps under "Re-running the checks" in
[docs/OPEN-SOURCE-READINESS.md](docs/OPEN-SOURCE-READINESS.md).

## Do not

- Run `cdk deploy`, `cdk destroy`, or `cdk diff` against a real AWS account.
- Call paid APIs (ElevenLabs, OpenAI, Anthropic, Google, Azure, Polly) from
  tests. Mock them, or use `--dry-run`.
- Run `scripts/release.sh` or `scripts/publish_release.py`.
- `npm publish`, push tags, force-push, rewrite history, or merge a Release
  Please PR.
