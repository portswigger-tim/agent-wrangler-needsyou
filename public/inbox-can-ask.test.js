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
  assert.equal(items.length, 1, 'one item per state (F7)');
  assert.equal(items[0].icon, ICONS.inbox);
  items[0].run();
  return { label: items[0].label, hint: items[0].hint, allowed: sent.map((f) => {
    assert.equal(f.type, 'inbox-set-can-ask');
    assert.equal(f.sessionId, sessionId);
    return f.allowed;
  }) };
}

test('spawned, no override: let it ask you directly', () => {
  assert.deepEqual(run('w1'), { label: 'Let it ask you directly', hint: 'asks its orchestrator', allowed: [true] });
});

test('spawned, allowed: send its questions to the orchestrator, by clearing the override', () => {
  assert.deepEqual(run('w2'), { label: 'Send its questions to the orchestrator', hint: 'asks you directly', allowed: [null] });
});

test('top-level, no override: stop it asking you directly', () => {
  assert.deepEqual(run('top'), { label: 'Stop it asking you directly', hint: 'asks you directly', allowed: [false] });
});

test('top-level, refused: let it ask you directly, by clearing the override', () => {
  assert.deepEqual(run('off'), { label: 'Let it ask you directly', hint: 'blocked by you', allowed: [null] });
});

test('no item for a card the inbox graph does not know', () => {
  const api = { send: () => assert.fail('sent') };
  assert.deepEqual(canAskItems({ sessionId: 'unknown' }, g, api), []);
  assert.deepEqual(canAskItems(null, g, api), []);
  assert.deepEqual(canAskItems({ sessionId: 'w1' }, {}, api), []);
  assert.equal(canAskAction.items, canAskItems);
});
