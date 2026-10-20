/**
 * Shared pieces of the release gates: the finding type, the report format,
 * and the two small parsers the gates need (a repository URL and the subset
 * of JSONPath that release-please's extra-files use).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Finding {
  rule: string;
  message: string;
}

export type Fail = (rule: string, message: string) => void;

export function collector(): { findings: Finding[]; fail: Fail } {
  const findings: Finding[] = [];
  return { findings, fail: (rule, message) => findings.push({ rule, message }) };
}

/** Repo root, from this file's location, so the gates run from any cwd. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The npm package this repo publishes. One place, so a rename is one diff. */
export const PACKAGE = {
  name: '@blbaker/daily-dispatch',
  dir: 'packages/daily-dispatch',
  repoUrl: 'https://github.com/blbaker/daily-dispatch',
  access: 'public',
} as const;

/**
 * Print every finding with its rule id, then one PASS or FAIL line, and
 * return the exit code. The PASS line names what was checked so a green run
 * carries its own evidence.
 */
export function report(gate: string, findings: Finding[], passDetail: string): number {
  for (const f of findings) console.error(`${gate}_FAIL[${f.rule}]: ${f.message}`);
  if (findings.length > 0) {
    const rules = [...new Set(findings.map((f) => f.rule))].sort().join(',');
    console.error(`${gate}_FAIL (${rules})`);
    return 1;
  }
  console.log(`${gate}_PASS ${passDetail}`);
  return 0;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `git+https://github.com/o/r.git` and friends -> `https://github.com/o/r`. */
export function normalizeRepoUrl(url: string): string {
  return url
    .trim()
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

/**
 * Resolve `$.a.b`, `$.a['b-c']` and `$.a["b"]` against a parsed JSON value.
 * That is every form release-please's extra-files use in practice. Anything
 * else throws, so an unsupported path is a loud failure rather than a silent
 * `undefined` that a comparison would then report as a mismatch.
 */
export function resolveJsonPath(doc: unknown, jsonpath: string): unknown {
  if (!jsonpath.startsWith('$')) throw new Error(`unsupported jsonpath ${jsonpath}`);
  const token = /\.([A-Za-z_$][\w$-]*)|\[(?:'([^']*)'|"([^"]*)")\]/y;
  let at = 1;
  let cur: unknown = doc;
  while (at < jsonpath.length) {
    token.lastIndex = at;
    const m = token.exec(jsonpath);
    if (!m) throw new Error(`unsupported jsonpath ${jsonpath}`);
    const key = m[1] ?? m[2] ?? m[3] ?? '';
    cur = isRecord(cur) ? cur[key] : undefined;
    at = token.lastIndex;
  }
  return cur;
}

/** Every file git knows about (index included), as repo-relative paths. */
export function trackedFiles(root: string): Set<string> {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return new Set(out.split('\0').filter(Boolean));
}

/** Read a repo file, or undefined when it does not exist. */
export function readIfExists(root: string, rel: string): string | undefined {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

/** True when this module is the script node was started with. */
export function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
}
