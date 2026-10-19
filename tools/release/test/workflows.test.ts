/**
 * Seeded violations for the workflow policy: one text edit per case on a copy
 * of the real workflow files. Each edit asserts that its target text exists,
 * so a mutation that no longer applies fails loudly instead of passing as a
 * "catch" that tested nothing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT } from '../lib.ts';
import { findActionlint, readWorkflows, runActionlint } from '../workflows.ts';
import { checkWorkflows, type WorkflowFile } from '../workflows-rules.ts';

const DIR = path.join(REPO_ROOT, '.github/workflows');
const exists = (rel: string): boolean => fs.existsSync(path.join(REPO_ROOT, rel));
const real = (): WorkflowFile[] => readWorkflows(DIR);

type Mutation = (files: WorkflowFile[]) => WorkflowFile[];
function sub(file: string, from: string, to: string): Mutation {
  return (files) => {
    const f = files.find((x) => x.name === file);
    assert.ok(f, `${file} exists`);
    assert.ok(f.text.includes(from), `mutation target not found in ${file}: ${JSON.stringify(from)}`);
    return files.map((x) => (x === f ? { ...x, text: x.text.replace(from, to) } : x));
  };
}
const rulesOf = (files: WorkflowFile[]): string[] => checkWorkflows(files, exists).map((f) => f.rule);

const STAGE = "        if: vars.DD_PUBLISH_ENABLED == 'true'\n        working-directory: packages/daily-dispatch\n        run: npm stage publish --provenance";
const TOP = 'permissions:\n  contents: read\n\njobs:';

test('control: the real workflows pass, and include the publish path', () => {
  const files = real();
  assert.ok(files.some((f) => f.name === 'release.yml') && files.some((f) => f.name === 'package.yml'));
  assert.deepEqual(checkWorkflows(files, exists), []);
});

const CASES: [rule: string, title: string, mutate: Mutation][] = [
  ['W0', 'the workflows directory is empty', () => []],
  ['W1', 'a workflow is not valid YAML', sub('release.yml', 'jobs:\n  gates:', 'jobs:\n  gates: [')],
  ['W1', 'a workflow has no trigger', sub('release.yml', "on:\n  push:\n    tags: ['v*']\n", '')],
  ['W2', 'a workflow switches to pull_request_target', sub('package.yml', 'on:\n  pull_request:', 'on:\n  pull_request_target:')],
  ['W3', 'release.yml also runs on a branch push', sub('release.yml', "tags: ['v*']", "tags: ['v*']\n    branches: [main]")],
  ['W3', 'release.yml gains workflow_dispatch', sub('release.yml', "tags: ['v*']", "tags: ['v*']\n  workflow_dispatch:")],
  ['W3', 'release.yml runs on pull requests', sub('release.yml', 'on:\n  push:', 'on:\n  pull_request:\n  push:')],
  ['W4', 'a PR workflow grants contents: write', sub('package.yml', 'permissions:\n  contents: read', 'permissions:\n  contents: write')],
  ['W4', 'a PR workflow drops its permissions block', sub('package.yml', 'permissions:\n  contents: read\n', '')],
  ['W5', 'the publish job no longer needs the gates', sub('release.yml', '    needs: [gates]\n', '')],
  ['W5', 'the gates job runs a copy instead of package.yml', sub('release.yml', 'uses: ./.github/workflows/package.yml', 'uses: ./.github/workflows/ci.yml')],
  ['W6', 'the guard is removed from the stage step', sub('release.yml', "        if: vars.DD_PUBLISH_ENABLED == 'true'\n", '')],
  ['W6', 'the guard is inverted', sub('release.yml', "if: vars.DD_PUBLISH_ENABLED == 'true'", "if: vars.DD_PUBLISH_ENABLED != 'true'")],
  ['W6', 'the guard is short-circuited', sub('release.yml', "if: vars.DD_PUBLISH_ENABLED == 'true'", "if: vars.DD_PUBLISH_ENABLED == 'true' || true")],
  ['W6', 'the guard names a different variable', sub('release.yml', "if: vars.DD_PUBLISH_ENABLED == 'true'", "if: vars.PUBLISH == 'true'")],
  ['W6', '--dry-run is dropped from the always-on step', sub('release.yml', 'run: npm publish --dry-run --provenance', 'run: npm publish --provenance')],
  ['W7', 'the guard becomes a ref check (always true on a tag)', sub('release.yml', "if: vars.DD_PUBLISH_ENABLED == 'true'", "if: startsWith(github.ref, 'refs/tags/v')")],
  ['W8', 'id-token: write moves to the top level', sub('release.yml', TOP, 'permissions:\n  contents: read\n  id-token: write\n\njobs:')],
  ['W8', 'the publish job loses id-token: write', sub('release.yml', '      id-token: write\n', '')],
  ['W8', 'a job that does not publish gets id-token: write', sub('package.yml', '    runs-on: ubuntu-24.04\n    timeout-minutes: 15\n    steps:', '    runs-on: ubuntu-24.04\n    timeout-minutes: 15\n    permissions:\n      id-token: write\n    steps:')],
  ['W9', 'the stage step reads an npm token secret', sub('release.yml', STAGE, `${STAGE}\n        env:\n          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`)],
  ['W9', 'any workflow references an npm secret', sub('package.yml', "DD_REQUIRE_ACTIONLINT: '1'", "DD_REQUIRE_ACTIONLINT: '1'\n          TOKEN: ${{ secrets.NPM_PUBLISH_TOKEN }}")],
  ['W10', 'the staged publish becomes a direct publish', sub('release.yml', 'run: npm stage publish --provenance', 'run: npm publish --provenance')],
  ['W10', 'an armed step deprecates a version', sub('release.yml', 'run: npm stage publish --provenance', 'run: npm deprecate daily-dispatch@0.1.0 "old"')],
  ['W11', 'npm is pinned below 11.15.0', sub('release.yml', 'npm install -g npm@11.21.1', 'npm install -g npm@11.14.2')],
  ['W11', 'npm floats on latest', sub('release.yml', 'npm install -g npm@11.21.1', 'npm install -g npm@latest')],
  ['W11', 'the npm pin is removed', sub('release.yml', '          npm install -g npm@11.21.1\n', '')],
  ['W12', 'the publish job runs Node 22', sub('release.yml', 'node-version: 24\n          registry-url', 'node-version: 22\n          registry-url')],
  ['W13', 'the tag check is removed before the publish', sub('release.yml', 'node tools/release/metadata.ts --tag "$GITHUB_REF"', 'node tools/release/metadata.ts')],
  ['W14', 'an action floats on a version tag', sub('release.yml', 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 'actions/checkout@v4')],
  ['W14', 'an action floats on a branch', sub('package.yml', 'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1', 'pnpm/action-setup@main')],
  ['W14', 'an action uses a short sha', sub('release.yml', 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', 'actions/setup-node@49933ea')],
  ['W15', 'a step runs a script that does not exist', sub('release.yml', 'node tools/release/pack.ts', 'node tools/release/pak.ts')],
  ['W16', 'package.yml is deleted', (files) => files.filter((f) => f.name !== 'package.yml')],
  ['W16', 'package.yml stops running on pull requests', sub('package.yml', 'on:\n  pull_request:\n', 'on:\n')],
  ['W16', 'package.yml can no longer be called', sub('package.yml', '  workflow_call:\n', '')],
  ['W16', 'package.yml stops running the rehearsal', sub('package.yml', '      - run: pnpm run release:rehearse\n', '')],
  ['W16', 'release:check stops requiring actionlint', sub('package.yml', "        env:\n          DD_REQUIRE_ACTIONLINT: '1'\n        run: pnpm run release:check", '        run: pnpm run release:check')],
  ['W16', 'release:test stops requiring actionlint', sub('package.yml', "        env:\n          DD_REQUIRE_ACTIONLINT: '1'\n        run: pnpm run release:test", '        run: pnpm run release:test')],
];

for (const [rule, title, mutate] of CASES) {
  test(`${rule}: fails when ${title}`, () => {
    const rules = rulesOf(mutate(real()));
    assert.ok(rules.includes(rule), `expected ${rule}, got [${rules.join(', ')}]`);
  });
}

// The second layer: an expression typo is valid YAML, so the policy rules
// pass it, and only actionlint can catch it. Both halves are asserted.
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const actionlint = findActionlint();
const lintSkip = !actionlint && process.env.DD_REQUIRE_ACTIONLINT !== '1' ? 'actionlint not installed' : false;
test('actionlint: catches an expression typo that the policy rules cannot see', { skip: lintSkip }, () => {
  assert.ok(actionlint, 'actionlint is installed (DD_REQUIRE_ACTIONLINT=1)');
  const files = sub('package.yml', 'github.event_name', 'github.evnt_name')(real());
  assert.deepEqual(rulesOf(files), [], 'policy layer passes the typo');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-wf-'));
  for (const f of files) fs.writeFileSync(path.join(tmp, f.name), f.text);
  assert.equal(runActionlint(tmp, files.map((f) => f.name)), 1, 'actionlint layer fails it');
  assert.equal(runActionlint(DIR, real().map((f) => f.name)), 0, 'and passes the real files');
});

test('actionlint: a required but missing actionlint fails; an optional one is skipped', () => {
  assert.equal(withEnv({ DD_ACTIONLINT: 'none', DD_REQUIRE_ACTIONLINT: '1' }, () => runActionlint(DIR, ['package.yml'])), 1);
  assert.equal(withEnv({ DD_ACTIONLINT: 'none', DD_REQUIRE_ACTIONLINT: undefined }, () => runActionlint(DIR, ['package.yml'])), 0);
});
