#!/usr/bin/env node
import { run } from './main.ts';

process.exitCode = await run(process.argv.slice(2), {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
  env: process.env,
  cwd: process.cwd(),
  fetchImpl: globalThis.fetch,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
