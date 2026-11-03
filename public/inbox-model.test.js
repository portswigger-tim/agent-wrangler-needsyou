import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  queueOrder, queueTier, recentItems, kindLabel, resolvedLabel, ageLabel, waitingLabel,
  sessionMeta, spawnedByLabel, nextAfter, answerPayload, stopsWork,
} from './inbox-model.js';

import { item } from './inbox-fixtures.js';

const failed = (over = {}) => item({ state: 'answered', answer: { optionId: null, text: 'x', at: 1, delivery: 'failed', deliveryError: 'gone', attempts: 1 }, ...over });

test('queueOrder puts every tier in cost-of-waiting order', () => {
  const nonBlocking = item({ blocking: false, createdAt: 1 });
  const fail = failed({ createdAt: 0 });
  const normal = item({ createdAt: 2 });
  const high = item({ urgency: 'high', createdAt: 3 });
  const blocked = item({ source: 'status', kind: 'blocked', createdAt: 4 });
  const order = queueOrder([nonBlocking, fail, normal, high, blocked]);
  assert.deepEqual(order.map((i) => i.id), [blocked, high, normal, nonBlocking, fail].map((i) => i.id));
  assert.deepEqual(order.map(queueTier), [0, 1, 2, 3, 4]);
});

test('queueOrder breaks ties by age, oldest first, then by id', () => {
  const young = item({ source: 'status', kind: 'blocked', createdAt: 50 });
  const old = item({ source: 'status', kind: 'blocked', createdAt: 10 });
  const twinA = item({ id: 'ibx_a', createdAt: 5 });
  const twinB = item({ id: 'ibx_b', createdAt: 5 });
  const highNew = item({ urgency: 'high', createdAt: 99 });
  const highOld = item({ urgency: 'high', createdAt: 1 });
  assert.deepEqual(queueOrder([twinB, young, highNew, twinA, old, highOld]).map((i) => i.id),
    [old.id, young.id, highOld.id, highNew.id, 'ibx_a', 'ibx_b']);
});

test('queueOrder leaves out resolved items and answers still being delivered', () => {
  const pending = item({ state: 'answered', answer: { delivery: 'pending' } });
  const done = item({ state: 'resolved', resolvedReason: 'delivered' });
  const open = item();
  assert.deepEqual(queueOrder([pending, done, open]).map((i) => i.id), [open.id]);
});

test('recentItems lists resolved and in-flight answers, newest first', () => {
  const a = item({ state: 'resolved', resolvedReason: 'dismissed', updatedAt: 5 });
  const b = item({ state: 'answered', answer: { delivery: 'pending' }, updatedAt: 9 });
  const c = item({ state: 'open' });
  const d = failed();
  assert.deepEqual(recentItems([a, b, c, d]).map((i) => i.id), [b.id, a.id]);
});

test('labels', () => {
  assert.equal(kindLabel('blocked'), 'Blocked');
  assert.equal(kindLabel('approval'), 'Approval');
  const reasons = {
    delivered: 'answered', withdrawn: 'withdrawn by agent', 'answered-elsewhere': 'answered in the session',
    'status-cleared': 'resolved in the session', dismissed: 'dismissed', 'session-archived': 'session archived', expired: 'expired',
  };
  for (const [reason, label] of Object.entries(reasons)) assert.equal(resolvedLabel({ state: 'resolved', resolvedReason: reason }), label);
  assert.equal(resolvedLabel({ state: 'answered' }), 'sending');
});

test('ages read as waiting time', () => {
  assert.equal(ageLabel(0, 30_000), '<1m');
  assert.equal(ageLabel(0, 12 * 60_000), '12m');
  assert.equal(ageLabel(0, 3 * 3_600_000), '3h');
  assert.equal(ageLabel(0, 50 * 3_600_000), '2d');
  assert.equal(waitingLabel({ createdAt: 0 }, 12 * 60_000), 'waiting 12m');
});

test('session meta and spawned-by come from graph.inbox.sessions, falling back to core sessions', () => {
  const graph = {
    sessions: [{ sessionId: 'orch', name: 'Orchestrator' }],
    inbox: { items: [], sessions: { s1: { name: 'Worker', taskName: 'Auth', spawnedBy: 'orch' } } },
  };
  assert.equal(sessionMeta(graph, { sessionId: 's1' }), 'Worker · Auth');
  assert.equal(spawnedByLabel(graph, { sessionId: 's1', source: 'status' }), 'spawned by Orchestrator');
  assert.equal(spawnedByLabel(graph, { sessionId: 's1', source: 'agent' }), '');
});

test('nextAfter picks the item that followed the one that left', () => {
  const ids = (xs) => xs.map((id) => ({ id }));
  assert.equal(nextAfter(['a', 'b', 'c'], 'b', ids(['a', 'c'])), 'c');
  assert.equal(nextAfter(['a', 'b', 'c'], 'c', ids(['a', 'b'])), 'b');
  assert.equal(nextAfter(['a', 'b'], 'a', ids(['x', 'b'])), 'b');
  assert.equal(nextAfter(['a'], 'a', []), null);
});

test('answerPayload mirrors the store rules', () => {
  const opts = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];
  const choiceOnly = item({ options: opts, allowFreeText: false });
  assert.equal(answerPayload(choiceOnly, {}), null);
  assert.deepEqual(answerPayload(choiceOnly, { optionId: 'yes', text: 'ignored' }), { type: 'inbox-answer', id: choiceOnly.id, optionId: 'yes' });
  assert.equal(answerPayload(choiceOnly, { optionId: 'nope' }), null);
  const both = item({ options: opts, allowFreeText: true });
  assert.deepEqual(answerPayload(both, { optionId: 'no', text: ' because ' }), { type: 'inbox-answer', id: both.id, optionId: 'no', text: 'because' });
  assert.deepEqual(answerPayload(both, { text: 'neither' }), { type: 'inbox-answer', id: both.id, text: 'neither' });
  const text = item();
  assert.equal(answerPayload(text, { text: '   ' }), null);
  assert.equal(answerPayload(text, { text: 'x'.repeat(4001) }), null);
});

test('only blocked and blocking items stop work', () => {
  assert.equal(stopsWork(item({ source: 'status', kind: 'blocked', blocking: true })), true);
  assert.equal(stopsWork(item({ blocking: true })), true);
  assert.equal(stopsWork(item({ blocking: false })), false);
});
