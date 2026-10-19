/**
 * Rule R11: the release-please wiring, checked without running release-please
 * (which needs a token and opens a real PR).
 *
 * The shape is one release-please package anchored at the repo root ("."),
 * reaching the npm package's version through extra-files. Declaring the npm
 * package as its own release-please package instead, next to ".", makes both
 * try to create the tag v<version> on every release (the duplicate-tag trap),
 * because include-component-in-tag is false so release.yml can trigger on v*.
 */
import { PACKAGE, isRecord, resolveJsonPath, type Fail } from './lib.ts';
import type { RepoView } from './metadata.ts';

export function checkReleasePlease(
  config: Record<string, unknown>,
  manifest: Record<string, unknown>,
  view: RepoView,
  fail: Fail,
): void {
  const packages = isRecord(config.packages) ? config.packages : {};
  const keys = Object.keys(packages);
  if (keys.length !== 1 || keys[0] !== '.') {
    fail('R11', `release-please declares packages [${keys.join(', ')}]; expected exactly ["."] (one tag per release)`);
  }
  const mkeys = Object.keys(manifest);
  if (mkeys.length !== 1 || mkeys[0] !== '.') fail('R11', `manifest keys are [${mkeys.join(', ')}], expected ["."]`);

  if (config['include-component-in-tag'] !== false) {
    fail('R11', 'include-component-in-tag is not false: the tag would carry a component and miss release.yml\'s v* trigger');
  }
  const root = isRecord(packages['.']) ? packages['.'] : {};
  for (const scope of [config, root]) {
    if (scope['include-v-in-tag'] === false) fail('R11', 'include-v-in-tag is false: tags would miss release.yml\'s v* trigger');
  }
  if (typeof root['release-type'] !== 'string' && typeof config['release-type'] !== 'string') {
    fail('R11', 'no release-type for "."');
  }

  const extra = Array.isArray(root['extra-files']) ? root['extra-files'] : [];
  const target = `${PACKAGE.dir}/package.json`;
  const bumpsVersion = extra.some(
    (e) => isRecord(e) && e.type === 'json' && e.path === target && e.jsonpath === '$.version',
  );
  if (!bumpsVersion) fail('R11', `extra-files does not bump ${target} $.version, so a release would publish the old version`);

  // Every json extra-file must hold the manifest version right now. A file
  // that disagrees would be rewritten on the first release, possibly
  // backwards, and nothing in release-please would say so.
  const want = manifest['.'];
  for (const e of extra) {
    if (!isRecord(e) || e.type !== 'json') continue;
    const rel = String(e.path);
    const text = view.read(rel);
    if (text === undefined) {
      fail('R11', `extra-files path ${rel} does not exist`);
      continue;
    }
    let got: unknown;
    try {
      got = resolveJsonPath(JSON.parse(text), String(e.jsonpath));
    } catch (err) {
      fail('R11', `extra-files ${rel} ${String(e.jsonpath)}: ${(err as Error).message}`);
      continue;
    }
    if (got !== want) fail('R11', `extra-files ${rel} ${String(e.jsonpath)} is ${JSON.stringify(got)}, manifest is ${JSON.stringify(want)}`);
  }
}
