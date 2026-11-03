// The client half of passive detection (docs/specs/ws3-passive-signals.md). Server
// extension code can't see a session's status (host.sessions.* has none), so each
// board tab reads it off the graph and reports a snapshot with `inbox-observe`.
// The server reconciles it idempotently, so several tabs sending the same thing is
// expected. Importable under node: nothing here touches the DOM at load.

const MAX_SESSIONS = 500;
const MAX_STRING = 500;
const MIN_INTERVAL_MS = 2000;

const clip = (v) => (typeof v === 'string' ? v.slice(0, MAX_STRING) : null);

// Only a needs-you session carries waitingFor/waitingReason/updatedAt: the server
// reads them for no other status, and nulling them keeps churn on a working or
// idle card (a fresh updatedAt every tick) from reading as a change.
function observe(s) {
  if (!s || typeof s !== 'object' || s.archived || s.sample === true) return null;
  if (typeof s.sessionId !== 'string' || !s.sessionId || s.sessionId.length > MAX_STRING) return null;
  const needsYou = s.status === 'needs-you';
  return {
    sessionId: s.sessionId,
    status: clip(s.status) ?? 'unknown',
    waitingFor: needsYou ? clip(s.waitingFor) : null,
    waitingReason: needsYou ? clip(s.waitingReason) : null,
    updatedAt: needsYou && Number.isFinite(s.updatedAt) ? s.updatedAt : null,
  };
}

// Sorted by id, so the order the graph lists cards in never changes the signature.
// The server treats the list as every non-archived session, so past the cap the
// needs-you ones are kept first: they are the only ones whose absence it acts on.
export function observedSessions(graph) {
  if (!Array.isArray(graph?.sessions)) return null;
  const byId = new Map();
  for (const s of graph.sessions) {
    const o = observe(s);
    if (o) byId.set(o.sessionId, o);
  }
  let list = [...byId.values()];
  if (list.length > MAX_SESSIONS) {
    list = [...list.filter((o) => o.status === 'needs-you'), ...list.filter((o) => o.status !== 'needs-you')].slice(0, MAX_SESSIONS);
  }
  return list.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
}

export const signatureOf = (sessions) => JSON.stringify(sessions.map((o) => [o.sessionId, o.status, o.waitingFor, o.waitingReason, o.updatedAt]));

// startObserver(api) -> { update(graph), stop() }. The options are test seams.
export function startObserver(api, { now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, minIntervalMs = MIN_INTERVAL_MS } = {}) {
  let stopped = false;
  let latest = null; // { sessions, sig } from the newest graph
  let sentSig = null; // signature the server last got from this tab; null forces a send
  let lastSentAt = -Infinity;
  let timer = null;

  function flush() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (stopped || !latest || latest.sig === sentSig) return;
    sentSig = latest.sig;
    lastSentAt = now();
    api.send({ type: 'inbox-observe', sessions: latest.sessions, complete: true });
  }

  // At most one send per interval; a change inside it goes out on a trailing timer
  // carrying whatever the newest graph says by then.
  function schedule() {
    if (stopped || !latest || latest.sig === sentSig || timer !== null) return;
    const wait = lastSentAt + minIntervalMs - now();
    if (wait <= 0) flush();
    else timer = setTimer(flush, wait);
  }

  // A reconnect may be to a restarted server that has lost nothing durable but
  // wants the current picture, so send it again whether or not it changed.
  const unsubscribe = api.onConnect?.(() => {
    sentSig = null;
    schedule();
  });

  return {
    update(graph) {
      if (stopped) return;
      const sessions = observedSessions(graph);
      if (!sessions) return;
      latest = { sessions, sig: signatureOf(sessions) };
      schedule();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (typeof unsubscribe === 'function') unsubscribe();
    },
  };
}
