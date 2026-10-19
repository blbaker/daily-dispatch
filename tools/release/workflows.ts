/**
 * Workflow gate: the policy rules (workflows-rules.ts), then actionlint.
 *
 *   node tools/release/workflows.ts [workflow-dir]
 *
 * The two layers catch different failures. The policy rules read YAML and ask
 * what each workflow is allowed to do; they cannot tell that
 * `${{ github.evnt_name }}` names a context that does not exist. actionlint is
 * the real Actions parser and catches that class. Without actionlint on PATH
 * the second layer is skipped with a printed notice, unless
 * DD_REQUIRE_ACTIONLINT=1 (set in CI), which turns the skip into a failure.
 * DD_ACTIONLINT names a binary explicitly; DD_ACTIONLINT=none simulates a
 * machine without it, so the required-but-missing path can be tested.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GUARD_VAR, checkWorkflows } from './workflows-rules.ts';
import { isMain, report, REPO_ROOT } from './lib.ts';

export function readWorkflows(dir: string): { name: string; text: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

export function findActionlint(): string | undefined {
  const named = process.env.DD_ACTIONLINT;
  if (named === 'none') return undefined;
  if (named) return named;
  const probe = spawnSync('actionlint', ['-version'], { encoding: 'utf8' });
  return probe.status === 0 ? 'actionlint' : undefined;
}

/** Returns 0 on pass or announced skip, 1 on failure. */
export function runActionlint(dir: string, files: string[]): number {
  const bin = findActionlint();
  if (!bin) {
    if (process.env.DD_REQUIRE_ACTIONLINT === '1') {
      console.error('WORKFLOW_FAIL[actionlint]: DD_REQUIRE_ACTIONLINT=1 but actionlint is not installed');
      return 1;
    }
    console.log('  SKIPPED actionlint: not installed. Expression and schema errors are NOT checked.');
    console.log('  Install it from https://github.com/rhysd/actionlint/releases, or set');
    console.log('  DD_REQUIRE_ACTIONLINT=1 to make this skip a failure.');
    return 0;
  }
  // Lint the directory under test, not the repo's own, so a test that points
  // this gate at a copy is scored against the bytes it actually changed.
  const res = spawnSync(bin, ['-no-color', ...files.map((f) => path.join(dir, f))], { encoding: 'utf8' });
  if (res.error) {
    console.error(`WORKFLOW_FAIL[actionlint]: could not run ${bin}: ${res.error.message}`);
    return 1;
  }
  if (res.status !== 0) {
    process.stderr.write(res.stdout.split('\n').slice(0, 20).join('\n'));
    console.error(`WORKFLOW_FAIL[actionlint]: exit ${String(res.status)}`);
    return 1;
  }
  console.log(`  OK actionlint (${files.length} files, expressions and schema)`);
  return 0;
}

if (isMain(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, '.github/workflows'));
  console.log(`WORKFLOW_GATE_START dir=${path.relative(REPO_ROOT, dir) || '.'}`);
  const files = readWorkflows(dir);
  const findings = checkWorkflows(files, (rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
  const policy = report('WORKFLOW_POLICY', findings, `${files.length} workflows, guard=${GUARD_VAR}`);
  const lint = policy === 0 ? runActionlint(dir, files.map((f) => f.name)) : 1;
  console.log(lint === 0 ? 'WORKFLOW_GATE_PASS' : 'WORKFLOW_GATE_FAIL');
  process.exitCode = lint;
}
