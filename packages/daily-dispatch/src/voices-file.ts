import { DispatchError } from './errors.ts';
import type { SpeakerRole, VoiceEntry, VoiceMap } from './types.ts';

const TAG = /^[A-Z0-9_]+$/;
const PLACEHOLDER = /^REPLACE_WITH/;

/** Validate the parsed contents of voices.json (see pipeline/voices.example.json). */
export function parseVoiceMap(data: unknown): VoiceMap {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new DispatchError('invalid-input', 'voices file must be an object of TAG -> {"id", "name"}');
  }
  const problems: string[] = [];
  const map: VoiceMap = {};
  for (const [tag, raw] of Object.entries(data)) {
    if (!TAG.test(tag)) problems.push(`"${tag}": tags use A-Z, 0-9 and _ only`);
    const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const id = v['id'];
    const name = v['name'];
    const role = v['role'];
    if (typeof id !== 'string' || id.trim() === '') problems.push(`${tag}: "id" must be a non-empty string`);
    if (typeof name !== 'string' || name.trim() === '') problems.push(`${tag}: "name" must be a non-empty string`);
    if (role !== undefined && role !== 'host' && role !== 'caller') {
      problems.push(`${tag}: "role" must be "host" or "caller"`);
    }
    map[tag] = { ...(v as object), id: String(id ?? '').trim(), name: String(name ?? '').trim() } as VoiceEntry;
  }
  if (Object.keys(map).length === 0) problems.push('no voices defined');
  if (problems.length > 0) {
    throw new DispatchError('invalid-input', `voices file has ${problems.length} problem(s)`, problems);
  }
  return map;
}

/** Explicit role wins; otherwise S1, S2, ... are hosts and every other tag is a caller. */
export function roleOf(tag: string, entry: VoiceEntry): SpeakerRole {
  return entry.role ?? (/^S\d+$/.test(tag) ? 'host' : 'caller');
}

/** Tags whose id is still the example file's placeholder; a real run refuses these. */
export function placeholderVoices(map: VoiceMap): string[] {
  return Object.entries(map)
    .filter(([, v]) => PLACEHOLDER.test(v.id))
    .map(([tag]) => tag);
}
