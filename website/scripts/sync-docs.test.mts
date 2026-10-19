import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO_URL, rewriteLinks, rewriteTarget, syncDocs, type Page } from './sync-docs.mts';

const pages: Page[] = [
  { src: 'docs/a.md', id: 'alpha' },
  { src: 'CONTRIBUTING.md', id: 'contributing' },
];

function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-docs-'));
  mkdirSync(join(root, 'docs/assets/screenshots'), { recursive: true });
  mkdirSync(join(root, 'templates'), { recursive: true });
  writeFileSync(join(root, 'docs/a.md'), '# A\n\nSee [contributing](../CONTRIBUTING.md#checks).\n');
  writeFileSync(join(root, 'CONTRIBUTING.md'), '# C\n\n[A](docs/a.md) and [agents](AGENTS.md).\n');
  writeFileSync(join(root, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(root, 'templates/job.yml'), 'on: push\n');
  writeFileSync(join(root, 'docs/assets/screenshots/shot.png'), 'png');
  return root;
}

test('a link to a synced page points at that page and keeps the anchor', () => {
  const root = fixtureRepo();
  assert.equal(rewriteTarget('../CONTRIBUTING.md#checks', 'docs/a.md', root, pages), './contributing.md#checks');
  assert.equal(rewriteTarget('docs/a.md', 'CONTRIBUTING.md', root, pages), './alpha.md');
});

test('a link to any other repository file points at GitHub', () => {
  const root = fixtureRepo();
  assert.equal(rewriteTarget('AGENTS.md', 'CONTRIBUTING.md', root, pages), `${REPO_URL}/blob/main/AGENTS.md`);
  assert.equal(rewriteTarget('../templates', 'docs/a.md', root, pages), `${REPO_URL}/tree/main/templates`);
});

test('assets, URLs and anchors are handled without GitHub links', () => {
  const root = fixtureRepo();
  assert.equal(rewriteTarget('assets/screenshots/shot.png', 'docs/a.md', root, pages), './assets/screenshots/shot.png');
  assert.equal(rewriteTarget('https://example.com/x.md', 'docs/a.md', root, pages), 'https://example.com/x.md');
  assert.equal(rewriteTarget('#costs', 'docs/a.md', root, pages), '#costs');
});

test('a link to a missing file fails the sync', () => {
  const root = fixtureRepo();
  assert.throws(() => rewriteTarget('missing.md', 'docs/a.md', root, pages), /broken link: missing\.md/);
  assert.throws(() => rewriteTarget('../../outside.md', 'docs/a.md', root, pages), /leaves the repository/);
});

test('links inside fenced code blocks are left alone', () => {
  const root = fixtureRepo();
  const md = '```\n[x](missing.md)\n```\n[y](../AGENTS.md)\n';
  assert.equal(rewriteLinks(md, 'docs/a.md', root, pages), `\`\`\`\n[x](missing.md)\n\`\`\`\n[y](${REPO_URL}/blob/main/AGENTS.md)\n`);
});

test('syncDocs writes each page with its id, edit URL and rewritten links, plus the assets', () => {
  const root = fixtureRepo();
  const out = join(root, 'site-docs');
  assert.equal(syncDocs(root, out, pages), 2);
  const alpha = readFileSync(join(out, 'alpha.md'), 'utf8');
  assert.match(alpha, /^---\nid: alpha\ncustom_edit_url: .*\/edit\/main\/docs\/a\.md\n---\n/);
  assert.match(alpha, /\[contributing\]\(\.\/contributing\.md#checks\)/);
  assert.equal(readFileSync(join(out, 'assets/screenshots/shot.png'), 'utf8'), 'png');
});
