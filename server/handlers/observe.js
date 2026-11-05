import { reconcile } from '../reconcile.js';

// `inbox-observe`: a board tab's snapshot of every session's status (contracts §5).
// Several tabs send the same thing, so reconcile is idempotent and a snapshot that
// changes nothing doesn't rebuild.
const MAX_SESSIONS = 500;
const MAX_STRING = 500;

function text(v, name, { nullable = false } = {}) {
  if (nullable && (v === null || v === undefined)) return null;
  if (typeof v !== 'string') throw new Error(`inbox-observe ${name} must be a string${nullable ? ' or null' : ''}`);
  if (v.length > MAX_STRING) throw new Error(`inbox-observe ${name} must be at most ${MAX_STRING} characters`);
  return v;
}

export function parseObserved(msg) {
  const { sessions, complete } = msg ?? {};
  if (complete !== true) throw new Error('inbox-observe needs complete: true (every non-archived session)');
  if (!Array.isArray(sessions) || sessions.length > MAX_SESSIONS) {
    throw new Error(`inbox-observe needs sessions: an array of at most ${MAX_SESSIONS} sessions`);
  }
  return sessions.map((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`inbox-observe sessions[${i}] must be an object`);
    const sessionId = text(s.sessionId, `sessions[${i}].sessionId`);
    if (!sessionId) throw new Error(`inbox-observe sessions[${i}].sessionId must not be empty`);
    const updatedAt = s.updatedAt ?? null;
    if (updatedAt !== null && !Number.isFinite(updatedAt)) throw new Error(`inbox-observe sessions[${i}].updatedAt must be a number or null`);
    return {
      sessionId,
      status: text(s.status, `sessions[${i}].status`),
      waitingFor: text(s.waitingFor, `sessions[${i}].waitingFor`, { nullable: true }),
      waitingReason: text(s.waitingReason, `sessions[${i}].waitingReason`, { nullable: true }),
      updatedAt,
    };
  });
}

export const observeHandler = {
  type: 'inbox-observe',
  async handler(msg, host) {
    const observed = parseObserved(msg);
    const settings = {
      includeTransientApiErrors: host.settings.get('includeTransientApiErrors'),
    };
    const taskIdFor = (sessionId) => host.sessions.get(sessionId)?.taskId ?? null;
    const { opened, updated, resolved } = reconcile(host.stores.inbox, observed, { settings, now: Date.now, taskIdFor, log: host.log });
    if (opened.length || updated.length || resolved.length) await host.rebuild();
  },
};

export const observeHandlers = [observeHandler];
