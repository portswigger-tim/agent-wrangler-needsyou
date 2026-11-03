import { test } from 'node:test';
import assert from 'node:assert/strict';
import manifest from './manifest.js';
import { buildInboxGraph, RESOLVED_WINDOW_MS, MAX_GRAPH_ITEMS } from './graph.js';
import { fakeHost, seq, clock } from './test-helpers.js';

const DAY = RESOLVED_WINDOW_MS;
const agent = (sessionId, over = {}) => ({ source: 'agent', kind: 'question', sessionId, title: `ask ${sessionId}`, ...over });
const status = (sessionId, episode = 'e1') => ({ source: 'status', kind: 'blocked', sessionId, title: 'blocked', dedupeKey: `status:${sessionId}:${episode}`, status: { waitingFor: 'permission', waitingReason: null, episode } });

function setup(opts = {}) {
  const now = clock(10 * DAY);
  return { now, ...fakeHost({ now, idGen: seq(), ...opts }) };
}

test('the contributor returns graph.inbox, empty on a fresh store', () => {
  const { host, store } = setup();
  assert.deepEqual(manifest.graph({ host, graph: {} }), { inbox: { rev: store.rev(), unread: 0, open: 0, items: [], sessions: {} } });
});

test('counts: unread is open+unread, open adds answered-with-failed-delivery', () => {
  const { host, store } = setup({ sessions: [{ sessionId: 's1' }] });
  const a = store.create(agent('s1'));
  const b = store.create(agent('s1'));
  const c = store.create(agent('s1'));
  store.create(status('s1'));
  store.markRead([b.id]);
  store.answer(a.id, { text: 'x' });
  store.setDelivery(a.id, { delivery: 'failed', deliveryError: 'gone' });
  store.answer(c.id, { text: 'y' });
  const g = buildInboxGraph(host);
  assert.equal(g.unread, 1);
  assert.equal(g.open, 3);
  assert.equal(g.rev, store.rev());
});

test('items: live first, then resolved updated within 24 h, each newest first', () => {
  const { host, store, now } = setup();
  const old = store.create(agent('s1'));
  store.resolve(old.id, 'withdrawn');
  now.tick(1);
  const recent = store.create(agent('s1'));
  now.tick(1);
  const live = store.create(agent('s2'));
  now.tick(1);
  store.resolve(recent.id, 'withdrawn');
  now.tick(DAY - 2);
  const answered = store.create(agent('s3'));
  store.answer(answered.id, { text: 'ok' });
  assert.deepEqual(buildInboxGraph(host, { now: now() }).items.map((i) => i.id), [answered.id, live.id, recent.id]);
  assert.deepEqual(buildInboxGraph(host, { now: now() - 2 }).items.map((i) => i.id), [answered.id, live.id, recent.id, old.id]);
});

test('items are capped at 200 and the cap never cuts a live item', () => {
  const { host, store, now, settings } = setup();
  settings.maxOpenPerSession = 20;
  for (let i = 0; i < 150; i++) store.resolve(store.create(agent(`r${i}`)).id, 'withdrawn');
  for (let i = 0; i < 120; i++) { now.tick(-1); store.create(agent(`l${i}`)); }
  const { items } = buildInboxGraph(host, { now: now() });
  assert.equal(items.length, MAX_GRAPH_ITEMS);
  assert.equal(items.filter((i) => i.state === 'open').length, 120);
  assert.ok(items.slice(0, 120).every((i) => i.state === 'open'));
});

test('sessions: item sessions and every spawned session, with names, tasks and canAsk', () => {
  const { host, store } = setup({
    sessions: [
      { sessionId: 's1', name: 'Planner', taskId: 't1' },
      { sessionId: 'w1', name: 'Worker', taskId: 't1', spawnedBy: 's1' },
      { sessionId: 'idle', name: 'Idle' },
      { sessionId: 'gone', spawnedBy: 's1', archived: true },
    ],
    tasks: [{ taskId: 't1', name: 'Inbox' }],
  });
  store.create(agent('s1'));
  store.create(agent('missing', { taskId: 't1' }));
  assert.deepEqual(buildInboxGraph(host).sessions, {
    s1: { name: 'Planner', taskId: 't1', taskName: 'Inbox', spawnedBy: null, canAsk: true, canAskOverride: null },
    missing: { name: '', taskId: null, taskName: '', spawnedBy: null, canAsk: true, canAskOverride: null },
    w1: { name: 'Worker', taskId: 't1', taskName: 'Inbox', spawnedBy: 's1', canAsk: false, canAskOverride: null },
  });
});

test('sessions: canAskOverride is null by default, else the human\'s explicit choice', () => {
  const { host, store } = setup({
    sessions: [
      { sessionId: 'o1', name: 'Orchestrator' },
      { sessionId: 'w1', spawnedBy: 'o1' },
      { sessionId: 'w2', spawnedBy: 'o1' },
      { sessionId: 'w3', spawnedBy: 'o1' },
    ],
  });
  store.setCanAskOverride('w2', true);
  store.setCanAskOverride('w3', false);
  const { sessions } = buildInboxGraph(host);
  assert.deepEqual([sessions.w1.canAsk, sessions.w1.canAskOverride], [false, null]);
  assert.deepEqual([sessions.w2.canAsk, sessions.w2.canAskOverride], [true, true]);
  assert.deepEqual([sessions.w3.canAsk, sessions.w3.canAskOverride], [false, false]);
  store.setCanAskOverride('w2', null);
  assert.deepEqual([buildInboxGraph(host).sessions.w2.canAskOverride], [null]);
});

test('sessions: a top-level spawner with no item is listed by name (F4)', () => {
  const { host } = setup({
    sessions: [
      { sessionId: 'o1', name: 'Orchestrator', taskId: 't1' },
      { sessionId: 'w1', name: 'Worker', spawnedBy: 'o1' },
      { sessionId: 'other', name: 'Unrelated' },
    ],
    tasks: [{ taskId: 't1', name: 'Inbox' }],
  });
  const { sessions } = buildInboxGraph(host);
  assert.deepEqual(Object.keys(sessions).sort(), ['o1', 'w1']);
  assert.deepEqual(sessions.o1, { name: 'Orchestrator', taskId: 't1', taskName: 'Inbox', spawnedBy: null, canAsk: true, canAskOverride: null });
});

test('host lookups that throw read as an absent session instead of breaking the tick', () => {
  const { host, store } = setup();
  store.create(agent('s1'));
  host.sessions.get = () => { throw new Error('boom'); };
  host.sessions.list = () => { throw new Error('boom'); };
  assert.deepEqual(buildInboxGraph(host).sessions, { s1: { name: '', taskId: null, taskName: '', spawnedBy: null, canAsk: true, canAskOverride: null } });
});
