/**
 * Seeded violations for the tarball gate. The unit cases build the intended
 * pack list from the tracked sources and break one thing at a time; the last
 * test runs the real `npm pack --dry-run` on the built package.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PACKAGE, REPO_ROOT, readIfExists, trackedFiles } from '../lib.ts';
import { checkPack, npmPackList, type PackInput } from '../pack.ts';

const prefix = `${PACKAGE.dir}/`;
const tracked = [...trackedFiles(REPO_ROOT)].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
const pkg = JSON.parse(readIfExists(REPO_ROOT, `${PACKAGE.dir}/package.json`) ?? '{}') as Record<string, unknown>;

/** What a correct build packs: derived from git, not from a previous pack. */
function intended(): string[] {
  const dist = tracked
    .filter((f) => /^src\/.+\.ts$/.test(f) && !f.endsWith('.d.ts'))
    .flatMap((f) => {
      const base = f.replace(/^src\//, 'dist/').replace(/\.ts$/, '');
      return [`${base}.js`, `${base}.d.ts`];
    });
  return ['package.json', 'README.md', 'LICENSE', ...dist, ...tracked.filter((f) => f.startsWith('examples/'))];
}

const input = (packed: string[]): PackInput => ({ packed, pkg, tracked });
const rulesOf = (packed: string[]): string[] => checkPack(input(packed)).map((f) => f.rule);

test('control: the intended file list passes, and it is not trivially small', () => {
  const list = intended();
  assert.ok(list.filter((f) => f.startsWith('dist/')).length >= 20, 'dist/ derived from real sources');
  assert.ok(list.some((f) => f.startsWith('examples/')), 'examples derived from real files');
  assert.deepEqual(checkPack(input(list)), []);
});

const drop = (f: string) => (l: string[]) => l.filter((x) => x !== f);
const add = (f: string) => (l: string[]) => [...l, f];
const CASES: [rule: string, title: string, mutate: (l: string[]) => string[]][] = [
  ['P0', 'the pack list is empty', () => []],
  ['P1', 'README.md is missing', drop('README.md')],
  ['P1', 'LICENSE is missing', drop('LICENSE')],
  ['P1', 'the bin target is missing', drop('dist/cli/bin.js')],
  ['P1', 'the types entry is missing', drop('dist/index.d.ts')],
  ['P2', 'a test file ships', add('test/cli.test.ts')],
  ['P2', 'a TypeScript source ships', add('src/index.ts')],
  ['P2', 'an env file ships', add('.env')],
  ['P2', 'a source map ships', add('dist/index.js.map')],
  ['P2', 'a stray tarball ships', add('daily-dispatch-0.1.0.tgz')],
  ['P3', 'one source was not built', drop('dist/podcast.js')],
  ['P3', 'one declaration was not built', drop('dist/podcast.d.ts')],
  ['P3', 'a stale build output from a deleted source ships', add('dist/removed-module.js')],
  ['P4', 'a tracked example is left out', (l) => drop(l.find((x) => x.startsWith('examples/')) ?? '')(l)],
];

for (const [rule, title, mutate] of CASES) {
  test(`${rule}: fails when ${title}`, () => {
    const rules = rulesOf(mutate(intended()));
    assert.ok(rules.includes(rule), `expected ${rule}, got [${rules.join(', ')}]`);
  });
}

// The real artifact. It needs a build; CI builds first, so there a missing
// dist/ is a failure, while locally the skip is announced with its reason.
const built = fs.existsSync(path.join(REPO_ROOT, PACKAGE.dir, 'dist', 'index.js'));
test('the real `npm pack --dry-run` lists exactly the intended files', { skip: !built && !process.env.CI ? 'dist/ not built; run pnpm -r build' : false }, () => {
  const { files } = npmPackList(path.join(REPO_ROOT, PACKAGE.dir));
  assert.deepEqual([...files].sort(), intended().sort());
});
