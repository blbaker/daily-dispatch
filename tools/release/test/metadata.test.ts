/**
 * Seeded violations for the metadata gate: one per rule, each applied to an
 * in-memory copy of the real repo files. The control test runs first and
 * must pass, or no red below could be attributed to its mutation.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PACKAGE, REPO_ROOT, readIfExists, trackedFiles } from '../lib.ts';
import { checkMetadata, type RepoView } from '../metadata.ts';

// Tests edit parsed JSON freely; the gate itself is strictly typed.
type Loose = any;

const DIR = PACKAGE.dir;
const PKG = `${DIR}/package.json`;
const CONFIG = 'release-please-config.json';
const MANIFEST = '.release-please-manifest.json';
const BIN_SRC = `${DIR}/src/cli/bin.ts`;
const PATHS = [PKG, MANIFEST, CONFIG, 'LICENSE', `${DIR}/LICENSE`, `${DIR}/README.md`, BIN_SRC];

interface World {
  files: Map<string, string>;
  tracked: Set<string>;
}

function realWorld(): World {
  const files = new Map<string, string>();
  for (const p of PATHS) {
    const text = readIfExists(REPO_ROOT, p);
    if (text !== undefined) files.set(p, text);
  }
  return { files, tracked: trackedFiles(REPO_ROOT) };
}

const view = (w: World): RepoView => ({
  read: (rel) => w.files.get(rel),
  tracked: (rel) => w.tracked.has(rel) || [...w.tracked].some((f) => f.startsWith(`${rel}/`)),
});

function edit(rel: string, fn: (doc: Loose) => void): (w: World) => void {
  return (w) => {
    const doc: Loose = JSON.parse(w.files.get(rel) ?? 'null');
    fn(doc);
    w.files.set(rel, JSON.stringify(doc, null, 2));
  };
}

const rulesOf = (w: World, tag?: string): string[] => checkMetadata(view(w), tag).map((f) => f.rule);

test('control: the real repo passes every rule, with and without a matching tag', () => {
  const w = realWorld();
  assert.equal(w.files.size, PATHS.length, 'every input file was read, so the gate examined real data');
  assert.deepEqual(checkMetadata(view(w)), []);
  const version = JSON.parse(w.files.get(PKG) ?? '{}').version as string;
  assert.deepEqual(checkMetadata(view(w), `refs/tags/v${version}`), []);
  assert.deepEqual(checkMetadata(view(w), `v${version}`), []);
});

const CASES: [rule: string, title: string, mutate: (w: World) => void][] = [
  ['R0', 'package.json is not valid JSON', (w) => w.files.set(PKG, '{ "name": ')],
  ['R0', 'the release-please manifest is missing', (w) => w.files.delete(MANIFEST)],
  ['R1', 'the name changes', edit(PKG, (d) => (d.name = 'daily-dispatch-cli'))],
  ['R1', 'the package is marked private', edit(PKG, (d) => (d.private = true))],
  ['R2', 'the version is not semver', edit(PKG, (d) => (d.version = '0.1'))],
  ['R2', 'the version drifts from the manifest', edit(PKG, (d) => (d.version = '0.1.1'))],
  ['R3', 'the license field is deleted', edit(PKG, (d) => delete d.license)],
  ['R3', 'the package LICENSE file is missing', (w) => w.files.delete(`${DIR}/LICENSE`)],
  ['R3', 'the package LICENSE file is untracked', (w) => w.tracked.delete(`${DIR}/LICENSE`)],
  ['R3', 'the package LICENSE differs from the root', (w) => w.files.set(`${DIR}/LICENSE`, 'All rights reserved.\n')],
  ['R3', 'the license id disagrees with the text', edit(PKG, (d) => (d.license = 'Apache-2.0'))],
  ['R4', 'repository.url names another repo', edit(PKG, (d) => (d.repository.url = 'git+https://github.com/someone/fork.git'))],
  ['R4', 'repository.directory is dropped', edit(PKG, (d) => delete d.repository.directory)],
  ['R4', 'homepage points elsewhere', edit(PKG, (d) => (d.homepage = 'https://example.com'))],
  ['R4', 'bugs points elsewhere', edit(PKG, (d) => (d.bugs = { url: 'https://example.com/issues' }))],
  ['R5', 'access flips to restricted', edit(PKG, (d) => (d.publishConfig.access = 'restricted'))],
  ['R5', 'publishConfig is deleted (npm would default, the decision is lost)', edit(PKG, (d) => delete d.publishConfig)],
  ['R5', 'provenance is turned off', edit(PKG, (d) => (d.publishConfig.provenance = false))],
  ['R5', 'publishConfig redirects the registry', edit(PKG, (d) => (d.publishConfig.registry = 'https://registry.example.com/'))],
  ['R6', 'dist is dropped from files, so bin and exports do not ship', edit(PKG, (d) => (d.files = d.files.filter((f: string) => f !== 'dist')))],
  ['R6', 'an export points at a file with no source', edit(PKG, (d) => (d.exports['.'].default = './dist/missing.js'))],
  ['R6', 'the bin source loses its shebang', (w) => w.files.set(BIN_SRC, (w.files.get(BIN_SRC) ?? '').split('\n').slice(1).join('\n'))],
  ['R6', 'bin is deleted', edit(PKG, (d) => delete d.bin)],
  ['R7', 'files names a path that does not exist', edit(PKG, (d) => d.files.push('docs'))],
  ['R7', 'files ships the sources', edit(PKG, (d) => d.files.push('src'))],
  ['R7', 'files ships a dotfile', edit(PKG, (d) => d.files.push('.env.example'))],
  ['R7', 'README.md is dropped from files', edit(PKG, (d) => (d.files = d.files.filter((f: string) => f !== 'README.md')))],
  ['R7', 'the README is missing', (w) => w.files.delete(`${DIR}/README.md`)],
  ['R7', 'files is deleted (npm would ship everything)', edit(PKG, (d) => delete d.files)],
  ['R8', 'engines is deleted', edit(PKG, (d) => delete d.engines)],
  ['R8', 'engines.node is an exact pin', edit(PKG, (d) => (d.engines.node = '22.18.0'))],
  ['R9', 'a postinstall script appears', edit(PKG, (d) => (d.scripts.postinstall = 'node dist/setup.js'))],
  ['R9', 'a prepare script appears', edit(PKG, (d) => (d.scripts.prepare = 'tsc'))],
  ['R10', 'a dependency uses workspace:', edit(PKG, (d) => (d.dependencies = { yaml: 'workspace:*' }))],
  ['R10', 'a dependency uses file:', edit(PKG, (d) => (d.optionalDependencies = { helper: 'file:../helper' }))],
  ['R10', 'a dependency is a git URL', edit(PKG, (d) => (d.dependencies = { helper: 'https://example.com/helper.git' }))],
  ['R11', 'the npm package becomes its own release-please package (duplicate tags)', edit(CONFIG, (d) => (d.packages[DIR] = { 'release-type': 'node' }))],
  ['R11', 'include-component-in-tag is removed', edit(CONFIG, (d) => delete d['include-component-in-tag'])],
  ['R11', 'include-v-in-tag is turned off', edit(CONFIG, (d) => (d['include-v-in-tag'] = false))],
  ['R11', 'the release-type is removed', edit(CONFIG, (d) => delete d.packages['.']['release-type'])],
  ['R11', 'extra-files stops bumping the package version', edit(CONFIG, (d) => (d.packages['.']['extra-files'] = []))],
  ['R11', 'an extra-file holds a different version', edit(CONFIG, (d) => d.packages['.']['extra-files'].push({ type: 'json', path: PKG, jsonpath: '$.engines.node' }))],
  ['R11', 'an extra-file does not exist', edit(CONFIG, (d) => d.packages['.']['extra-files'].push({ type: 'json', path: 'app/missing.json', jsonpath: '$.version' }))],
  ['R11', 'an extra-file uses unsupported jsonpath', edit(CONFIG, (d) => d.packages['.']['extra-files'].push({ type: 'json', path: PKG, jsonpath: '$..version' }))],
  ['R11', 'the manifest gains a second package', edit(MANIFEST, (d) => (d[DIR] = '0.1.0'))],
];

for (const [rule, title, mutate] of CASES) {
  test(`${rule}: fails when ${title}`, () => {
    const w = realWorld();
    mutate(w);
    const rules = rulesOf(w);
    assert.ok(rules.includes(rule), `expected ${rule}, got [${rules.join(', ')}]`);
  });
}

test('R12: fails when the tag names a different version', () => {
  assert.deepEqual(rulesOf(realWorld(), 'refs/tags/v9.9.9'), ['R12']);
  assert.deepEqual(rulesOf(realWorld(), 'refs/heads/main'), ['R12']);
});
