import { canAsk } from './can-ask.js';
import { isUnread, needsAction } from './item.js';

export const RESOLVED_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_GRAPH_ITEMS = 200;

const MISSING = Object.freeze({ name: '', taskId: null, taskName: '', spawnedBy: null, canAsk: true, canAskOverride: null });

// Runs on every ~4 s rebuild, where nothing may throw: every host read is
// guarded and a failed lookup reads as an absent session or task.
function attempt(fn, fallback) {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

function sessionEntry(host, store, sessionId, itemTaskId) {
  const s = attempt(() => host.sessions.get(sessionId), null);
  if (!s) return { ...MISSING };
  const taskId = s.taskId ?? itemTaskId ?? null;
  const taskName = taskId ? attempt(() => host.tasks.get(taskId)?.name, '') : '';
  const allowed = attempt(() => canAsk(host, store, sessionId).allowed, true);
  const override = attempt(() => store.canAskOverride(sessionId), null);
  return {
    name: s.name ?? '',
    taskId,
    taskName,
    spawnedBy: s.spawnedBy ?? null,
    canAsk: allowed !== false,
    canAskOverride: typeof override === 'boolean' ? override : null,
  };
}

// contracts §4. Live items first so the cap can only ever cut resolved
// history, each group newest first.
export function buildInboxGraph(host, { now = Date.now() } = {}) {
  const store = host.stores.inbox;
  const all = store.snapshot();
  const live = all.filter((i) => i.state !== 'resolved');
  const recent = all.filter((i) => i.state === 'resolved' && now - i.updatedAt < RESOLVED_WINDOW_MS);
  const items = [...live, ...recent].slice(0, MAX_GRAPH_ITEMS);

  const taskOf = new Map();
  for (const i of items) if (!taskOf.has(i.sessionId)) taskOf.set(i.sessionId, i.taskId);
  for (const s of attempt(() => host.sessions.list(), [])) {
    if (s?.spawnedBy && !taskOf.has(s.sessionId)) taskOf.set(s.sessionId, null);
  }
  const sessions = {};
  for (const [sid, taskId] of taskOf) sessions[sid] = sessionEntry(host, store, sid, taskId);
  // Each listed session's spawner too, so "spawned by X" has a name even when
  // X has no item and wasn't itself spawned (contracts §4, 0.1.1 F4). Every
  // spawned session is already listed, so one pass reaches every spawner.
  for (const entry of Object.values({ ...sessions })) {
    const spawner = entry.spawnedBy;
    if (spawner && !sessions[spawner]) sessions[spawner] = sessionEntry(host, store, spawner, null);
  }

  return {
    rev: store.rev(),
    unread: all.filter(isUnread).length,
    open: all.filter(needsAction).length,
    items,
    sessions,
  };
}

export const inboxGraph = ({ host }) => ({ inbox: buildInboxGraph(host) });
