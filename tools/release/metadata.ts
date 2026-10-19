/**
 * Release metadata gate for the published npm package.
 *
 * npm validates almost none of package.json at publish time. A wrong
 * repository URL breaks provenance, a `files` entry that does not exist ships
 * nothing, an entry point outside `files` is missing only for installed
 * users, and a version number, once published, is burned for good. Each rule
 * below is a defect that publishes with exit 0. The rule ids are stable; the
 * test file seeds one violation per rule.
 *
 *   node tools/release/metadata.ts              # the package + release-please
 *   node tools/release/metadata.ts --tag v0.1.0 # also: the tag matches it
 */
import { checkReleasePlease } from './release-please.ts';
import {
  PACKAGE,
  collector,
  isMain,
  isRecord,
  normalizeRepoUrl,
  readIfExists,
  report,
  REPO_ROOT,
  trackedFiles,
  type Fail,
  type Finding,
} from './lib.ts';

/** What the gate needs from the repo. Tests pass an in-memory copy. */
export interface RepoView {
  read(rel: string): string | undefined;
  tracked(rel: string): boolean;
}

export function repoView(root: string): RepoView {
  const files = trackedFiles(root);
  return {
    read: (rel) => readIfExists(root, rel),
    tracked: (rel) => files.has(rel) || [...files].some((f) => f.startsWith(`${rel}/`)),
  };
}

type Pkg = Record<string, unknown>;

/** Install-time scripts run on every consumer's machine (prepare: git installs). */
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish'];
/** Directories that hold sources, tests or tooling and must never ship. */
const NEVER_SHIP = ['src', 'test', 'scripts', 'node_modules', 'tsconfig.json', 'tsconfig.build.json'];
/** Specs a registry install cannot resolve. */
const UNRESOLVABLE = /^(workspace:|file:|link:|portal:|git\+|git:|github:)|:\/\//;

export function parseJson(view: RepoView, rel: string, fail: Fail): Record<string, unknown> | undefined {
  const text = view.read(rel);
  if (text === undefined) return void fail('R0', `${rel} does not exist`);
  try {
    const doc: unknown = JSON.parse(text);
    if (isRecord(doc)) return doc;
    fail('R0', `${rel} is not a JSON object`);
  } catch (err) {
    fail('R0', `${rel} is not valid JSON: ${(err as Error).message}`);
  }
  return undefined;
}

/** Every path that bin, main, types and exports point at, without `./`. */
export function entryPoints(pkg: Pkg): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v.replace(/^\.\//, ''));
    else if (isRecord(v)) Object.values(v).forEach(walk);
  };
  [pkg.bin, pkg.main, pkg.types, pkg.exports].forEach(walk);
  return [...new Set(out)];
}

/** dist/a/b.js and dist/a/b.d.ts are built from src/a/b.ts. */
export function sourceOf(distPath: string): string | undefined {
  const m = /^dist\/(.+?)(\.d\.ts|\.js)$/.exec(distPath);
  return m ? `src/${m[1]}.ts` : undefined;
}

function covered(files: string[], p: string): boolean {
  return files.some((f) => p === f || p.startsWith(`${f}/`));
}

export function checkMetadata(view: RepoView, tag?: string): Finding[] {
  const { findings, fail } = collector();
  const dir = PACKAGE.dir;
  const pkg = parseJson(view, `${dir}/package.json`, fail);
  const manifest = parseJson(view, '.release-please-manifest.json', fail);
  const config = parseJson(view, 'release-please-config.json', fail);
  if (!pkg) return findings;
  const files = Array.isArray(pkg.files) ? pkg.files.map(String) : [];

  // R1: the name we decided on, and publishable at all.
  if (pkg.name !== PACKAGE.name) fail('R1', `name is ${JSON.stringify(pkg.name)}, expected "${PACKAGE.name}"`);
  if (pkg.private === true) fail('R1', 'package.json says "private": true, so npm refuses to publish it');

  // R2: a valid semver that matches the release-please manifest.
  const version = String(pkg.version ?? '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) fail('R2', `version "${version}" is not semver`);
  if (manifest && manifest['.'] !== version) {
    fail('R2', `version ${version} differs from .release-please-manifest.json "." (${String(manifest['.'])})`);
  }

  // R3: a license field, and the license text shipped beside it.
  const license = view.read(`${dir}/LICENSE`);
  if (typeof pkg.license !== 'string' || pkg.license === '') fail('R3', 'no "license" field');
  if (license === undefined || !view.tracked(`${dir}/LICENSE`)) fail('R3', `${dir}/LICENSE is missing or untracked`);
  else if (license !== view.read('LICENSE')) fail('R3', `${dir}/LICENSE differs from the root LICENSE`);
  else if (typeof pkg.license === 'string' && !license.startsWith(`${pkg.license} License`)) {
    fail('R3', `license is "${pkg.license}" but LICENSE starts "${license.split('\n')[0]}"`);
  }

  // R4: links. Provenance is rejected unless repository.url names the repo
  // the workflow runs in, so this is load-bearing, not cosmetic.
  const repo = isRecord(pkg.repository) ? pkg.repository : {};
  const repoUrl = normalizeRepoUrl(String(repo.url ?? ''));
  if (repoUrl !== PACKAGE.repoUrl) fail('R4', `repository.url is "${String(repo.url)}", expected ${PACKAGE.repoUrl}`);
  if (repo.directory !== dir) fail('R4', `repository.directory is "${String(repo.directory)}", expected "${dir}"`);
  if (!String(pkg.homepage ?? '').startsWith(`${PACKAGE.repoUrl}`)) fail('R4', 'homepage does not point at the repo');
  const bugs = isRecord(pkg.bugs) ? pkg.bugs.url : pkg.bugs;
  if (bugs !== `${PACKAGE.repoUrl}/issues`) fail('R4', `bugs is "${String(bugs)}", expected ${PACKAGE.repoUrl}/issues`);

  // R5: visibility and provenance are decisions; record them in the
  // artifact. A publishConfig.registry would redirect the publish.
  const pc = isRecord(pkg.publishConfig) ? pkg.publishConfig : undefined;
  if (!pc) fail('R5', 'no publishConfig: access and provenance must be declared, not defaulted');
  else {
    if (pc.access !== PACKAGE.access) fail('R5', `publishConfig.access is "${String(pc.access)}", expected "${PACKAGE.access}"`);
    if (pc.provenance !== true) fail('R5', 'publishConfig.provenance is not true');
    if ('registry' in pc) fail('R5', 'publishConfig.registry is set; it would override where the package goes');
  }

  // R6: entry points ship and are built from tracked sources.
  const entries = entryPoints(pkg);
  if (!entries.some((e) => e.endsWith('.js'))) fail('R6', 'no JavaScript entry point in bin/main/exports');
  for (const e of entries) {
    if (e === 'package.json') continue;
    if (!covered(files, e)) fail('R6', `entry point ${e} is not covered by "files", so it is not in the tarball`);
    const src = sourceOf(e);
    if (src ? !view.tracked(`${dir}/${src}`) : !view.tracked(`${dir}/${e}`)) {
      fail('R6', `entry point ${e} has no tracked source (${src ?? e})`);
    }
  }
  const bins = typeof pkg.bin === 'string' ? [pkg.bin] : isRecord(pkg.bin) ? Object.values(pkg.bin).map(String) : [];
  if (bins.length === 0) fail('R6', 'no "bin": the CLI would not be installed');
  for (const b of bins) {
    const src = sourceOf(b.replace(/^\.\//, ''));
    const first = src ? view.read(`${dir}/${src}`)?.split('\n')[0] : undefined;
    if (first !== '#!/usr/bin/env node') fail('R6', `bin ${b} source does not start with "#!/usr/bin/env node"`);
  }

  // R7: every "files" entry exists in git; README ships; nothing internal does.
  if (files.length === 0) fail('R7', 'no "files" list: npm would ship the whole directory');
  for (const f of files) {
    const probe = f === 'dist' ? 'src' : f;
    if (!view.tracked(`${dir}/${probe}`)) fail('R7', `files entry "${f}" has nothing tracked behind it (${dir}/${probe})`);
    if (NEVER_SHIP.includes(f) || f.startsWith('.')) fail('R7', `files entry "${f}" ships sources or tooling`);
  }
  if (!files.includes('README.md') || (view.read(`${dir}/README.md`)?.length ?? 0) < 200) {
    fail('R7', 'README.md is not listed in files or is missing; npmjs.com would show a blank page');
  }

  // R8: engines declared as a lower bound.
  const node = isRecord(pkg.engines) ? pkg.engines.node : undefined;
  if (typeof node !== 'string' || !/^>=\s*\d+/.test(node)) fail('R8', `engines.node is "${String(node)}", expected ">=N"`);

  // R9: no script that runs on a consumer's machine at install time.
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  for (const s of LIFECYCLE) if (s in scripts) fail('R9', `scripts.${s} would run on every consumer install`);

  // R10: every dependency resolves from the registry.
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = isRecord(pkg[field]) ? (pkg[field] as Record<string, unknown>) : {};
    for (const [name, spec] of Object.entries(deps)) {
      if (UNRESOLVABLE.test(String(spec))) fail('R10', `${field}.${name} is "${String(spec)}", which a registry install cannot resolve`);
    }
  }

  // R11: release-please bumps this version and tags it the way release.yml expects.
  if (config && manifest) checkReleasePlease(config, manifest, view, fail);

  // R12: on a release, the tag names this exact version.
  if (tag !== undefined) {
    const name = tag.replace(/^refs\/tags\//, '');
    if (name !== `v${version}`) fail('R12', `tag ${name} does not match package version ${version} (expected v${version})`);
  }
  return findings;
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--tag');
  const tag = i === -1 ? undefined : (process.argv[i + 1] ?? '');
  const findings = checkMetadata(repoView(REPO_ROOT), tag);
  const pkg = JSON.parse(readIfExists(REPO_ROOT, `${PACKAGE.dir}/package.json`) ?? '{}') as Pkg;
  const detail = `${String(pkg.name)}@${String(pkg.version)} (rules R0-R11${tag === undefined ? '' : ', R12 tag'})`;
  process.exitCode = report('RELEASE_META', findings, detail);
}
