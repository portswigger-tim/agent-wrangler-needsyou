import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { patchList } from './inbox-dom.js';

function setup() {
  const { document } = new Window();
  const list = document.createElement('div');
  document.body.appendChild(list);
  const opts = {
    key: (e) => e.id,
    create: () => document.createElement('div'),
    update: (row, e) => { row.textContent = e.text; },
  };
  return { list, opts };
}

test('rows are reused by key and reordered without being replaced', () => {
  const { list, opts } = setup();
  const [a, b] = patchList(list, [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], opts);
  const rows = patchList(list, [{ id: 'b', text: 'B2' }, { id: 'a', text: 'A' }, { id: 'c', text: 'C' }], opts);
  assert.equal(rows[0], b);
  assert.equal(rows[1], a);
  assert.deepEqual([...list.children].map((r) => r.textContent), ['B2', 'A', 'C']);
});

test('a gone key is removed at once without leaveMs, or fades and goes after it', () => {
  const { list, opts } = setup();
  patchList(list, [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], opts);
  patchList(list, [{ id: 'b', text: 'B' }], opts);
  assert.deepEqual([...list.children].map((r) => r.textContent), ['B']);

  const scheduled = [];
  const fading = { ...opts, leaveMs: 200, schedule: (fn, ms) => scheduled.push({ fn, ms }) };
  patchList(list, [{ id: 'b', text: 'B' }, { id: 'c', text: 'C' }], fading);
  patchList(list, [{ id: 'c', text: 'C' }], fading);
  const leaving = list.querySelector('.ibx-leaving');
  assert.equal(leaving.textContent, 'B');
  assert.equal(scheduled[0].ms, 200);
  scheduled[0].fn();
  assert.deepEqual([...list.children].map((r) => r.textContent), ['C']);
});

test('a key that comes back revives its leaving row', () => {
  const { list, opts } = setup();
  const fading = { ...opts, leaveMs: 200, schedule: () => {} };
  const [a] = patchList(list, [{ id: 'a', text: 'A' }], fading);
  patchList(list, [], fading);
  assert.ok(a.classList.contains('ibx-leaving'));
  const [again] = patchList(list, [{ id: 'a', text: 'A' }], fading);
  assert.equal(again, a);
  assert.ok(!a.classList.contains('ibx-leaving'));
});
