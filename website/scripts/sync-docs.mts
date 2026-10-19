// Copies the repository's Markdown docs into website/docs before each build.
//
// docs/*.md and CONTRIBUTING.md stay the only copy of the content, so they
// read the same on GitHub and on the site. Relative links are rewritten on
// the way through: a link to another synced page points at that page, and a
// link to any other file in the repository points at it on GitHub. A link
// to a path that does not exist fails the sync, which keeps GitHub-only
// broken links out of the site too.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Page {
  src: string; // path from the repository root
  id: string; // doc id and file name on the site
}

export const PAGES: Page[] = [
  { src: 'docs/setup.md', id: 'setup' },
  { src: 'docs/pipeline.md', id: 'pipeline' },
  { src: 'docs/podcast-providers.md', id: 'podcast-providers' },
  { src: 'docs/podcast-style-guide.md', id: 'podcast-style-guide' },
  { src: 'docs/daily-podcast.md', id: 'daily-podcast' },
  { src: 'docs/push-setup.md', id: 'push-setup' },
  { src: 'docs/push-clients.md', id: 'push-clients' },
  { src: 'docs/desktop.md', id: 'desktop' },
  { src: 'docs/backend.md', id: 'backend' },
  { src: 'docs/builds.md', id: 'builds' },
  { src: 'docs/releasing.md', id: 'releasing' },
  { src: 'docs/releasing-npm.md', id: 'releasing-npm' },
  { src: 'CONTRIBUTING.md', id: 'contributing' },
];

export const ASSETS_DIR = 'docs/assets';
export const REPO_URL = 'https://github.com/blbaker/daily-dispatch';

const LINK = /(!?\[[^\]\n]*\]\()([^)\s]+)(\))/g;
const EXTERNAL = /^([a-z][a-z0-9+.-]*:|#|\/)/i;

/** Rewrites one relative link target found in `src`. */
export function rewriteTarget(target: string, src: string, repoRoot: string, pages: Page[] = PAGES): string {
  if (EXTERNAL.test(target)) return target;
  const [path = '', hash] = target.split('#', 2);
  const suffix = hash === undefined ? '' : `#${hash}`;
  const repoPath = posix.normalize(posix.join(posix.dirname(src), path));
  if (repoPath.startsWith('..')) throw new Error(`${src}: link leaves the repository: ${target}`);
  const page = pages.find((p) => p.src === repoPath);
  if (page) return `./${page.id}.md${suffix}`;
  const abs = join(repoRoot, repoPath);
  if (!existsSync(abs)) throw new Error(`${src}: broken link: ${target}`);
  if (repoPath.startsWith(`${ASSETS_DIR}/`)) return `./assets/${repoPath.slice(ASSETS_DIR.length + 1)}`;
  const kind = statSync(abs).isDirectory() ? 'tree' : 'blob';
  return `${REPO_URL}/${kind}/main/${repoPath}${suffix}`;
}

/** Rewrites every Markdown link outside fenced code blocks. */
export function rewriteLinks(markdown: string, src: string, repoRoot: string, pages: Page[] = PAGES): string {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(LINK, (_m, open: string, target: string, close: string) =>
        `${open}${rewriteTarget(target, src, repoRoot, pages)}${close}`);
    })
    .join('\n');
}

export function syncDocs(repoRoot: string, outDir: string, pages: Page[] = PAGES): number {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const page of pages) {
    const body = readFileSync(join(repoRoot, page.src), 'utf8');
    const front = [
      '---',
      `id: ${page.id}`,
      `custom_edit_url: ${REPO_URL}/edit/main/${page.src}`,
      '---',
      `<!-- Generated from ${page.src} by website/scripts/sync-docs.mts. Edit that file. -->`,
      '',
    ].join('\n');
    writeFileSync(join(outDir, `${page.id}.md`), front + rewriteLinks(body, page.src, repoRoot, pages));
  }
  const assets = join(repoRoot, ASSETS_DIR);
  if (existsSync(assets)) cpSync(assets, join(outDir, 'assets'), { recursive: true });
  return pages.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = resolve(siteDir, '..');
  const count = syncDocs(repoRoot, join(siteDir, 'docs'));
  console.log(`sync-docs: ${count} pages into ${relative(repoRoot, join(siteDir, 'docs'))}/`);
}
