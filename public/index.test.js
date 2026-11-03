import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createClient } from './index.js';
import { canAskItems } from './inbox-can-ask.js';
import { item, statusItem, failedItem, graphOf } from '../test/fixtures/inbox.js';

// The module the wrangler imports from /ext/needsyou/index.js, registered the
// way slots.js does it: a registrar with `register` and `api`, then mount and
// update(el, session, graph) per host.
function loadClient() {
  const window = new Window({ url: 'http://localhost:7777/' });
  const { document } = window;
  const observed = [];
  const navigated = [];
  const sent = [];
  const contributions = {};
  const api = {
    send: (f) => sent.push(f),
    openSession() {},
    settings: () => ({}),
    ui: {
      markdownPreview: (md) => md,
      notify() { throw new Error('no toasts (F14)'); },
      withdraw() { throw new Error('no toasts (F14)'); },
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
  return { window, document, api, observed, navigated, sent, contributions, viewEl, pillEl, observerStarted: () => observerStarted };
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

test('no toasts: new blocked and blocking items never call api.ui.notify', () => {
  const c = loadClient();
  c.contributions.view.update(c.viewEl, null, graphOf([]));
  c.contributions.view.update(c.viewEl, null, graphOf([statusItem(), item({ blocking: true, urgency: 'high' })]));
  c.contributions.view.update(c.viewEl, null, graphOf([]));
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

test('the can-ask action covers all three override states (F3)', () => {
  const sent = [];
  const api = { send: (f) => sent.push(f) };
  const g = graphOf([], {
    sessions: {
      human: { name: 'Mine', spawnedBy: null, canAsk: true, canAskOverride: null },
      w1: { name: 'Worker', spawnedBy: 'o1', canAsk: false, canAskOverride: null },
      w2: { name: 'Worker 2', spawnedBy: 'o1', canAsk: true, canAskOverride: true },
      w3: { name: 'Worker 3', spawnedBy: 'o1', canAsk: false, canAskOverride: false },
      off: { name: 'Muted', spawnedBy: null, canAsk: false, canAskOverride: false },
    },
  });
  assert.deepEqual(canAskItems({ sessionId: 'human' }, g, api), []);
  assert.deepEqual(canAskItems({ sessionId: 'unknown' }, g, api), []);

  // null: the default, one item, no "Use default".
  const nul = canAskItems({ sessionId: 'w1' }, g, api);
  assert.deepEqual(nul.map((i) => [i.label, i.hint]), [['Allow asking the human directly', 'default']]);
  nul[0].run();

  // true: the human allowed it.
  const yes = canAskItems({ sessionId: 'w2' }, g, api);
  assert.deepEqual(yes.map((i) => [i.label, i.hint]), [['Route questions to orchestrator', 'allowed by you'], ['Use default', 'route to orchestrator']]);
  yes[0].run();
  yes[1].run();

  // false: same effective value as the default, but not "default".
  const no = canAskItems({ sessionId: 'w3' }, g, api);
  assert.deepEqual(no.map((i) => [i.label, i.hint]), [['Allow asking the human directly', 'turned off by you'], ['Use default', 'route to orchestrator']]);

  // A top-level session with an override still reaches "Use default".
  const muted = canAskItems({ sessionId: 'off' }, g, api);
  assert.deepEqual(muted.map((i) => [i.label, i.hint]), [['Allow asking the human directly', 'turned off by you'], ['Use default', 'ask directly']]);
  muted[1].run();

  assert.deepEqual(sent, [
    { type: 'inbox-set-can-ask', sessionId: 'w1', allowed: true },
    { type: 'inbox-set-can-ask', sessionId: 'w2', allowed: false },
    { type: 'inbox-set-can-ask', sessionId: 'w2', allowed: null },
    { type: 'inbox-set-can-ask', sessionId: 'off', allowed: null },
  ]);
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
