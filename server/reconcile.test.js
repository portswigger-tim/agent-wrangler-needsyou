import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, titleFor, createReconcileState } from './reconcile.js';
import { fakeHost, seq, clock } from './test-helpers.js';

const needsYou = (sessionId, extra = {}) => ({ sessionId, status: 'needs-you', waitingFor: 'trust dialog', waitingReason: null, updatedAt: 1000, ...extra });
const other = (sessionId, status = 'idle') => ({ sessionId, status, waitingFor: null, waitingReason: null, updatedAt: null });

function setup(settings = {}) {
  const now = clock(100_000);
  const f = fakeHost({ now, idGen: seq(), settings });
  const state = createReconcileState();
  const run = (observed, opts = {}) => reconcile(f.store, observed, { settings: f.settings, now, state, ...opts });
  return { ...f, now, state, run };
}

const openStatus = (store) => store.snapshot().filter((i) => i.source === 'status' && i.state === 'open');

test('titleFor maps waitingFor and waitingReason to the exact titles', () => {
  const cases = [
    [['anything', 'api-error-blocking'], 'API error — action needed'],
    [['The response stopped arriving.', 'api-error'], 'API error — retry'],
    [['trust dialog', null], 'Confirm folder trust'],
    [['Codex is asking whether to TRUST this folder', null], 'Confirm folder trust'],
    [['Select login method', null], 'Sign-in required'],
    [['open oauth/authorize in a browser', null], 'Sign-in required'],
    [['Codex update finished — restart Codex', null], 'Agent update needs a restart'],
    [['Codex has a CLI update available', null], 'Agent update needs a restart'],
    [['Bash: npm update', null], 'Waiting for you: Bash: npm update'],
    [['Bash: npm login', null], 'Waiting for you: Bash: npm login'],
    [['Edit trust-store.js', null], 'Waiting for you: Edit trust-store.js'],
    [['container bring-up failed', null], 'Container failed to start'],
    [['permission to run Bash', null], 'Waiting for you: permission to run Bash'],
    [['confirm a startup prompt in the terminal', null], 'Waiting for you: confirm a startup prompt in the terminal'],
    [[null, null], 'Session needs you'],
    [['   ', null], 'Session needs you'],
    [[undefined, undefined], 'Session needs you'],
  ];
  for (const [[waitingFor, reason], title] of cases) assert.equal(titleFor(waitingFor, reason), title);
  const long = titleFor('x'.repeat(200), null);
  assert.equal(long, `Waiting for you: ${'x'.repeat(79)}…`);
  assert.ok(long.length <= 120);
  assert.equal(titleFor('line one\nline two', null), 'Waiting for you: line one line two');
});

test('opens a blocking status item for a needs-you session', () => {
  const { store, run, now } = setup();
  const r = run([needsYou('s1', { waitingFor: 'Allow *Bash*: rm -rf [x]?' }), other('s2'), other('s3', 'working')]);
  assert.equal(r.opened.length, 1);
  assert.deepEqual([r.updated, r.resolved], [[], []]);
  const [item] = openStatus(store);
  assert.equal(item.id, r.opened[0]);
  assert.equal(item.kind, 'blocked');
  assert.equal(item.sessionId, 's1');
  assert.equal(item.blocking, true);
  assert.equal(item.urgency, 'normal');
  assert.equal(item.title, 'Waiting for you: Allow *Bash*: rm -rf [x]?');
  assert.equal(item.body, 'Allow \\*Bash\\*: rm \\-rf \\[x\\]?');
  assert.equal(item.dedupeKey, 'status:s1:1000');
  assert.deepEqual(item.status, { waitingFor: 'Allow *Bash*: rm -rf [x]?', waitingReason: null, episode: 's1:1000' });
  assert.equal(item.createdAt, now());
  assert.equal(item.readAt, null);
});

test('the episode falls back to now when updatedAt is missing, and an empty waitingFor still opens', () => {
  const { store, run, now } = setup();
  run([needsYou('s1', { updatedAt: null, waitingFor: null })]);
  const [item] = openStatus(store);
  assert.equal(item.dedupeKey, `status:s1:${now()}`);
  assert.equal(item.title, 'Session needs you');
  assert.equal(item.body, '');
  assert.deepEqual(item.status.waitingFor, null);
});

test('a blocking api error is high urgency', () => {
  const { store, run } = setup();
  run([needsYou('s1', { waitingFor: 'Credit balance is too low', waitingReason: 'api-error-blocking' })]);
  const [item] = openStatus(store);
  assert.equal(item.urgency, 'high');
  assert.equal(item.title, 'API error — action needed');
});

test('a repeated snapshot (three tabs) opens one item and does not touch the store', () => {
  const { store, run } = setup();
  const snap = [needsYou('s1'), other('s2')];
  assert.equal(run(snap).opened.length, 1);
  const rev = store.rev();
  for (let tab = 0; tab < 3; tab++) assert.deepEqual(run(structuredClone(snap)), { opened: [], updated: [], resolved: [] });
  assert.equal(openStatus(store).length, 1);
  assert.equal(store.rev(), rev);
});

test('two sessions in needs-you get one item each', () => {
  const { store, run } = setup();
  run([needsYou('s1'), needsYou('s2', { updatedAt: 2000 })]);
  assert.deepEqual(openStatus(store).map((i) => i.sessionId).sort(), ['s1', 's2']);
});

test('a changed waitingFor updates in place without resetting readAt', () => {
  const { store, run, now } = setup();
  const [id] = run([needsYou('s1', { waitingFor: 'permission to run Bash' })]).opened;
  now.tick(1000);
  store.markRead([id]);
  const readAt = store.get(id).readAt;
  now.tick(1000);
  const r = run([needsYou('s1', { waitingFor: 'trust dialog' })]);
  assert.deepEqual(r, { opened: [], updated: [id], resolved: [] });
  const item = store.get(id);
  assert.equal(item.readAt, readAt);
  assert.equal(item.title, 'Confirm folder trust');
  assert.equal(item.body, 'trust dialog');
  assert.equal(item.status.waitingFor, 'trust dialog');
  assert.equal(item.createdAt, 100_000);
  assert.equal(item.dedupeKey, 'status:s1:1000');
  assert.equal(openStatus(store).length, 1);
});

test('an updatedAt that drifts inside an episode keeps the same item', () => {
  const { store, run } = setup();
  const [id] = run([needsYou('s1', { updatedAt: 1000 })]).opened;
  assert.deepEqual(run([needsYou('s1', { updatedAt: 1500 })]), { opened: [], updated: [], resolved: [] });
  assert.equal(openStatus(store)[0].id, id);
  assert.equal(openStatus(store)[0].dedupeKey, 'status:s1:1000');
});

test('resolves as status-cleared when the status changes', () => {
  const { store, run } = setup();
  const [id] = run([needsYou('s1')]).opened;
  const r = run([other('s1', 'working')]);
  assert.deepEqual(r, { opened: [], updated: [], resolved: [id] });
  const item = store.get(id);
  assert.deepEqual([item.state, item.resolvedReason], ['resolved', 'status-cleared']);
  assert.deepEqual(run([other('s1', 'idle')]), { opened: [], updated: [], resolved: [] });
});

test('resolves as status-cleared when the session is absent from the snapshot', () => {
  const { store, run } = setup();
  const [a] = run([needsYou('s1'), needsYou('s2', { updatedAt: 2000 })]).opened;
  const r = run([needsYou('s2', { updatedAt: 2000 })]);
  assert.deepEqual(r.resolved, [a]);
  assert.equal(store.get(a).resolvedReason, 'status-cleared');
  assert.equal(openStatus(store).length, 1);
  run([]);
  assert.equal(openStatus(store).length, 0);
});

test('a transient api error is excluded by default and included by the setting', () => {
  const off = setup();
  const transient = needsYou('s1', { waitingFor: 'Request timed out.', waitingReason: 'api-error' });
  assert.deepEqual(off.run([transient]), { opened: [], updated: [], resolved: [] });
  off.settings.includeTransientApiErrors = false;
  assert.equal(off.run([transient]).opened.length, 0);
  assert.equal(off.store.snapshot().length, 0);
  // a blocking one is never excluded
  assert.equal(off.run([needsYou('s2', { waitingReason: 'api-error-blocking' })]).opened.length, 1);

  const on = setup({ includeTransientApiErrors: true });
  const r = on.run([transient]);
  assert.equal(r.opened.length, 1);
  assert.equal(on.store.get(r.opened[0]).title, 'API error — retry');
});

test('a dismissed episode stays dismissed until the status clears, then the next episode reopens', () => {
  const { store, run } = setup();
  const [id] = run([needsYou('s1', { updatedAt: 1000 })]).opened;
  store.resolve(id, 'dismissed');
  // still needs-you, including with updatedAt drifting: stays dismissed
  assert.deepEqual(run([needsYou('s1', { updatedAt: 1000 })]), { opened: [], updated: [], resolved: [] });
  assert.deepEqual(run([needsYou('s1', { updatedAt: 1700 })]), { opened: [], updated: [], resolved: [] });
  assert.deepEqual(run([needsYou('s1', { updatedAt: 2300, waitingFor: 'something else' })]), { opened: [], updated: [], resolved: [] });
  assert.equal(openStatus(store).length, 0);
  // the status clears, then a new episode
  run([other('s1', 'working')]);
  const r = run([needsYou('s1', { updatedAt: 5000 })]);
  assert.equal(r.opened.length, 1);
  assert.equal(store.get(r.opened[0]).dedupeKey, 'status:s1:5000');
});

test('a dismissed episode stays dismissed across a restart (fresh state, same store)', () => {
  const { store, run, now } = setup();
  const [id] = run([needsYou('s1', { updatedAt: 1000 })]).opened;
  store.resolve(id, 'dismissed');
  const restarted = (observed) => reconcile(store, observed, { settings: {}, now, state: createReconcileState() });
  assert.deepEqual(restarted([needsYou('s1', { updatedAt: 1000 })]), { opened: [], updated: [], resolved: [] });
  assert.equal(openStatus(store).length, 0);
  // and the next episode is announced
  assert.equal(restarted([needsYou('s1', { updatedAt: 9000 })]).opened.length, 1);
});

test('a status-cleared episode that comes back is a new item', () => {
  const { store, run } = setup();
  const [a] = run([needsYou('s1', { updatedAt: 1000 })]).opened;
  run([other('s1', 'working')]);
  const [b] = run([needsYou('s1', { updatedAt: 3000 })]).opened;
  assert.notEqual(a, b);
  assert.equal(store.snapshot().filter((i) => i.sessionId === 's1').length, 2);
});

test('the task id comes from taskIdFor', () => {
  const { store, run } = setup();
  const [id] = run([needsYou('s1')], { taskIdFor: (sid) => (sid === 's1' ? 'task-1' : null) }).opened;
  assert.equal(store.get(id).taskId, 'task-1');
});

test('a bad item is logged and skipped, not thrown', () => {
  const { store, run } = setup();
  const logged = [];
  const r = run([needsYou('x'.repeat(201)), needsYou('s1')], { log: (m) => logged.push(m) });
  assert.equal(r.opened.length, 1);
  assert.equal(openStatus(store)[0].sessionId, 's1');
  store.create = () => { throw new Error('the inbox is full'); };
  run([needsYou('s2', { updatedAt: 2 })], { log: (m) => logged.push(m) });
  assert.match(logged.join('\n'), /not created: the inbox is full/);
});

test('status items are untouched by agent items and vice versa', () => {
  const { store, run, now } = setup();
  const a = store.create({ source: 'agent', kind: 'question', sessionId: 's1', title: 'ask' });
  now.tick(60_000);
  assert.deepEqual(run([needsYou('s1')]).resolved, []);
  assert.equal(store.get(a.id).state, 'open');
  assert.deepEqual(run([other('s1', 'idle')]).resolved.length, 1); // only the status item
  assert.equal(store.get(a.id).state, 'open');
});

// ---- answered elsewhere ----

function agentItem(f, extra = {}) {
  return f.store.create({ source: 'agent', kind: 'decision', sessionId: 's1', title: 'Pick one', ...extra });
}

test('answered-elsewhere needs the idle then working sequence, and the grace', () => {
  const f = setup();
  const item = agentItem(f);
  const { run, now, store } = f;
  // created mid-turn: working straight away is not "answered elsewhere"
  now.tick(60_000);
  assert.deepEqual(run([other('s1', 'working')]).resolved, []);
  assert.equal(store.get(item.id).state, 'open');
  // the turn ends: idle seen
  assert.deepEqual(run([other('s1', 'idle')]).resolved, []);
  // working again, but inside the grace window of an item created only just now
  const fresh = agentItem(f, { title: 'Fresh', dedupeKey: 'k2' });
  run([other('s1', 'idle')]);
  now.tick(5000);
  const r1 = run([other('s1', 'working')]);
  assert.deepEqual(r1.resolved, [item.id]);
  assert.equal(store.get(fresh.id).state, 'open');
  now.tick(11_000);
  const r2 = run([other('s1', 'working')]);
  assert.deepEqual(r2.resolved, [fresh.id]);
  assert.deepEqual([store.get(fresh.id).state, store.get(fresh.id).resolvedReason], ['resolved', 'answered-elsewhere']);
});

test('answered-elsewhere: needs-you counts as seen, and the grace is strictly more than 15 s', () => {
  const f = setup();
  const item = agentItem(f);
  f.run([needsYou('s1')]);
  f.now.tick(15_000);
  assert.deepEqual(f.run([other('s1', 'working')]).resolved.filter((id) => id === item.id), []);
  f.now.tick(1);
  assert.deepEqual(f.run([other('s1', 'working')]).resolved, [item.id]);
});

test('answered-elsewhere ignores non-blocking, answered and absent-session items', () => {
  const f = setup();
  const nonBlocking = agentItem(f, { blocking: false, dedupeKey: 'nb' });
  const answeredItem = agentItem(f, { dedupeKey: 'ans', options: [{ id: 'a', label: 'A' }] });
  const gone = f.store.create({ source: 'agent', kind: 'question', sessionId: 'ghost', title: 'q' });
  f.run([other('s1', 'idle'), other('ghost', 'idle')]);
  f.store.answer(answeredItem.id, { optionId: 'a' });
  f.now.tick(60_000);
  const r = f.run([other('s1', 'working')]);
  assert.deepEqual(r.resolved, []);
  assert.equal(f.store.get(nonBlocking.id).state, 'open');
  assert.equal(f.store.get(answeredItem.id).state, 'answered');
  assert.equal(f.store.get(gone.id).state, 'open');
});

test('autoResolveOnWorking = false disables answered-elsewhere', () => {
  const f = setup({ autoResolveOnWorking: false });
  const item = agentItem(f);
  f.run([other('s1', 'idle')]);
  f.now.tick(60_000);
  assert.deepEqual(f.run([other('s1', 'working')]).resolved, []);
  assert.equal(f.store.get(item.id).state, 'open');
  // switching it on later applies from then on
  f.settings.autoResolveOnWorking = true;
  assert.deepEqual(f.run([other('s1', 'working')]).resolved, [item.id]);
});

test('settings may be a host.settings-style view', () => {
  const f = setup();
  const item = agentItem(f);
  f.run([other('s1', 'idle')]);
  f.now.tick(60_000);
  const view = { get: (k) => (k === 'autoResolveOnWorking' ? false : undefined) };
  assert.deepEqual(f.run([other('s1', 'working')], { settings: view }).resolved, []);
  assert.deepEqual(f.run([other('s1', 'working')], { settings: { get: () => undefined } }).resolved, [item.id]);
});
