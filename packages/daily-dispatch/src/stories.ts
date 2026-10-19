import { DispatchError } from './errors.ts';
import type { Story } from './types.ts';

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, field: string, where: string, problems: string[]): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v) && v.every((p) => typeof p === 'string')) return v.map((p) => p.trim()).join(' ').trim();
  problems.push(`${where}: "${field}" must be a string`);
  return '';
}

function overviewText(v: unknown): string {
  if (!Array.isArray(v)) return '';
  return v
    .filter(isObj)
    .map((b) => [b['label'], b['text']].filter((p) => typeof p === 'string' && p !== '').join(': '))
    .join(' ')
    .trim();
}

/**
 * Accepts the stories file in either shape the project produces: a bare
 * array of stories, or an edition object `{ stories: [...] }` from the
 * backend. `summary` may be a string or a list of paragraphs (the digest
 * pipeline writes paragraphs); an empty summary falls back to the
 * edition's overview bullets.
 */
export function parseStories(data: unknown): Story[] {
  const list = isObj(data) ? data['stories'] : data;
  if (!Array.isArray(list)) {
    throw new DispatchError('invalid-input', 'stories file must be an array of stories or an object with a "stories" array');
  }
  if (list.length === 0) throw new DispatchError('invalid-input', 'stories file has no stories');
  const problems: string[] = [];
  const stories = list.map((item, i): Story => {
    const where = `story ${i + 1}`;
    if (!isObj(item)) {
      problems.push(`${where}: not an object`);
      return { headline: '', source: '', summary: '', url: '' };
    }
    const story = {
      headline: text(item['headline'], 'headline', where, problems),
      source: text(item['source'], 'source', where, problems) || 'Link',
      summary: text(item['summary'], 'summary', where, problems) || overviewText(item['overview']),
      url: text(item['url'], 'url', where, problems),
    };
    if (story.headline === '' && story.url === '') problems.push(`${where}: needs a headline or a url`);
    return story;
  });
  if (problems.length > 0) {
    throw new DispatchError('invalid-input', `stories file has ${problems.length} problem(s)`, problems);
  }
  return stories;
}

function compact(summary: string, max: number): string {
  if (summary.length <= max) return summary;
  const cut = summary.slice(0, max - 1);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trimEnd();
  return `${atWord}…`;
}

/**
 * Dedupe by URL (the same link often lands in two editions) and trim each
 * summary to roughly `maxSummary` characters, which keeps a 100-story day
 * inside a model's context while leaving the facts the hosts need.
 */
export function prepareStories(stories: readonly Story[], opts: { maxSummary?: number } = {}): Story[] {
  const max = opts.maxSummary ?? 350;
  const seen = new Set<string>();
  const out: Story[] = [];
  for (const s of stories) {
    if (s.url !== '') {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
    }
    out.push({ ...s, summary: compact(s.summary, max) });
  }
  return out;
}
