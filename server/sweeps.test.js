import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHost, clock } from './test-helpers.js';
import { makeSweeps, inboxSweeps } from './sweeps.js';

const DAY = 24 * 60 * 60 * 1000;
const req = (sessionId, extra = {}) => ({ source: 'agent', kind: 'question', sessionId, title: 'Q', options: [{ id: 'yes', label: 'Yes' }], ...extra });
const sweep = (id, sweeps = makeSweeps()) => sweeps.find((s) => s.id === id);
const withLog = (h) => { const logs = []; h.host.log = (m) => logs.push(m); return logs; };

test('sweep entries have the shape the host validates', () => {
  for (const s of inboxSweeps) {
    assert.equal(typeof s.id, 'string');
    assert.ok(Number.isFinite(s.everyMs) && s.everyMs > 0);
    assert.equal(typeof s.run, 'function');
  }
  assert.equal(new Set(inboxSweeps.map((s) => s.id)).size, inboxSweeps.length);
});

test('expiry resolves due open agent items and rebuilds once', async () => {
  const now = clock(1_000_000);
  const h = fakeHost({ now });
  const logs = withLog(h);
  const due = h.store.create(req('s1', { expiresAt: 1_000_100 }));
  const later = h.store.create(req('s1', { expiresAt: 2_000_000 }));
  const never = h.store.create(req('s1'));
  await sweep('expiry').run({ host: h.host });
  assert.equal(h.store.get(due.id).state, 'open');
  assert.equal(h.calls.rebuild, 0);
  assert.equal(logs.length, 0);
  now.set(1_000_100);
  await sweep('expiry').run({ host: h.host });
  assert.equal(h.store.get(due.id).resolvedReason, 'expired');
  assert.equal(h.store.get(later.id).state, 'open');
  assert.equal(h.store.get(never.id).state, 'open');
  assert.equal(h.calls.rebuild, 1);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /Q/);
  await sweep('expiry').run({ host: h.host });
  assert.equal(h.calls.rebuild, 1);
});

test('expiry leaves an answered item alone', async () => {
  const now = clock(1_000_000);
  const h = fakeHost({ now });
  const it = h.store.create(req('s1', { expiresAt: 1_000_100 }));
  h.store.answer(it.id, { optionId: 'yes' });
  now.set(1_000_200);
  await sweep('expiry').run({ host: h.host });
  assert.equal(h.store.get(it.id).state, 'answered');
  assert.equal(h.calls.rebuild, 0);
});

test('retention boundary: exactly N days kept, N days + 1 ms removed', async () => {
  const now = clock(10 * DAY);
  const h = fakeHost({ now, settings: { retentionDays: 3 } });
  const logs = withLog(h);
  const edge = h.store.create(req('s1'));
  const old = h.store.create(req('s1'));
  h.store.resolve(edge.id, 'session-archived');
  h.store.resolve(old.id, 'session-archived');
  const open = h.store.create(req('s1'));
  // age edge to exactly 3 days, old to 3 days + 1 ms
  h.store.items.find((i) => i.id === edge.id).updatedAt = now() - 3 * DAY;
  h.store.items.find((i) => i.id === old.id).updatedAt = now() - 3 * DAY - 1;
  h.store.items.find((i) => i.id === open.id).updatedAt = 0;
  await sweep('retention').run({ host: h.host });
  assert.ok(h.store.get(edge.id));
  assert.equal(h.store.get(old.id), null);
  assert.equal(h.store.get(open.id).state, 'open');
  assert.equal(h.calls.rebuild, 1);
  assert.equal(logs.length, 1);
  await sweep('retention').run({ host: h.host });
  assert.equal(h.calls.rebuild, 1);
  assert.equal(logs.length, 1);
});

test('retention falls back to 7 days when unset or out of range', async () => {
  for (const v of [undefined, 0, 500, 'x']) {
    const now = clock(30 * DAY);
    const h = fakeHost({ now, settings: { retentionDays: v } });
    const a = h.store.create(req('s1'));
    const b = h.store.create(req('s1'));
    h.store.resolve(a.id, 'expired');
    h.store.resolve(b.id, 'expired');
    h.store.items.find((i) => i.id === a.id).updatedAt = now() - 7 * DAY;
    h.store.items.find((i) => i.id === b.id).updatedAt = now() - 7 * DAY - 1;
    await sweep('retention').run({ host: h.host });
    assert.ok(h.store.get(a.id), String(v));
    assert.equal(h.store.get(b.id), null, String(v));
  }
});

test('boot retention run happens once per store instance, on its first tick only', async () => {
  const now = clock(30 * DAY);
  const h = fakeHost({ now });
  const sweeps = makeSweeps();
  const boot = sweep('retention-boot', sweeps);
  assert.equal(boot.everyMs, 30_000);
  const make = () => {
    const i = h.store.create(req('s1'));
    h.store.resolve(i.id, 'expired');
    h.store.items.find((x) => x.id === i.id).updatedAt = 0;
    return i.id;
  };
  const first = make();
  await boot.run({ host: h.host });
  assert.equal(h.store.get(first), null);
  const second = make();
  await boot.run({ host: h.host });
  assert.ok(h.store.get(second));

  // Disable and enable: the wrangler builds a new store, so the run repeats once.
  const h2 = fakeHost({ now });
  const again = h2.store.create(req('s1'));
  h2.store.resolve(again.id, 'expired');
  h2.store.items.find((x) => x.id === again.id).updatedAt = 0;
  await boot.run({ host: h2.host });
  assert.equal(h2.store.get(again.id), null, 'a new store instance gets its own boot run');
  const later = h2.store.create(req('s1'));
  h2.store.resolve(later.id, 'expired');
  h2.store.items.find((x) => x.id === later.id).updatedAt = 0;
  await boot.run({ host: h2.host });
  assert.ok(h2.store.get(later.id), 'and only one');
  assert.ok(h.store.get(second), 'the old instance is not run again');
});

test('a throwing store rejects from run (the host logs it) without corrupting anything', async () => {
  const { host } = fakeHost();
  host.stores = { inbox: { now: () => 1, snapshot() { throw new Error('boom'); }, resolveWhere() { throw new Error('boom'); } } };
  await assert.rejects(sweep('retention').run({ host }), /boom/);
  await assert.rejects(sweep('expiry').run({ host }), /boom/);
});
