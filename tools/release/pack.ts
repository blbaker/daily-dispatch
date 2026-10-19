/**
 * Tarball gate: what `npm pack` would actually ship, compared with what we
 * intend to ship. The manifest is a claim; the pack list is the artifact.
 *
 *   pnpm -r build && node tools/release/pack.ts
 *
 * Intended contents, exactly: package.json, README.md, LICENSE, the built
 * dist/ (one .js and one .d.ts per tracked src/*.ts, nothing else) and the
 * examples/*.example.json files. A stale dist/ file from a deleted source, a
 * missing build output, a stray test file or an .env all fail here.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { entryPoints, parseJson, repoView, sourceOf } from './metadata.ts';
import { PACKAGE, collector, isMain, report, REPO_ROOT, trackedFiles, type Finding } from './lib.ts';

const ALWAYS = ['package.json', 'README.md', 'LICENSE'];
const ALLOWED = [/^(package\.json|README\.md|LICENSE)$/, /^dist\/.+\.(js|d\.ts)$/, /^examples\/[^/]+\.example\.json$/];

export interface PackInput {
  /** Paths from `npm pack --dry-run --json`, relative to the package. */
  packed: string[];
  pkg: Record<string, unknown>;
  /** Tracked files under the package directory, relative to it. */
  tracked: string[];
}

export function checkPack({ packed, pkg, tracked }: PackInput): Finding[] {
  const { findings, fail } = collector();
  const ships = new Set(packed);
  if (ships.size === 0) {
    fail('P0', 'the pack list is empty; nothing was examined');
    return findings;
  }

  // P1: the files every install needs, including what bin/main/exports name.
  for (const f of [...ALWAYS, ...entryPoints(pkg)]) {
    if (!ships.has(f)) fail('P1', `${f} is not in the tarball`);
  }

  // P2: nothing outside the intended shapes.
  for (const f of packed) {
    if (!ALLOWED.some((re) => re.test(f))) fail('P2', `${f} would ship but is not an intended file`);
  }

  // P3: dist/ is exactly the build of the tracked sources.
  const sources = tracked.filter((f) => /^src\/.+\.ts$/.test(f) && !f.endsWith('.d.ts'));
  for (const src of sources) {
    const base = src.replace(/^src\//, 'dist/').replace(/\.ts$/, '');
    for (const out of [`${base}.js`, `${base}.d.ts`]) {
      if (!ships.has(out)) fail('P3', `${out} (built from ${src}) is not in the tarball; build first`);
    }
  }
  const known = new Set(sources);
  for (const f of packed) {
    const src = f.startsWith('dist/') ? sourceOf(f) : undefined;
    if (src && !known.has(src)) fail('P3', `${f} has no tracked source (${src}); stale build output`);
  }

  // P4: every tracked example ships.
  for (const ex of tracked.filter((f) => f.startsWith('examples/'))) {
    if (!ships.has(ex)) fail('P4', `${ex} is tracked but not in the tarball`);
  }
  return findings;
}

/** Run `npm pack --dry-run --json` and return the file paths it lists. */
export function npmPackList(pkgDir: string): { files: string[]; size: number } {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: pkgDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [entry] = JSON.parse(out) as { files: { path: string }[]; unpackedSize: number }[];
  if (!entry) throw new Error('npm pack --json printed no entry');
  return { files: entry.files.map((f) => f.path), size: entry.unpackedSize };
}

if (isMain(import.meta.url)) {
  const { fail, findings } = collector();
  const pkg = parseJson(repoView(REPO_ROOT), `${PACKAGE.dir}/package.json`, fail) ?? {};
  const prefix = `${PACKAGE.dir}/`;
  const tracked = [...trackedFiles(REPO_ROOT)].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
  const { files, size } = npmPackList(path.join(REPO_ROOT, PACKAGE.dir));
  findings.push(...checkPack({ packed: files, pkg, tracked }));
  process.exitCode = report('RELEASE_PACK', findings, `${files.length} files, ${(size / 1024).toFixed(1)} kB unpacked`);
}
