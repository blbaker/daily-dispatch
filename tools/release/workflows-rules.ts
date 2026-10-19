/**
 * Workflow policy: what a git push is allowed to cause.
 *
 * The rule in one line: a branch push or pull request runs checks; only a
 * version tag can reach the npm registry, only after the gates, only when a
 * repository variable says so, and only as a staged publish that a
 * maintainer approves with 2FA. Credentials come from OIDC, never a token.
 *
 * Every edit that breaks this looks small in a diff (a trigger, a deleted
 * `needs:`, a dropped `--dry-run`, `@v4` instead of a sha), so it is checked
 * mechanically. Rule ids are stable; the tests seed one violation per rule.
 */
import { parse } from 'yaml';
import { collector, isRecord, type Finding } from './lib.ts';

/** The one variable that arms a real publish. */
export const GUARD_VAR = 'DD_PUBLISH_ENABLED';
/** The workflow that holds the gates; release.yml must call it. */
export const GATES_WORKFLOW = 'package.yml';
/** `npm stage publish` needs npm 11.15.0 or newer. */
export const MIN_NPM: readonly [number, number, number] = [11, 15, 0];

/**
 * Commands that cannot be taken back: registry writes and infrastructure
 * changes, plus the two git pushes that rewrite or publish refs. Attaching
 * build artifacts to a GitHub Release is not on the list: a release can be
 * edited or deleted, and release-artifacts.yml validates its own tag.
 */
const IRREVERSIBLE: [RegExp, string][] = [
  [/npm\s+publish/, 'npm publish'],
  [/npm\s+stage\s+publish/, 'npm stage publish'],
  [/npm\s+(stage\s+approve|trust|deprecate|unpublish|dist-tag)/, 'npm registry change'],
  [/git\s+push[^\n]*(--force|\s-f\b|--tags|--mirror)/, 'git push (force, tags or mirror)'],
  [/cdk\s+deploy/, 'cdk deploy'],
  [/terraform\s+apply/, 'terraform apply'],
  [/aws\s+s3\s+sync[^\n]*--delete/, 'aws s3 sync --delete'],
];
const DRY = /--dry-run\b/;
const ARMED_GUARD = new RegExp(`^\\s*vars\\.${GUARD_VAR}\\s*==\\s*'true'\\s*(&&[^|]*)?$`);
const SHA_PIN = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/;

export interface WorkflowFile {
  name: string;
  text: string;
}

type Obj = Record<string, unknown>;
interface Hit {
  job: string;
  jobDef: Obj;
  stepIndex: number;
  step: Obj;
  label: string;
  armed: boolean;
}

const steps = (job: Obj): Obj[] => (Array.isArray(job.steps) ? job.steps.filter(isRecord) : []);
const needsOf = (job: Obj): string[] =>
  typeof job.needs === 'string' ? [job.needs] : Array.isArray(job.needs) ? job.needs.map(String) : [];
const stepName = (s: Obj): string => JSON.stringify(String(s.name ?? s.run ?? s.uses ?? '?').split('\n')[0]);

function triggers(doc: Obj): Obj {
  const on = doc.on;
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((t) => [String(t), null]));
  return isRecord(on) ? on : {};
}

export function checkWorkflows(files: WorkflowFile[], exists: (rel: string) => boolean): Finding[] {
  const { findings, fail } = collector();
  if (files.length === 0) {
    fail('W0', 'no workflow files: "pull requests run the gates" would have no implementation');
    return findings;
  }
  let gatesSeen = false;

  for (const { name, text } of files) {
    let doc: unknown;
    try {
      doc = parse(text);
    } catch (err) {
      fail('W1', `${name} is not valid YAML: ${(err as Error).message.split('\n')[0]}`);
      continue;
    }
    if (!isRecord(doc) || doc.on === undefined) {
      fail('W1', `${name} has no "on:" trigger block`);
      continue;
    }
    const trig = triggers(doc);
    const push = isRecord(trig.push) ? trig.push : {};
    // Tag-only means a push of tags and no other trigger at all: a
    // workflow_dispatch or schedule could start the same job from a branch.
    const tagOnly =
      Object.keys(trig).join() === 'push' && Array.isArray(push.tags) && push.tags.length > 0 && push.branches === undefined;
    const prTriggered = 'pull_request' in trig;
    const jobs = isRecord(doc.jobs) ? doc.jobs : {};

    // W2: pull_request_target runs fork code with this repo's secrets.
    if ('pull_request_target' in trig) fail('W2', `${name} uses pull_request_target; use pull_request`);

    // W4: anything a pull request can trigger declares read-only scope.
    if (prTriggered) {
      const perms = doc.permissions;
      if (perms === undefined) fail('W4', `${name} is pull_request-triggered and declares no top-level permissions`);
      else if (isRecord(perms)) {
        const writes = Object.keys(perms).filter((k) => perms[k] === 'write');
        if (writes.length) fail('W4', `${name} is pull_request-triggered and grants write: ${writes.join(', ')}`);
      } else if (perms !== 'read-all') fail('W4', `${name} is pull_request-triggered with permissions ${JSON.stringify(perms)}`);
    }

    // W8 (top level): an OIDC token is a credential; never for every job.
    if (isRecord(doc.permissions) && doc.permissions['id-token'] === 'write') {
      fail('W8', `${name} grants id-token: write at the top level; grant it on the publishing job only`);
    }

    // W9: no stored npm credential anywhere. Trusted publishing replaces it.
    for (const m of text.matchAll(/secrets\.([A-Za-z0-9_]*NPM[A-Za-z0-9_]*)|NODE_AUTH_TOKEN\s*:\s*\$\{\{\s*secrets\.(\w+)/g)) {
      fail('W9', `${name} references secrets.${m[1] ?? m[2]}; publish with trusted publishing (OIDC), not a token`);
    }

    // W14: every action pinned to a full commit sha.
    for (const [jobName, job] of Object.entries(jobs)) {
      if (!isRecord(job)) continue;
      const refs = [job.uses, ...steps(job).map((s) => s.uses)].filter((u): u is string => typeof u === 'string');
      for (const u of refs) {
        if (u.startsWith('./')) continue;
        if (u.startsWith('docker://') ? !u.includes('@sha256:') : !SHA_PIN.test(u)) {
          fail('W14', `${name}:${jobName} uses ${u}, which is not pinned to a full commit sha`);
        }
      }
      // W15: a step that runs a repo script that does not exist fails on the runner.
      for (const s of steps(job)) {
        for (const ref of String(s.run ?? '').match(/tools\/[\w./-]+\.(?:ts|sh|js|mjs)/g) ?? []) {
          if (!exists(ref)) fail('W15', `${name}:${jobName} runs ${ref}, which does not exist`);
        }
      }
    }

    const hits: Hit[] = [];
    for (const [job, jobDef] of Object.entries(jobs)) {
      if (!isRecord(jobDef)) continue;
      steps(jobDef).forEach((step, stepIndex) => {
        const run = String(step.run ?? '');
        for (const [re, label] of IRREVERSIBLE) {
          if (re.test(run)) hits.push({ job, jobDef, stepIndex, step, label, armed: !DRY.test(run) });
        }
      });
    }

    for (const h of hits) {
      const where = `${name}:${h.job} step ${stepName(h.step)}`;
      // W3: reachable only by pushing a version tag, never from a PR.
      if (!tagOnly) fail('W3', `${where} can run \`${h.label}\` but ${name} has triggers other than a tag push (${Object.keys(trig).join(', ')})`);
      if (prTriggered) fail('W3', `${where} can run \`${h.label}\` from a pull request`);

      // W5: only after the gates, which are called, not copied.
      const needs = needsOf(h.jobDef);
      const callsGates = needs.some((n) => {
        const dep = jobs[n];
        return isRecord(dep) && dep.uses === `./.github/workflows/${GATES_WORKFLOW}`;
      });
      if (!callsGates) fail('W5', `${where} can run \`${h.label}\` without needing a job that calls ${GATES_WORKFLOW}`);
      if (!h.armed) continue;

      // W6/W7: an armed command sits behind the guard, on its own step or job.
      const cond = String(h.step.if ?? h.jobDef.if ?? '').replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '');
      if (!ARMED_GUARD.test(cond)) {
        if (/github\.ref|refs\/tags/.test(cond) && !cond.includes(GUARD_VAR)) {
          fail('W7', `${where} gates \`${h.label}\` on the ref alone, which is always true on a tag workflow`);
        } else {
          fail('W6', `${where} runs \`${h.label}\` for real without "vars.${GUARD_VAR} == 'true'" as its condition (got ${JSON.stringify(cond)})`);
        }
      }
      // W10: the only armed registry write is a staged publish.
      if (h.label !== 'npm stage publish') {
        fail('W10', `${where} runs \`${h.label}\` for real; only \`npm stage publish\` may be armed`);
        continue;
      }
      checkPublishJob(h, fail, where);
    }

    // W8 (job level): only the job that stages a publish may mint a token.
    for (const [jobName, job] of Object.entries(jobs)) {
      if (!isRecord(job) || !isRecord(job.permissions) || job.permissions['id-token'] !== 'write') continue;
      if (!hits.some((h) => h.job === jobName && h.armed && h.label === 'npm stage publish')) {
        fail('W8', `${name}:${jobName} grants id-token: write but does not stage a publish`);
      }
    }

    if (name === GATES_WORKFLOW) {
      gatesSeen = true;
      checkGatesWorkflow(name, trig, jobs, fail);
    }
  }
  if (!gatesSeen) fail('W16', `${GATES_WORKFLOW} does not exist, so release.yml has no gates to call`);
  return findings;
}

/** W8/W11/W12/W13: what the job that stages the publish must also do. */
function checkPublishJob(h: Hit, fail: (rule: string, msg: string) => void, where: string): void {
  const perms = isRecord(h.jobDef.permissions) ? h.jobDef.permissions : {};
  if (perms['id-token'] !== 'write') fail('W8', `${where} stages a publish but its job lacks id-token: write`);
  const before = steps(h.jobDef).slice(0, h.stepIndex);

  const pins = before.flatMap((s) => [...String(s.run ?? '').matchAll(/npm\s+(?:install|i)\s+(?:-g|--global)\s+npm@(\S+)/g)]);
  const pin = pins.at(-1)?.[1] ?? '';
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(pin)?.slice(1).map(Number);
  const atLeast = (v: number[]): boolean => {
    for (let i = 0; i < 3; i++) if ((v[i] ?? 0) !== MIN_NPM[i]) return (v[i] ?? 0) > MIN_NPM[i]!;
    return true;
  };
  if (!parts) fail('W11', `${where}: no exact \`npm install -g npm@X.Y.Z\` before it (got ${JSON.stringify(pin)})`);
  else if (!atLeast(parts)) fail('W11', `${where}: npm ${pin} is older than ${MIN_NPM.join('.')}, which stage publish needs`);

  const node = before.find((s) => String(s.uses ?? '').startsWith('actions/setup-node@'));
  const nodeVersion = isRecord(node?.with) ? String(node.with['node-version'] ?? '') : '';
  if (!/^24(\.|$)/.test(nodeVersion)) fail('W12', `${where}: setup-node is not Node 24 (got ${JSON.stringify(nodeVersion)})`);

  const tagged = before.some((s) => /tools\/release\/metadata\.ts\s+--tag\s/.test(String(s.run ?? '')));
  if (!tagged) fail('W13', `${where}: no earlier step runs tools/release/metadata.ts --tag, so a tag could publish a different version`);
}

/** W16: the gates run on every pull request, can be called, and run the release checks. */
function checkGatesWorkflow(name: string, trig: Obj, jobs: Obj, fail: (rule: string, msg: string) => void): void {
  if (!('pull_request' in trig)) fail('W16', `${name} does not run on pull_request`);
  if (!('workflow_call' in trig)) fail('W16', `${name} has no workflow_call trigger, so release.yml cannot call it`);
  const all = Object.values(jobs).filter(isRecord).flatMap(steps);
  const runs = (re: RegExp): Obj | undefined => all.find((s) => re.test(String(s.run ?? '')));
  for (const script of ['release:test', 'release:check', 'release:rehearse']) {
    if (!runs(new RegExp(`\\b${script}\\b`))) fail('W16', `${name} never runs ${script}`);
  }
  for (const script of ['release:test', 'release:check']) {
    const step = runs(new RegExp(`\\b${script}\\b`));
    const env = isRecord(step?.env) ? step.env : {};
    if (step && String(env.DD_REQUIRE_ACTIONLINT ?? '') !== '1') {
      fail('W16', `${name} runs ${script} without DD_REQUIRE_ACTIONLINT=1, so CI could skip actionlint silently`);
    }
  }
}
