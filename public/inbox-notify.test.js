import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, SUMMARY_ID } from './inbox-notify.js';
import { item, statusItem, graphOf } from './inbox-fixtures.js';

function fakeApi({ settings = {} } = {}) {
  const notified = [];
  const withdrawn = [];
  const opened = [];
  const api = {
    settings: () => ({ ...settings }),
    openSession: (sid) => opened.push(sid),
    ui: {
      notify(card) {
        let answer;
        const p = new Promise((r) => { answer = r; });
        notified.push({ ...card, answer });
        return p;
      },
      withdraw: (id) => withdrawn.push(id),
    },
  };
  return { api, notified, withdrawn, opened, settings };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test('the first graph seeds and announces nothing', () => {
  const f = fakeApi();
  const n = createNotifier(f.api);
  n.update(graphOf([statusItem(), item()]));
  assert.equal(f.notified.length, 0);
});

test('a graph without graph.inbox does not count as the seed', () => {
  const f = fakeApi();
  const n = createNotifier(f.api);
  n.update({ sessions: [] });
  n.update(graphOf([]));
  n.update(graphOf([statusItem()]));
  assert.equal(f.notified.length, 1);
});

test('one toast per new blocked or blocking item, none for non-blocking requests', () => {
  const f = fakeApi();
  const n = createNotifier(f.api);
  n.update(graphOf([]));
  const blocked = statusItem({ title: 'Trust this folder?' });
  const blocking = item({ kind: 'approval', title: 'Deploy?' });
  const fyi = item({ blocking: false, title: 'Later' });
  n.update(graphOf([blocked, blocking, fyi]));
  n.update(graphOf([blocked, blocking, fyi]));
  assert.deepEqual(f.notified.map((c) => [c.id, c.title, c.body]), [
    [blocked.id, 'Needs you: Blocked', 'Trust this folder?'],
    [blocking.id, 'Needs you: Approval', 'Deploy?'],
  ]);
  assert.deepEqual(f.notified[0].actions, [{ id: 'open', label: 'Open', primary: true }, { id: 'session', label: 'Go to session' }]);
});

test('the notifyToasts setting off suppresses toasts', () => {
  const f = fakeApi({ settings: { notifyToasts: false } });
  const n = createNotifier(f.api);
  n.update(graphOf([]));
  n.update(graphOf([statusItem()]));
  assert.equal(f.notified.length, 0);
});

test('a toast is withdrawn when its item is read or leaves open', () => {
  const f = fakeApi();
  const n = createNotifier(f.api);
  n.update(graphOf([]));
  const a = statusItem();
  const b = item();
  n.update(graphOf([a, b]));
  n.update(graphOf([{ ...a, readAt: 5 }, b]));
  assert.deepEqual(f.withdrawn, [a.id]);
  n.update(graphOf([{ ...a, readAt: 5 }, { ...b, state: 'resolved', resolvedReason: 'withdrawn' }]));
  assert.deepEqual(f.withdrawn, [a.id, b.id]);
});

test('toast actions open the item or go to its session', async () => {
  const f = fakeApi();
  const opened = [];
  const n = createNotifier(f.api, { onOpen: (id) => opened.push(id) });
  n.update(graphOf([]));
  const a = statusItem();
  const b = item({ sessionId: 's9' });
  n.update(graphOf([a, b]));
  f.notified[0].answer('open');
  f.notified[1].answer('session');
  await flush();
  assert.deepEqual(opened, [a.id]);
  assert.deepEqual(f.opened, ['s9']);
});

test('above three, one summary toast counts the rest and goes when they do', async () => {
  const f = fakeApi();
  let viewOpened = 0;
  const n = createNotifier(f.api, { onOpenView: () => { viewOpened += 1; } });
  n.update(graphOf([]));
  const five = [1, 2, 3, 4, 5].map((i) => item({ title: `R${i}` }));
  n.update(graphOf(five));
  assert.deepEqual(f.notified.map((c) => c.id), [five[0].id, five[1].id, five[2].id, SUMMARY_ID]);
  assert.equal(f.notified[3].body, '2 more items need you.');
  // One more arrives: the summary updates in place rather than stacking.
  const sixth = item();
  n.update(graphOf([...five, sixth]));
  assert.equal(f.notified.length, 5);
  assert.equal(f.notified[4].id, SUMMARY_ID);
  assert.equal(f.notified[4].body, '3 more items need you.');
  // The overflow is read: the summary goes.
  n.update(graphOf([...five.slice(0, 3), ...[five[3], five[4], sixth].map((i) => ({ ...i, readAt: 9 }))]));
  assert.deepEqual(f.withdrawn, [SUMMARY_ID]);
  // Clicking an earlier summary's Open shows the view.
  n.update(graphOf([...five, sixth, item(), item(), item(), item()]));
  f.notified.at(-1).answer('open');
  await flush();
  assert.equal(viewOpened, 1);
});
