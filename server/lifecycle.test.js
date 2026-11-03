import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHost, clock } from './test-helpers.js';
import { lifecycleHooks } from './lifecycle.js';

const req = (sessionId, n) => ({ source: 'agent', kind: 'question', sessionId, title: `Q${n}`, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] });

test('onArchive resolves open and answered-pending items, leaves other sessions', async () => {
  const { host, store, calls } = fakeHost({ now: clock() });
  const a = store.create(req('s1', 1));
  const b = store.create(req('s1', 2));
  const c = store.create(req('s2', 3));
  store.answer(b.id, { optionId: 'yes' });
  store.setDelivery(b.id, { delivery: 'pending' });
  await lifecycleHooks.onArchive({ sessionId: 's1', host });
  assert.equal(store.get(a.id).resolvedReason, 'session-archived');
  assert.equal(store.get(b.id).resolvedReason, 'session-archived');
  assert.equal(store.get(c.id).state, 'open');
  assert.equal(calls.rebuild, 1);
});

test('onArchive does not rebuild when nothing changed', async () => {
  const { host, calls } = fakeHost();
  await lifecycleHooks.onArchive({ sessionId: 'nobody', host });
  assert.equal(calls.rebuild, 0);
});

test('onPurge removes items and the can-ask override for that session only', async () => {
  const { host, store, calls } = fakeHost();
  store.create(req('s1', 1));
  const keep = store.create(req('s2', 2));
  store.setCanAskOverride('s1', true);
  await lifecycleHooks.onPurge({ sessionId: 's1', host });
  assert.deepEqual(store.snapshot().map((i) => i.id), [keep.id]);
  assert.equal(store.canAskOverride('s1'), null);
  assert.equal(calls.rebuild, 1);
});

test('hooks swallow a throwing store and log it', async () => {
  const { host } = fakeHost();
  const logged = [];
  host.log = (m) => logged.push(m);
  host.stores = { inbox: { resolveWhere() { throw new Error('boom'); }, forgetSession() { throw new Error('boom'); } } };
  await lifecycleHooks.onArchive({ sessionId: 's1', host });
  await lifecycleHooks.onPurge({ sessionId: 's1', host });
  assert.equal(logged.length, 2);
  await lifecycleHooks.onArchive({ sessionId: 's1', host: {} });
});
