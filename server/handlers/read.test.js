import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxHandlers } from './index.js';
import { fakeHost, seq, clock } from '../test-helpers.js';

const handler = (type) => inboxHandlers.find((h) => h.type === type).handler;
const markRead = handler('inbox-mark-read');
const dismiss = handler('inbox-dismiss');

function setup() {
  const f = fakeHost({ now: clock(), idGen: seq() });
  const a = f.store.create({ source: 'agent', kind: 'question', sessionId: 's1', title: 'q' });
  const s = f.store.create({ source: 'status', kind: 'blocked', sessionId: 's1', title: 'blocked', dedupeKey: 'status:s1:e1', status: { waitingFor: null, waitingReason: null, episode: 'e1' } });
  return { ...f, a, s };
}

test('handler types are unique and namespaced', () => {
  const types = inboxHandlers.map((h) => h.type);
  assert.ok(types.includes('inbox-mark-read') && types.includes('inbox-dismiss'));
  assert.equal(new Set(types).size, types.length);
  assert.ok(types.every((t) => t.startsWith('inbox-')));
});

test('inbox-mark-read marks known ids, ignores unknown ones and rebuilds on change', async () => {
  const { host, store, calls, a } = setup();
  await markRead({ type: 'inbox-mark-read', ids: [a.id, 'ibx_unknown', 'not-an-id'] }, host);
  assert.notEqual(store.get(a.id).readAt, null);
  assert.equal(calls.rebuild, 1);
  await markRead({ ids: [a.id] }, host);
  await markRead({ ids: [] }, host);
  assert.equal(calls.rebuild, 1);
});

test('inbox-mark-read validates its payload', async () => {
  const { host, calls } = setup();
  for (const msg of [{}, { ids: 'x' }, { ids: [1] }, { ids: Array(201).fill('ibx_x') }, null]) {
    await assert.rejects(markRead(msg, host), /ids: an array of at most 200/);
  }
  await markRead({ ids: Array(200).fill('ibx_x') }, host);
  assert.equal(calls.rebuild, 0);
});

test('inbox-dismiss resolves as dismissed, is idempotent, and refuses unknown ids', async () => {
  const { host, store, calls, s } = setup();
  await dismiss({ id: s.id }, host);
  assert.deepEqual([store.get(s.id).state, store.get(s.id).resolvedReason], ['resolved', 'dismissed']);
  assert.equal(calls.rebuild, 1);
  await dismiss({ id: s.id }, host);
  assert.equal(calls.rebuild, 1);
  await assert.rejects(dismiss({ id: 'ibx_unknown' }, host), /unknown inbox item/);
  await assert.rejects(dismiss({}, host), /needs an item id/);
});
