import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferTerminal, wantsTerminal, SESSION_VIEW_KEY } from './inbox-session-view.js';

function memory(initial) {
  const m = new Map(initial === undefined ? [] : [[SESSION_VIEW_KEY, initial]]);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), read: () => JSON.parse(m.get(SESSION_VIEW_KEY)) };
}

test('preferTerminal sets the session to terminal and keeps the others', () => {
  const s = memory(JSON.stringify({ a: 'chat', b: 'chat' }));
  preferTerminal('b', s);
  assert.deepEqual(s.read(), { a: 'chat', b: 'terminal' });
});

test('preferTerminal starts afresh on a missing or corrupt value', () => {
  for (const v of [undefined, 'not json', '"x"', '[1]', 'null']) {
    const s = memory(v);
    preferTerminal('a', s);
    assert.deepEqual(s.read(), { a: 'terminal' });
  }
});

test('preferTerminal never throws when storage does', () => {
  const s = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.doesNotThrow(() => preferTerminal('a', s));
});

test('only an open status item wants the terminal', () => {
  assert.equal(wantsTerminal({ source: 'status', state: 'open' }), true);
  assert.equal(wantsTerminal({ source: 'status', state: 'resolved' }), false);
  assert.equal(wantsTerminal({ source: 'agent', state: 'open' }), false);
});
