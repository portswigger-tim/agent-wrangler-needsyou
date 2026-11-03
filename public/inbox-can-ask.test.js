import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAskItems, canAskAction } from './inbox-can-ask.js';
import { ICONS } from './icons.js';
import { graphOf } from '../test/fixtures/inbox.js';

const g = graphOf([], {
  sessions: {
    w1: { name: 'Worker', spawnedBy: 'o1', canAsk: false, canAskOverride: null },
    w2: { name: 'Worker 2', spawnedBy: 'o1', canAsk: true, canAskOverride: true },
    top: { name: 'Mine', spawnedBy: null, canAsk: true, canAskOverride: null },
    off: { name: 'Muted', spawnedBy: null, canAsk: false, canAskOverride: false },
  },
});

function run(sessionId) {
  const sent = [];
  const items = canAskItems({ sessionId }, g, { send: (f) => sent.push(f) });
  assert.equal(items.length, 1, 'one item (F7, C5)');
  assert.equal(items[0].icon, ICONS.inbox);
  items[0].run();
  return { label: items[0].label, hint: items[0].hint, allowed: sent.map((f) => {
    assert.equal(f.type, 'inbox-set-can-ask');
    assert.equal(f.sessionId, sessionId);
    return f.allowed;
  }) };
}

// C5: one fixed label; the tick shows the effective canAsk; the click flips it.
test('spawned, no override: unticked, and the click allows it', () => {
  assert.deepEqual(run('w1'), { label: 'Let it ask you directly', hint: undefined, allowed: [true] });
});

test('spawned, allowed: ticked, and the click clears the override', () => {
  assert.deepEqual(run('w2'), { label: 'Let it ask you directly', hint: '✓', allowed: [null] });
});

test('top-level, no override: ticked, and the click refuses it', () => {
  assert.deepEqual(run('top'), { label: 'Let it ask you directly', hint: '✓', allowed: [false] });
});

test('top-level, refused: unticked, and the click clears the override', () => {
  assert.deepEqual(run('off'), { label: 'Let it ask you directly', hint: undefined, allowed: [null] });
});

test('an unticked item carries no hint at all', () => {
  const [it] = canAskItems({ sessionId: 'w1' }, g, { send() {} });
  assert.ok(!Object.hasOwn(it, 'hint'));
});

test('no item for a card the inbox graph does not know', () => {
  const api = { send: () => assert.fail('sent') };
  assert.deepEqual(canAskItems({ sessionId: 'unknown' }, g, api), []);
  assert.deepEqual(canAskItems(null, g, api), []);
  assert.deepEqual(canAskItems({ sessionId: 'w1' }, {}, api), []);
  assert.equal(canAskAction.items, canAskItems);
});
