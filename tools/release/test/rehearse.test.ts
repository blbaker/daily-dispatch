/**
 * The rehearsal's two publish-safety guards, tested without starting a
 * registry: the loopback check on the registry URL, and the refusal to
 * publish into a registry the script did not start.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT } from '../lib.ts';
import { assertLoopback } from '../rehearse.ts';

test('assertLoopback accepts loopback registries', () => {
  for (const url of ['http://127.0.0.1:4879/', 'http://localhost:4879/', 'http://[::1]:4879/', 'http://127.0.0.2/']) {
    assert.doesNotThrow(() => assertLoopback(url), url);
  }
});

test('assertLoopback refuses anything else, including look-alikes', () => {
  for (const url of [
    'https://registry.npmjs.org/',
    'http://127.0.0.1.example.com:4879/',
    'http://localhost.example.com/',
    'http://example.com/127.0.0.1/',
  ]) {
    assert.throws(() => assertLoopback(url), /not on a loopback address/, url);
  }
});

test('the rehearsal refuses to publish when something already serves its port', async () => {
  const server = http.createServer((_req, res) => res.end('{}'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'tools/release/rehearse.ts')], {
      env: { ...process.env, DD_REHEARSAL_PORT: String(port) },
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 1, out);
    assert.match(out, /REHEARSAL_FAIL: something already answers on 127\.0\.0\.1:\d+; refusing to publish/);
    assert.doesNotMatch(out, /REHEARSAL_START/, 'it stopped before building or publishing anything');
  } finally {
    server.close();
  }
});
