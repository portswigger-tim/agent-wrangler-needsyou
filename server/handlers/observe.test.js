import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { inboxHandlers } from './index.js';
import { observeHandler, observeHandlers } from './observe.js';
import { resetReconcileState } from '../reconcile.js';
import { fakeHost, seq } from '../test-helpers.js';

const observe = inboxHandlers.find((h) => h.type === 'inbox-observe').handler;
const s = (sessionId, extra = {}) => ({ sessionId, status: 'idle', waitingFor: null, waitingReason: null, updatedAt: null, ...extra });
const needsYou = (sessionId, extra = {}) => s(sessionId, { status: 'needs-you', waitingFor: 'trust dialog', updatedAt: 1000, ...extra });
const msg = (sessions, extra = {}) => ({ type: 'inbox-observe', sessions, complete: true, ...extra });

beforeEach(() => resetReconcileState());

test('the handler is registered once under inbox-observe', () => {
  assert.deepEqual(observeHandlers, [observeHandler]);
  assert.equal(inboxHandlers.filter((h) => h.type === 'inbox-observe').length, 1);
});

test('opens an item and rebuilds; a repeat from another tab does neither', async () => {
  const { host, store, calls } = fakeHost({ sessions: [{ sessionId: 's1', taskId: 't1' }], idGen: seq() });
  await observe(msg([needsYou('s1'), s('s2')]), host);
  assert.equal(calls.rebuild, 1);
  const [item] = store.snapshot();
  assert.deepEqual([item.sessionId, item.kind, item.taskId], ['s1', 'blocked', 't1']);
  await observe(msg([needsYou('s1'), s('s2')]), host);
  await observe(msg([s('s2'), needsYou('s1')]), host);
  assert.equal(calls.rebuild, 1);
  assert.equal(store.snapshot().length, 1);
});

test('rebuilds again when the item updates and when it resolves', async () => {
  const { host, store, calls } = fakeHost({ idGen: seq() });
  await observe(msg([needsYou('s1')]), host);
  await observe(msg([needsYou('s1', { waitingFor: 'permission to run Bash' })]), host);
  assert.equal(calls.rebuild, 2);
  await observe(msg([s('s1', { status: 'working' })]), host);
  assert.equal(calls.rebuild, 3);
  assert.equal(store.snapshot()[0].resolvedReason, 'status-cleared');
});

test('reads the settings through host.settings', async () => {
  const f = fakeHost({ idGen: seq(), settings: { includeTransientApiErrors: true } });
  await observe(msg([needsYou('s1', { waitingReason: 'api-error', waitingFor: 'Request timed out.' })]), f.host);
  assert.equal(f.store.snapshot().length, 1);
  const g = fakeHost({ idGen: seq() });
  await observe(msg([needsYou('s1', { waitingReason: 'api-error', waitingFor: 'Request timed out.' })]), g.host);
  assert.equal(g.store.snapshot().length, 0);
  assert.equal(g.calls.rebuild, 0);
});

test('accepts missing optional fields and an empty list', async () => {
  const { host, store } = fakeHost({ idGen: seq() });
  await observe(msg([{ sessionId: 's1', status: 'needs-you' }]), host);
  assert.equal(store.snapshot()[0].title, 'Session needs you');
  await observe(msg([]), host);
  assert.equal(store.snapshot()[0].state, 'resolved');
});

test('validates the payload', async () => {
  const { host, calls, store } = fakeHost();
  const bad = [
    [null, /complete: true/],
    [{ sessions: [] }, /complete: true/],
    [{ sessions: [], complete: false }, /complete: true/],
    [{ complete: true }, /an array of at most 500/],
    [msg('x'), /an array of at most 500/],
    [msg(Array.from({ length: 501 }, (_, i) => s(`s${i}`))), /an array of at most 500/],
    [msg(['x']), /sessions\[0\] must be an object/],
    [msg([null]), /sessions\[0\] must be an object/],
    [msg([s('')]), /must not be empty/],
    [msg([s(7)]), /sessionId must be a string/],
    [msg([s('a'.repeat(501))]), /sessionId must be at most 500/],
    [msg([{ ...s('a'), status: undefined }]), /status must be a string/],
    [msg([s('a', { status: 'x'.repeat(501) })]), /status must be at most 500/],
    [msg([s('a', { waitingFor: 5 })]), /waitingFor must be a string or null/],
    [msg([s('a', { waitingReason: 'r'.repeat(501) })]), /waitingReason must be at most 500/],
    [msg([s('a', { updatedAt: 'soon' })]), /updatedAt must be a number or null/],
  ];
  for (const [m, re] of bad) await assert.rejects(observe(m, host), re);
  assert.equal(calls.rebuild, 0);
  assert.equal(store.snapshot().length, 0);
  await observe(msg(Array.from({ length: 500 }, (_, i) => s(`s${i}`))), host);
});
