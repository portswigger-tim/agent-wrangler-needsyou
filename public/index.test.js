import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createClient } from './index.js';
import { item, statusItem, failedItem, graphOf } from '../test/fixtures/inbox.js';

// The module the wrangler imports from /ext/needsyou/index.js, registered the
// way slots.js does it: a registrar with `register` and `api`, then mount and
// update(el, session, graph) per host.
function loadClient(initialSettings = {}) {
  const window = new Window({ url: 'http://localhost:7777/' });
  const { document } = window;
  const observed = [];
  const navigated = [];
  const sent = [];
  const contributions = {};
  const notifications = [];
  const withdrawn = [];
  const settingsListeners = [];
  let settings = initialSettings;
  const api = {
    send: (f) => sent.push(f),
    openSession() {},
    settings: Object.assign(() => settings, { onChange: (fn) => settingsListeners.push(fn) }),
    ui: {
      markdownPreview: (md) => md,
      notify: (opts) => new Promise((resolve, reject) => notifications.push({ ...opts, resolve, reject })),
      withdraw: (id) => withdrawn.push(id),
    },
  };
  let observerStarted = 0;
  const client = createClient({
    navigate: (hash) => navigated.push(hash),
    startObserver: (a) => {
      assert.equal(a, api);
      observerStarted += 1;
      return { update: (g) => observed.push(g), stop() {} };
    },
  });
  client.register({ api, register: (slot, c) => { contributions[slot] = c; } });
  const host = document.createElement('div');
  host.className = 'ext-view';
  document.body.appendChild(host);
  const viewEl = document.createElement('div');
  host.appendChild(viewEl);
  contributions.view.mount(viewEl, api);
  const pillEl = (sessionId) => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    contributions['card.pill'].mount(el, api);
    return { el, session: { sessionId } };
  };
  return {
    window, document, api, observed, navigated, sent, contributions, viewEl, pillEl, notifications, withdrawn,
    observerStarted: () => observerStarted,
    update: (graph) => contributions.view.update(viewEl, null, graph),
    setSettings(values) {
      settings = values;
      for (const fn of settingsListeners) fn(values);
    },
  };
}

test('registers the view, the card pill and the card action', () => {
  const c = loadClient();
  assert.equal(c.observerStarted(), 1);
  assert.equal(c.contributions.view.id, 'inbox');
  assert.equal(c.contributions.view.label, 'Needs you');
  assert.match(c.contributions.view.icon, /^<svg/);
  assert.equal(c.contributions['card.pill'].id, 'inbox');
  assert.equal(c.contributions['card.pill'].label, 'Needs you');
  assert.equal(typeof c.contributions['card.action'].items, 'function');
});

test('the badge is graph.inbox.open', () => {
  const c = loadClient();
  const g = graphOf([statusItem(), item({ readAt: 3 }), failedItem(), item({ state: 'resolved', resolvedReason: 'dismissed' })]);
  assert.equal(g.inbox.open, 3);
  assert.equal(c.contributions.view.badge(g), 3);
  assert.equal(c.contributions.view.badge(graphOf([])), 0);
  assert.equal(c.contributions.view.badge({}), 0);
});

test('toasts require explicit opt-in and ignore the historical setting', () => {
  for (const settings of [{}, { notifyToasts: true }, { toastNotifications: false }, { toastNotifications: 'true' }, { toastNotifications: 1 }]) {
    const c = loadClient(settings);
    c.update(graphOf([]));
    c.update(graphOf([statusItem(), item({ blocking: true, urgency: 'high' })]));
    c.update(graphOf([]));
    assert.deepEqual(c.notifications, []);
    assert.deepEqual(c.withdrawn, []);
  }
});

test('the first valid inbox snapshot is silent, including after a reload', () => {
  const existing = item();
  for (let reload = 0; reload < 2; reload++) {
    const c = loadClient({ toastNotifications: true });
    c.update({ sessions: [] });
    c.update(graphOf([existing]));
    c.update(graphOf([existing]));
    assert.equal(c.notifications.length, 0);
    c.update(graphOf([existing, item()]));
    assert.equal(c.notifications.length, 1);
  }
});

test('new open agent and passive items notify with session context and a View request action', () => {
  const c = loadClient({ toastNotifications: true });
  const agent = item({ title: 'Pick a release', blocking: false });
  const status = statusItem({ title: 'Confirm folder trust' });
  c.update(graphOf([]));
  c.update(graphOf([agent, status, failedItem(), item({ state: 'resolved' }), item({ state: 'answered' })]));
  assert.deepEqual(c.notifications.map(({ title, body, actions }) => ({ title, body, actions })), [
    { title: 'Pick a release', body: 'Worker · Auth', actions: [{ id: 'view', label: 'View request', primary: true }] },
    { title: 'Confirm folder trust', body: 'Worker · Auth', actions: [{ id: 'view', label: 'View request', primary: true }] },
  ]);
  assert.equal(new Set(c.notifications.map((n) => n.id)).size, 2);
});

test('view, card, repeated and reconnect snapshots never repeat a toast or a restatement', () => {
  const c = loadClient({ toastNotifications: true });
  const p = c.pillEl('s1');
  const request = item();
  c.update(graphOf([]));
  const graph = graphOf([request]);
  c.contributions['card.pill'].update(p.el, p.session, graph);
  c.update(graph);
  c.contributions['card.pill'].update(p.el, p.session, structuredClone(graph));
  c.update(graphOf([{ ...request, title: 'Restated', readAt: 3000 }]));
  assert.equal(c.notifications.length, 1);
});

test('enabling toasts never replays items seen while disabled or closed items that reopen', () => {
  const c = loadClient();
  const existing = item();
  const later = item();
  c.update(graphOf([]));
  c.update(graphOf([existing, { ...later, state: 'resolved' }]));
  c.setSettings({ toastNotifications: true });
  c.update(graphOf([existing, later]));
  assert.equal(c.notifications.length, 0);
  c.update(graphOf([existing, later, item()]));
  assert.equal(c.notifications.length, 1);
});

test('closing a toast leaves requests, read state and navigation alone', async () => {
  const c = loadClient({ toastNotifications: true });
  const request = item();
  c.update(graphOf([]));
  c.update(graphOf([request]));
  const sent = [...c.sent];
  c.notifications[0].resolve(null);
  await Promise.resolve();
  assert.deepEqual(c.sent, sent);
  assert.deepEqual(c.navigated, []);
  assert.equal(request.state, 'open');
  assert.equal(request.readAt, null);
  c.update(graphOf([]));
  assert.deepEqual(c.withdrawn, []);
});

test('View request navigates and selects the matching item', async () => {
  const c = loadClient({ toastNotifications: true });
  const first = item();
  const second = item();
  c.update(graphOf([first]));
  c.update(graphOf([first, second]));
  c.notifications[0].resolve('view');
  await Promise.resolve();
  assert.deepEqual(c.navigated, ['#view=ext:needsyou:inbox']);
  assert.equal(c.viewEl.querySelector('.ibx-row.ibx-selected').dataset.id, second.id);
  assert.ok(c.sent.every((f) => f.type === 'inbox-mark-read'));
});

test('View request waits for a view to mount when the toast came from a card', async () => {
  const c = loadClient({ toastNotifications: true });
  c.contributions.view.unmount();
  const p = c.pillEl('s1');
  const request = item();
  c.contributions['card.pill'].update(p.el, p.session, graphOf([]));
  c.contributions['card.pill'].update(p.el, p.session, graphOf([request]));
  c.notifications[0].resolve('view');
  await Promise.resolve();
  assert.deepEqual(c.navigated, ['#view=ext:needsyou:inbox']);
  c.contributions.view.mount(c.viewEl, c.api);
  assert.equal(c.viewEl.querySelector('.ibx-row.ibx-selected').dataset.id, request.id);
});

test('resolved, sending and missing items withdraw outstanding toasts and ignore stale actions', async () => {
  for (const itemsAfter of [[], [{ state: 'resolved' }], [{ state: 'answered', answer: { delivery: 'pending' } }]]) {
    const c = loadClient({ toastNotifications: true });
    const request = item();
    c.update(graphOf([]));
    c.update(graphOf([request]));
    c.update(graphOf(itemsAfter.map((over) => ({ ...request, ...over }))));
    assert.deepEqual(c.withdrawn, [c.notifications[0].id]);
    c.notifications[0].resolve('view');
    await Promise.resolve();
    assert.deepEqual(c.navigated, []);
  }
});

test('disabling withdraws immediately and reenabling does not replay outstanding requests', async () => {
  const c = loadClient({ toastNotifications: true });
  const request = item();
  c.update(graphOf([]));
  c.update(graphOf([request]));
  c.setSettings({ toastNotifications: false });
  assert.deepEqual(c.withdrawn, [c.notifications[0].id]);
  c.notifications[0].resolve('view');
  await Promise.resolve();
  assert.deepEqual(c.navigated, []);
  const whileOff = item();
  c.update(graphOf([request, whileOff]));
  c.setSettings({ toastNotifications: true });
  c.update(graphOf([request, whileOff]));
  assert.equal(c.notifications.length, 1);
  c.update(graphOf([request, whileOff, item()]));
  assert.equal(c.notifications.length, 2);
});

test('a failed notification is contained and never retried on the next graph', async () => {
  const c = loadClient({ toastNotifications: true });
  const request = item();
  c.update(graphOf([]));
  c.update(graphOf([request]));
  c.notifications[0].reject(new Error('notification unavailable'));
  await Promise.resolve();
  await Promise.resolve();
  c.update(graphOf([request]));
  c.update(graphOf([]));
  assert.equal(c.notifications.length, 1);
  assert.deepEqual(c.navigated, []);
  assert.deepEqual(c.withdrawn, []);
});

test('each graph reaches the observer once, however many hosts update with it', () => {
  const c = loadClient();
  const g1 = graphOf([]);
  const p1 = c.pillEl('s1');
  const p2 = c.pillEl('s2');
  c.contributions.view.update(c.viewEl, null, g1);
  c.contributions['card.pill'].update(p1.el, p1.session, g1);
  c.contributions['card.pill'].update(p2.el, p2.session, g1);
  const g2 = graphOf([]);
  c.contributions['card.pill'].update(p1.el, p1.session, g2);
  c.contributions.view.update(c.viewEl, null, g2);
  assert.deepEqual(c.observed, [g1, g2]);
});

test('the pill shows the session\'s open count and first title, and opens that item', () => {
  const c = loadClient();
  const first = statusItem({ title: 'Blocked first', createdAt: 5 });
  const second = item({ title: 'Then decide', createdAt: 1 });
  const elsewhere = item({ sessionId: 's2' });
  const g = graphOf([second, first, elsewhere]);
  c.contributions.view.update(c.viewEl, null, g);
  const p = c.pillEl('s1');
  c.contributions['card.pill'].update(p.el, p.session, g);
  const btn = p.el.querySelector('.ibx-pill');
  assert.equal(btn.hidden, false);
  assert.equal(btn.textContent, '2');
  assert.ok(btn.classList.contains('card-tag'), 'the pill is a core card chip');
  const svg = btn.querySelector('svg');
  assert.ok(svg, 'the pill draws the silhouette icon');
  assert.equal(svg.getAttribute('stroke'), 'currentColor');
  assert.equal(svg.querySelector('circle').getAttribute('r'), '4');
  assert.equal(btn.title, 'Blocked first');
  btn.click();
  assert.deepEqual(c.navigated, ['#view=ext:needsyou:inbox']);
  assert.equal(c.viewEl.querySelector('.ibx-row.ibx-selected').dataset.id, first.id);

  const none = c.pillEl('s3');
  c.contributions['card.pill'].update(none.el, none.session, g);
  assert.equal(none.el.querySelector('.ibx-pill').hidden, true);
});

test('the pill takes the warning colour while its session has an urgent request', () => {
  const c = loadClient();
  const p = c.pillEl('s1');
  const plain = item();
  c.contributions['card.pill'].update(p.el, p.session, graphOf([plain]));
  const btn = p.el.querySelector('.ibx-pill');
  assert.ok(!btn.classList.contains('ibx-pill-urgent'));
  c.contributions['card.pill'].update(p.el, p.session, graphOf([plain, item({ urgency: 'high' })]));
  assert.ok(btn.classList.contains('ibx-pill-urgent'));
  assert.ok(btn.classList.contains('card-tag'));
  assert.match(btn.getAttribute('aria-label'), /urgent/);
});

test('the pill title is text', () => {
  const c = loadClient();
  const g = graphOf([item({ title: '<img src=x onerror=alert(1)>' })]);
  const p = c.pillEl('s1');
  c.contributions['card.pill'].update(p.el, p.session, g);
  assert.equal(p.el.querySelectorAll('img').length, 0);
});

test('no emoji anywhere in public/ (F16)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const emoji = /\p{Extended_Pictographic}/u;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(js|css|html)$/.test(f)) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), emoji, f);
  }
});
