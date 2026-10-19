// Gate-only entry: the production entry (../index.ts) plus a hold that keeps
// the JS thread "busy" while network requests are in flight.
//
// Why: the headless engine fires a --tap (and takes its screenshot) once
// JavaScript goes idle. A pending fetch is not JavaScript work, so without
// this the tap can land on the loading spinner before the edition arrives,
// and the gate would pass or fail on network timing. One-shot timers DO count
// as pending work, so this module wraps fetch and keeps a short timer armed
// while any request is open, plus a grace period after each one settles to
// cover the gap before the request it triggers (list, then edition).
//
// Nothing here changes what the app renders; it only changes when the
// engine considers the app settled.
const GRACE_MS = 500;
const POLL_MS = 25;

type Fetch = typeof fetch;
const g = globalThis as unknown as { fetch: Fetch };
const realFetch = g.fetch;
let inflight = 0;
let poll: ReturnType<typeof setTimeout> | null = null;
let grace: ReturnType<typeof setTimeout> | null = null;

function holdWhileInflight() {
  if (poll) return;
  const step = () => {
    poll = null;
    if (inflight > 0) poll = setTimeout(step, POLL_MS);
  };
  poll = setTimeout(step, POLL_MS);
}

function holdGrace() {
  if (grace) clearTimeout(grace);
  grace = setTimeout(() => {
    grace = null;
  }, GRACE_MS);
}

g.fetch = ((...args: Parameters<Fetch>) => {
  inflight++;
  holdWhileInflight();
  return realFetch(...args).finally(() => {
    inflight--;
    holdGrace();
  });
}) as Fetch;

// Cover boot, before the first request is issued.
holdGrace();

export {};
