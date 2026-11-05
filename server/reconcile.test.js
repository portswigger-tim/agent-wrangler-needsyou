import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, titleFor, causeFor, bodyFor, createReconcileState } from './reconcile.js';
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
    [['permission prompt', null], 'Permission needed in the session'],
    [['Permission Prompt', null], 'Permission needed in the session'],
    [['input needed', null], 'Question waiting in the session'],
    [['INPUT NEEDED', null], 'Question waiting in the session'],
    [['a permission prompt for Bash', null], 'Waiting for you: a permission prompt for Bash'],
    [['more input needed here', null], 'Waiting for you: more input needed here'],
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

test('causeFor gives each titleFor row its cause, from the same match', () => {
  const cases = [
    [['anything', 'api-error-blocking'], 'api-error'],
    [['The response stopped arriving.', 'api-error'], 'api-error'],
    [[null, 'api-error'], 'api-error'],
    [['permission prompt', null], 'permission'],
    [['Permission Prompt', null], 'permission'],
    [['input needed', null], 'question'],
    [['INPUT NEEDED', null], 'question'],
    [['trust dialog', null], 'trust'],
    [['Codex is asking whether to TRUST this folder', null], 'trust'],
    [['Select login method', null], 'sign-in'],
    [['open oauth/authorize in a browser', null], 'sign-in'],
    [['Codex update finished — restart Codex', null], 'update'],
    [['Codex has a CLI update available', null], 'update'],
    [['container bring-up failed', null], 'container'],
    // Anything else is a tool call waiting for approval, including the regressions
    // that must not be read as one of core's phrases.
    [['Bash: npm update', null], 'permission'],
    [['Bash: npm publish', null], 'permission'],
    [['Bash: npm login', null], 'permission'],
    [['Edit trust-store.js', null], 'permission'],
    [['a permission prompt for Bash', null], 'permission'],
    [['more input needed here', null], 'permission'],
    [[null, null], 'other'],
    [['   ', null], 'other'],
    [[undefined, undefined], 'other'],
  ];
  for (const [[waitingFor, reason], cause] of cases) assert.equal(causeFor(waitingFor, reason), cause, `${waitingFor} / ${reason}`);
});

test('causeFor and titleFor agree on every row', () => {
  const byTitle = {
    'API error — action needed': 'api-error',
    'API error — retry': 'api-error',
    'Session needs you': 'other',
    'Permission needed in the session': 'permission',
    'Question waiting in the session': 'question',
    'Confirm folder trust': 'trust',
    'Sign-in required': 'sign-in',
    'Agent update needs a restart': 'update',
    'Container failed to start': 'container',
  };
  const inputs = ['', 'permission prompt', 'input needed', 'trust dialog', 'whether to trust this folder', 'select login method',
    'oauth/authorize', 'update finished', 'cli update available', 'container bring-up failed', 'Bash: npm update'];
  for (const reason of [null, 'api-error', 'api-error-blocking']) {
    for (const w of inputs) {
      const title = titleFor(w, reason);
      assert.equal(causeFor(w, reason), byTitle[title] ?? (title.startsWith('Waiting for you: ') ? 'permission' : undefined), `${w} / ${reason}`);
    }
  }
});

test('bodyFor leaves out the bare phrases core emits and escapes the rest', () => {
  for (const w of ['permission prompt', 'Input Needed', 'TRUST DIALOG', ' trust dialog\n', null, undefined, '']) assert.equal(bodyFor(w), '', String(w));
  assert.equal(bodyFor('Bash: npm update'), 'Bash: npm update');
  assert.equal(bodyFor('a trust dialog appeared'), 'a trust dialog appeared');
  assert.equal(bodyFor('Allow *Bash*?'), 'Allow \\*Bash\\*?');
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
  assert.deepEqual(item.status, { waitingFor: 'Allow *Bash*: rm -rf [x]?', waitingReason: null, episode: 's1:1000', cause: 'permission' });
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
  assert.equal(item.body, '');
  assert.equal(item.status.waitingFor, 'trust dialog');
  assert.equal(item.status.cause, 'trust');
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

// ---- agent requests ----

function agentItem(f, extra = {}) {
  return f.store.create({ source: 'agent', kind: 'decision', sessionId: 's1', title: 'Pick one', ...extra });
}

test('a session going back to work never closes an agent request (issue #1)', () => {
  const f = setup();
  const blocking = agentItem(f);
  const nonBlocking = agentItem(f, { blocking: false, dedupeKey: 'nb' });
  // The request is raised, the turn ends, then the human sends a message that
  // may or may not answer it and the session works again.
  for (const status of ['working', 'idle', 'needs-you', 'working']) {
    f.now.tick(60_000);
    const observed = status === 'needs-you' ? needsYou('s1') : other('s1', status);
    assert.deepEqual(f.run([observed]).resolved.filter((id) => id === blocking.id || id === nonBlocking.id), []);
  }
  assert.equal(f.store.get(blocking.id).state, 'open');
  assert.equal(f.store.get(nonBlocking.id).state, 'open');
});

test('settings may be a host.settings-style view', () => {
  const f = setup();
  const view = { get: (k) => (k === 'includeTransientApiErrors' ? true : undefined) };
  const r = f.run([needsYou('s1', { waitingFor: 'retrying', waitingReason: 'api-error' })], { settings: view });
  assert.equal(r.opened.length, 1);
});

test('the cause is set on create, from the same table as the title', () => {
  const { store, run } = setup();
  run([
    needsYou('s1', { waitingFor: 'permission prompt' }),
    needsYou('s2', { waitingFor: 'input needed' }),
    needsYou('s3', { waitingFor: 'container bring-up failed' }),
    needsYou('s4', { waitingFor: 'Bash: npm publish' }),
    needsYou('s5', { waitingFor: null }),
    needsYou('s6', { waitingFor: 'Credit balance is too low', waitingReason: 'api-error-blocking' }),
  ]);
  const got = Object.fromEntries(openStatus(store).map((i) => [i.sessionId, [i.status.cause, i.body]]));
  assert.deepEqual(got, {
    s1: ['permission', ''],
    s2: ['question', ''],
    s3: ['container', 'container bring\\-up failed'],
    s4: ['permission', 'Bash: npm publish'],
    s5: ['other', ''],
    s6: ['api-error', 'Credit balance is too low'],
  });
});

test('a changed waitingFor updates the cause and body in place', () => {
  const { store, run } = setup();
  const [id] = run([needsYou('s1', { waitingFor: 'input needed' })]).opened;
  assert.deepEqual([store.get(id).status.cause, store.get(id).body], ['question', '']);
  assert.deepEqual(run([needsYou('s1', { waitingFor: 'Bash: npm update' })]).updated, [id]);
  assert.deepEqual([store.get(id).status.cause, store.get(id).body, store.get(id).title], ['permission', 'Bash: npm update', 'Waiting for you: Bash: npm update']);
  assert.deepEqual(run([needsYou('s1', { waitingFor: 'Bash: npm update', waitingReason: 'api-error-blocking' })]).updated, [id]);
  assert.equal(store.get(id).status.cause, 'api-error');
});

test('an open item from before 0.1.2 (no cause) gets its cause on the next snapshot, once', () => {
  const { store, run } = setup();
  const legacy = store.create({
    source: 'status', kind: 'blocked', sessionId: 's1', title: 'Confirm folder trust', body: 'trust dialog', blocking: true,
    dedupeKey: 'status:s1:1000', status: { waitingFor: 'trust dialog', waitingReason: null, episode: 's1:1000' },
  });
  assert.equal(legacy.status.cause, 'other');
  assert.deepEqual(run([needsYou('s1')]), { opened: [], updated: [legacy.id], resolved: [] });
  assert.deepEqual([store.get(legacy.id).status.cause, store.get(legacy.id).body], ['trust', '']);
  assert.deepEqual(run([needsYou('s1')]), { opened: [], updated: [], resolved: [] });
});
