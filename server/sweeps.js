// Expiry and retention sweeps (docs/specs/ws5-lifecycle.md). A sweep is
// `{ id, everyMs, run({ host }) }`, fire-and-forget; a throw is logged by the host.
// Quiet by design: one log line only on a tick that changed something, counts only.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 7;
const BOOT_DELAY_MS = 30_000;

function retentionMs(host) {
  const v = host.settings?.get?.('retentionDays');
  const days = Number.isFinite(v) && v >= 1 && v <= 90 ? v : DEFAULT_RETENTION_DAYS;
  return days * DAY_MS;
}

async function removeExpiredResolved(host) {
  const store = host.stores.inbox;
  const cutoff = store.now() - retentionMs(host);
  const ids = store.snapshot()
    .filter((i) => i.state === 'resolved' && i.updatedAt < cutoff)
    .map((i) => i.id);
  if (!ids.length) return;
  const n = store.remove(ids);
  if (n) {
    host.log?.(`retention removed ${n} resolved item${n === 1 ? '' : 's'}`);
    await host.rebuild();
  }
}

async function resolveExpired(host) {
  const store = host.stores.inbox;
  const t = store.now();
  const hit = store.resolveWhere((i) => i.source === 'agent' && i.state === 'open' && i.expiresAt != null && i.expiresAt <= t, 'expired');
  if (hit.length) {
    host.log?.(`expiry resolved ${hit.length} item${hit.length === 1 ? '' : 's'}`);
    await host.rebuild();
  }
}

// Sweeps have only `everyMs`, so the "once, 30 s after activation" retention
// run is a short-interval sweep that does its work on its first tick for each
// store instance. The wrangler builds the store afresh on every activation, so
// keying on it (not a closure flag) runs it again after a disable and enable.
// Later ticks are a WeakSet lookup and nothing more.
export function makeSweeps() {
  const bootDone = new WeakSet();
  return [
    { id: 'retention', everyMs: 60 * 60 * 1000, run: ({ host }) => removeExpiredResolved(host) },
    { id: 'expiry', everyMs: 60 * 1000, run: ({ host }) => resolveExpired(host) },
    {
      id: 'retention-boot',
      everyMs: BOOT_DELAY_MS,
      run: ({ host }) => {
        const store = host.stores.inbox;
        if (bootDone.has(store)) return;
        bootDone.add(store);
        return removeExpiredResolved(host);
      },
    },
  ];
}

export const inboxSweeps = makeSweeps();
