/**
 * Local registry rehearsal: publish the package to a throwaway verdaccio on
 * 127.0.0.1, install it BY NAME into an empty directory, and run the
 * installed CLI. This is the real publish path (same `npm publish`, same
 * metadata, same resolution) with nothing leaving the machine.
 *
 *   node tools/release/rehearse.ts        # DD_REHEARSAL_PORT overrides 4879
 *
 * Safety, because this script runs `npm publish`:
 * - the registry URL must parse to a loopback host, checked before anything;
 * - if something already answers on the port, it stops: it never publishes
 *   into a registry it did not start;
 * - every npm call gets a throwaway user and global .npmrc plus its own
 *   cache, so ~/.npmrc and any registry credentials are never read;
 * - the verdaccio config has no uplinks, so an install that needs anything
 *   not published here fails instead of reaching the public registry.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PACKAGE, REPO_ROOT, isMain } from './lib.ts';

const VERDACCIO = 'verdaccio@6.10.6';
const PORT = Number(process.env.DD_REHEARSAL_PORT ?? 4879);
const LISTEN = `127.0.0.1:${PORT}`;
const REGISTRY = `http://${LISTEN}/`;
const PKG_DIR = path.join(REPO_ROOT, PACKAGE.dir);

class RehearsalError extends Error {}
const fail = (msg: string): never => {
  throw new RehearsalError(msg);
};

export function assertLoopback(url: string): void {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || (net.isIPv4(host) && host.startsWith('127.')) || host === '::1';
  if (!loopback) fail(`registry ${url} is not on a loopback address; refusing to publish there`);
}

async function ping(timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`${REGISTRY}-/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false; // connection refused or timed out: nothing is serving yet
  }
}

function writeConfig(work: string): string {
  const cfg = path.join(work, 'verdaccio.yaml');
  fs.writeFileSync(
    cfg,
    [
      `storage: ${path.join(work, 'storage')}`,
      'auth:',
      '  htpasswd:',
      `    file: ${path.join(work, 'htpasswd')}`,
      '    max_users: -1',
      'uplinks: {}',
      'packages:',
      "  '**':",
      '    access: $all',
      '    publish: $anonymous',
      'web:',
      '  enable: false',
      'max_body_size: 50mb',
      'log: { type: stdout, format: pretty, level: warn }',
      '',
    ].join('\n'),
  );
  return cfg;
}

/** Environment for every npm call: throwaway config, cache and registry. */
function npmEnv(work: string): NodeJS.ProcessEnv {
  const userrc = path.join(work, 'npmrc');
  const globalrc = path.join(work, 'npmrc-global');
  fs.writeFileSync(userrc, `registry=${REGISTRY}\n//${LISTEN}/:_authToken=rehearsal-only\n`);
  fs.writeFileSync(globalrc, '');
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(npm_config_|NPM_CONFIG_)/i.test(k) || /NPM_TOKEN|NODE_AUTH_TOKEN|_API_KEY$/.test(k)) delete env[k];
  }
  return {
    ...env,
    NPM_CONFIG_USERCONFIG: userrc,
    NPM_CONFIG_GLOBALCONFIG: globalrc,
    NPM_CONFIG_REGISTRY: REGISTRY,
    NPM_CONFIG_CACHE: path.join(work, 'npm-cache'),
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_AUDIT: 'false',
  };
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, show = true): string {
  const res = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  if (show) console.log(`\n$ ${[cmd, ...args].join(' ')}\n${out}`);
  if (res.status !== 0) fail(`${cmd} ${args.join(' ')} exited ${String(res.status)}${show ? '' : `\n${out}`}`);
  return out;
}

function startRegistry(work: string, log: string): ChildProcess {
  const fd = fs.openSync(log, 'a');
  // verdaccio itself comes from the public registry, so this one call keeps
  // the default registry, but still reads no user .npmrc and no tokens.
  const empty = path.join(work, 'npmrc-empty');
  fs.writeFileSync(empty, '');
  const env = Object.fromEntries(Object.entries(npmEnv(work)).filter(([k]) => !/^NPM_CONFIG_(REGISTRY|CACHE)$/.test(k)));
  // detached: the server gets its own process group, which cleanup kills.
  const child = spawn('npx', ['--yes', VERDACCIO, '--config', writeConfig(work), '--listen', LISTEN], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...env, NPM_CONFIG_USERCONFIG: empty },
  });
  fs.closeSync(fd);
  return child;
}

async function stopRegistry(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  const pgid = (pid: number): string => spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  // Kill the group only if it is not ours; otherwise kill just the child.
  if (pgid(child.pid) !== '' && pgid(child.pid) !== pgid(process.pid)) process.kill(-child.pid, 'SIGTERM');
  else child.kill('SIGTERM');
  for (let i = 0; i < 50 && (await ping(200)); i++) await new Promise((r) => setTimeout(r, 100));
}

async function waitReady(log: string, child: ChildProcess): Promise<void> {
  for (let i = 0; i < 240; i++) {
    if (await ping(1000)) return;
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const tail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').slice(-20).join('\n') : '(no log)';
  const listening = spawnSync('sh', ['-c', `(ss -ltn 2>/dev/null || netstat -an 2>/dev/null) | grep -F ':${PORT}'`], { encoding: 'utf8' }).stdout.trim();
  fail(
    `registry never became ready\n--- server log ---\n${tail}\n` +
      `--- probed ${REGISTRY}-/ping; asked to bind ${LISTEN}; exit=${String(child.exitCode)} ---\n` +
      (listening || `(nothing listening on ${PORT})`),
  );
}

async function main(): Promise<void> {
  assertLoopback(REGISTRY);
  if (await ping(1000)) fail(`something already answers on ${LISTEN}; refusing to publish into a registry this script did not start`);
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')) as { name: string; version: string };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-rehearsal-'));
  const env = npmEnv(work);
  const log = path.join(work, 'verdaccio.log');
  console.log(`REHEARSAL_START ${pkg.name}@${pkg.version} registry=${REGISTRY} work=${work}`);

  run('npm', ['run', 'build'], PKG_DIR, env, false);
  const child = startRegistry(work, log);
  try {
    await waitReady(log, child);
    const before = await fetch(`${REGISTRY}${pkg.name}`, { signal: AbortSignal.timeout(5000) });
    if (before.status !== 404) fail(`${pkg.name} already exists in the fresh registry (HTTP ${before.status})`);

    // --provenance=false must be a CLI flag: it overrides publishConfig, and
    // provenance needs a CI identity this machine does not have.
    const dry = run('npm', ['publish', '--dry-run', '--provenance=false', '--ignore-scripts', '--registry', REGISTRY], PKG_DIR, env, false);
    if (!dry.includes(`Publishing to ${REGISTRY}`)) fail(`dry run did not target ${REGISTRY}:\n${dry.split('\n').slice(-5).join('\n')}`);
    const pub = run('npm', ['publish', '--provenance=false', '--ignore-scripts', '--registry', REGISTRY], PKG_DIR, env, false);
    console.log(`\n$ npm publish (to ${REGISTRY})\n${pub.split('\n').filter((l) => /Publishing to|^\+ /.test(l)).join('\n')}`);
    const meta = (await (await fetch(`${REGISTRY}${pkg.name}`)).json()) as { 'dist-tags'?: { latest?: string } };
    if (meta['dist-tags']?.latest !== pkg.version) fail(`registry latest is ${String(meta['dist-tags']?.latest)}, expected ${pkg.version}`);

    const app = path.join(work, 'app');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'package.json'), '{ "name": "rehearsal-app", "version": "0.0.0", "private": true }\n');
    run('npm', ['install', pkg.name, '--registry', REGISTRY], app, env);
    const installed = JSON.parse(fs.readFileSync(path.join(app, 'node_modules', pkg.name, 'package.json'), 'utf8')) as { version: string };
    const lock = JSON.parse(fs.readFileSync(path.join(app, 'package-lock.json'), 'utf8')) as { packages: Record<string, { resolved?: string }> };
    const resolved = lock.packages[`node_modules/${pkg.name}`]?.resolved ?? '';
    if (installed.version !== pkg.version || !resolved.startsWith(REGISTRY)) {
      fail(`installed ${installed.version} from "${resolved}", expected ${pkg.version} from ${REGISTRY}`);
    }
    console.log(`installed ${pkg.name}@${installed.version} resolved=${resolved}`);

    const help = run('npx', [pkg.name, '--help'], app, env);
    if (!help.includes('podcast make')) fail('--help does not list "podcast make"');
    const version = run('npx', [pkg.name, '--version'], app, env);
    if (version.trim() !== pkg.version) fail(`--version printed ${version}, expected ${pkg.version}`);
    const examples = path.join('node_modules', pkg.name, 'examples');
    const dryRun = run('npx', [
      pkg.name, 'podcast', 'make', '--dry-run', '--writer', 'anthropic', '--voice', 'elevenlabs',
      '--stories', path.join(examples, 'stories.example.json'),
      '--voices', path.join(examples, 'voices.elevenlabs.example.json'), '--out', 'episode',
    ], app, env);
    if (!/^dry run:/m.test(dryRun) || !/estimated cost/.test(dryRun)) fail('podcast make --dry-run did not print a dry-run estimate');
    const lib = run('node', ['--input-type=module', '-e', `const m = await import('${pkg.name}'); console.log('library exports:', Object.keys(m).sort().join(', '))`], app, env);
    if (!/library exports: \w/.test(lib)) fail('importing the package exported nothing');
    console.log(`\nREHEARSAL_PASS ${pkg.name}@${pkg.version}: published to ${REGISTRY}, installed by name, CLI and library ran`);
  } finally {
    await stopRegistry(child);
    if (await ping(500)) console.error(`warning: something still answers on ${LISTEN} after cleanup`);
  }
}

if (isMain(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`REHEARSAL_FAIL: ${err instanceof RehearsalError ? err.message : String((err as Error).stack ?? err)}`);
    process.exitCode = 1;
  });
}
