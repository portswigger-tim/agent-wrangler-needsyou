// Items never outlive the thing they are about (docs/specs/ws5-lifecycle.md).
// Hooks re-read the store on every call and never throw: the host logs and
// swallows a throw anyway, but a failed hook must not skip the rebuild path.

async function guarded(name, host, fn) {
  try {
    await fn();
  } catch (err) {
    try { host?.log?.(`${name} failed: ${err?.message ?? err}`); } catch { /* nothing left to do */ }
  }
}

// An archived card refuses delivery, so even an answered item still waiting
// on delivery is closed here.
async function onArchive({ sessionId, host } = {}) {
  await guarded('onArchive', host, async () => {
    const hit = host.stores.inbox.resolveWhere((i) => i.sessionId === sessionId, 'session-archived');
    if (hit.length) await host.rebuild();
  });
}

// The card is gone from mappings.json: drop its items and can-ask override.
async function onPurge({ sessionId, host } = {}) {
  await guarded('onPurge', host, async () => {
    host.stores.inbox.forgetSession(sessionId);
    await host.rebuild();
  });
}

export const lifecycleHooks = { onArchive, onPurge };
