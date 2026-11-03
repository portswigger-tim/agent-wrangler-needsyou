import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerText, deliverAnswer } from './answer.js';
import { fakeHost, seq, clock } from './test-helpers.js';

function answered(f, answer, extra = {}) {
  const item = f.store.create({
    source: 'agent', kind: 'decision', sessionId: 's1', title: 'Migrate in place or behind a copy?',
    options: [{ id: 'copy', label: 'Behind a copy' }, { id: 'in-place', label: 'In place' }], allowFreeText: true, ...extra,
  });
  return f.store.answer(item.id, answer);
}

test('the delivered text matches contracts §6 byte for byte', () => {
  const f = fakeHost({ now: clock(), idGen: seq() });
  const both = answered(f, { optionId: 'copy', text: 'Keep the copy for a week.' });
  assert.equal(answerText(both),
    '[Needs you] The human answered your request "Migrate in place or behind a copy?" (ibx_000000000001).\n'
    + 'Choice: Behind a copy (copy)\n'
    + 'Note: Keep the copy for a week.');
});

test('the Choice and Note lines are omitted when empty', () => {
  const f = fakeHost({ now: clock(), idGen: seq() });
  const choice = answered(f, { optionId: 'in-place' });
  assert.equal(answerText(choice),
    '[Needs you] The human answered your request "Migrate in place or behind a copy?" (ibx_000000000001).\n'
    + 'Choice: In place (in-place)');
  const free = f.store.answer(f.store.create({ source: 'agent', kind: 'question', sessionId: 's1', title: 'Which region?' }).id, { text: 'eu-west-1' });
  assert.equal(answerText(free),
    '[Needs you] The human answered your request "Which region?" (ibx_000000000002).\n'
    + 'Note: eu-west-1');
});

test('live and dormant both count as delivered and resolve the item', async () => {
  for (const mode of ['live', 'dormant']) {
    const f = fakeHost({ sessions: [{ sessionId: 's1', dormant: mode === 'dormant' }], now: clock(), idGen: seq() });
    const item = answered(f, { optionId: 'copy' });
    const out = await deliverAnswer(f.host, f.store, item.id);
    assert.equal(out.state, 'resolved');
    assert.equal(out.resolvedReason, 'delivered');
    assert.equal(out.answer.attempts, 1);
    assert.deepEqual(f.calls.deliver, [{ sessionId: 's1', text: answerText(item) }]);
  }
});

test('a refusal is recorded as failed with its error verbatim, not thrown', async () => {
  const f = fakeHost({ sessions: [{ sessionId: 's1', archived: true }], now: clock(), idGen: seq() });
  const item = answered(f, { optionId: 'copy' });
  const out = await deliverAnswer(f.host, f.store, item.id);
  assert.equal(out.state, 'answered');
  assert.equal(out.answer.delivery, 'failed');
  assert.equal(out.answer.deliveryError, 'Session s1 is archived.');
  assert.equal(out.answer.attempts, 1);
});

test('a throwing or odd host.deliver is also a failure, and long errors are clipped', async () => {
  const thrower = fakeHost({ deliver: () => { throw new Error('x'.repeat(900)); }, now: clock(), idGen: seq() });
  const a = answered(thrower, { optionId: 'copy' });
  const out = await deliverAnswer(thrower.host, thrower.store, a.id);
  assert.equal(out.answer.delivery, 'failed');
  assert.equal(out.answer.deliveryError.length, 500);

  const odd = fakeHost({ deliver: () => ({ ok: true }), now: clock(), idGen: seq() });
  const b = answered(odd, { optionId: 'copy' });
  const res = await deliverAnswer(odd.host, odd.store, b.id);
  assert.equal(res.answer.delivery, 'failed', '{ ok } is not the deliver contract');
  assert.match(res.answer.deliveryError, /unexpected result/);
});

test('an item closed while deliver was in flight is left as it is', async () => {
  let f;
  f = fakeHost({
    sessions: [{ sessionId: 's1' }],
    deliver: () => { f.store.resolve(id, 'withdrawn'); return { mode: 'live' }; },
    now: clock(),
    idGen: seq(),
  });
  const { id } = answered(f, { optionId: 'copy' });
  const out = await deliverAnswer(f.host, f.store, id);
  assert.equal(out.state, 'resolved');
  assert.equal(out.resolvedReason, 'withdrawn');
});

test('deliverAnswer refuses an item that is not answered', async () => {
  const f = fakeHost({ now: clock(), idGen: seq() });
  const open = f.store.create({ source: 'agent', kind: 'question', sessionId: 's1', title: 'q' });
  await assert.rejects(deliverAnswer(f.host, f.store, open.id), /open, not answered/);
  await assert.rejects(deliverAnswer(f.host, f.store, 'ibx_nope'), /unknown inbox item/);
  assert.equal(f.calls.deliver.length, 0);
});
