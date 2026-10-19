// Lets Settings > About > Check now ask the update banner to look again,
// so a newer build found from Settings shows up in the banner that downloads
// and installs it.
const subs = new Set<() => void>();

export function requestUpdateCheck(): void {
  for (const fn of subs) fn();
}

export function onUpdateCheckRequest(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}
