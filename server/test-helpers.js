import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './data-dir.js';
import { InboxStore } from './store.js';
import { SETTINGS } from './manifest.js';

// The one fake host every server suite builds on: a real InboxStore on its own
// temp file, plus exactly the façade keys the manifest's `requires` grants
// (sessions:read, tasks:read, deliver, board:rebuild) and the
// always-present id/version/stores/settings/log — nothing else, so a test fails
// the moment code reaches for a capability the manifest did not ask for.
//
// Not a `*.test.js` name, so the runner's glob does not run it as an empty
// suite. Its files live under DATA_DIR, which test-setup.js points at a temp dir.

// The allow-listed projections agent-wrangler hands an extension
// (server/host-api/project.js): frozen copies, and no status/waitingFor.
export function projectSession(s) {
  return Object.freeze({
    sessionId: s.sessionId,
    agent: s.agent ?? 'claude',
    cwd: s.cwd ?? null,
    intent: s.intent ?? '',
    model: s.model ?? null,
    effort: s.effort ?? null,
    runtime: s.runtime ?? 'local',
    name: s.name ?? '',
    lastLabel: s.lastLabel ?? '',
    taskId: s.taskId ?? null,
    archived: Boolean(s.archived),
    archivedAt: s.archivedAt ?? (s.archived ? 1 : null),
    snoozedUntil: s.snoozedUntil ?? null,
    suspendPending: Boolean(s.suspendPending),
    workflow: s.workflow ?? null,
    createdAt: s.createdAt ?? null,
    lastActivity: s.lastActivity ?? null,
    parentSession: s.parentSession ?? null,
    spawnedBy: s.spawnedBy ?? null,
    worktree: s.worktree ?? null,
    offBoard: s.offBoard ?? null,
    // Not part of the projection: what the default deliver() reads to answer
    // the way the real one does for a dormant card.
    ...(s.dormant ? { dormant: true } : {}),
  });
}

export function projectTask(t) {
  return Object.freeze({
    taskId: t.taskId ?? t.id,
    name: t.name ?? '',
    archived: Boolean(t.archived),
    archivedAt: t.archivedAt ?? null,
    createdAt: t.createdAt ?? null,
  });
}

// What the real host.deliver resolves to (agent-wrangler server/ext-deliver.js):
// { mode: 'live' | 'dormant' } on success, { mode: 'error', error } otherwise,
// including an archived card, which it refuses rather than resurrects.
function defaultDeliver(sessions) {
  return (sessionId, text) => {
    if (typeof text !== 'string' || !text.trim()) return { mode: 'error', error: 'deliver(sessionId, text): text must be a non-empty string.' };
    const s = sessions.get(sessionId);
    if (!s) return { mode: 'error', error: `No session ${sessionId}.` };
    if (s.archived) return { mode: 'error', error: `Session ${sessionId} is archived.` };
    return { mode: s.dormant ? 'dormant' : 'live' };
  };
}

export function tempStoreFile() {
  return path.join(fs.mkdtempSync(path.join(DATA_DIR, 'host-')), 'inbox.json');
}

// fakeHost({ sessions, tasks, settings, deliver, now, idGen, file })
//   sessions: partial session records ({ sessionId, name, taskId, spawnedBy, archived, dormant })
//   tasks:    partial task records ({ taskId, name })
//   settings: setting VALUES, mutable afterwards through the returned `settings`
//   deliver:  (sessionId, text) => result, replacing the default above
// Returns { host, store, calls, settings, setSession, removeSession, setTask }.
// `calls.rebuild` counts rebuilds; `calls.deliver` records every call in order.
export function fakeHost({ sessions = [], tasks = [], settings = {}, deliver, now, idGen, file } = {}) {
  const sessionMap = new Map(sessions.map((s) => [s.sessionId, projectSession(s)]));
  const taskMap = new Map(tasks.map((t) => [t.taskId ?? t.id, projectTask(t)]));
  const values = { ...settings };
  const declared = SETTINGS.map((d) => d.key);
  const readAll = () => Object.fromEntries(declared.map((k) => [k, values[k]]));
  const calls = { rebuild: 0, deliver: [] };
  const store = new InboxStore({ file: file ?? tempStoreFile(), now, idGen, getSettings: readAll });
  const deliverFn = deliver ?? defaultDeliver(sessionMap);

  const host = {
    id: 'needsyou',
    version: '1.57.0',
    log: () => {},
    stores: Object.freeze({ inbox: store }),
    settings: Object.freeze({ get: (key) => (declared.includes(key) ? values[key] : undefined), all: readAll }),
    sessions: {
      list: () => [...sessionMap.values()].filter((s) => !s.archived),
      get: (id) => sessionMap.get(id) ?? null,
      forTask: (taskId) => [...sessionMap.values()].filter((s) => !s.archived && s.taskId === taskId),
    },
    tasks: {
      adhocId: 'adhoc',
      list: () => [...taskMap.values()],
      get: (id) => taskMap.get(id) ?? null,
      forSession: (sid) => {
        const taskId = sessionMap.get(sid)?.taskId;
        return taskId ? taskMap.get(taskId) ?? null : null;
      },
    },
    deliver: async (sessionId, text) => {
      calls.deliver.push({ sessionId, text });
      return deliverFn(sessionId, text);
    },
    rebuild: async () => { calls.rebuild++; },
  };

  return {
    host,
    store,
    calls,
    settings: values,
    setSession: (s) => { sessionMap.set(s.sessionId, projectSession({ ...sessionMap.get(s.sessionId), ...s })); },
    removeSession: (id) => { sessionMap.delete(id); },
    setTask: (t) => { taskMap.set(t.taskId, projectTask(t)); },
  };
}

// Deterministic ids and a hand-cranked clock for store and graph tests.
export function seq(prefix = 'ibx_') {
  let n = 0;
  return () => `${prefix}${(++n).toString(16).padStart(12, '0')}`;
}

export function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.tick = (ms = 1) => { t += ms; return t; };
  now.set = (v) => { t = v; };
  return now;
}
