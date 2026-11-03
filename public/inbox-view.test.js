import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createInboxView } from './inbox-view.js';
import { item, statusItem, failedItem, graphOf } from '../test/fixtures/inbox.js';

const MIN = 60_000;
const XSS = '<img src=x onerror="globalThis.pwned=1">';

// Mounted the way slots.js mounts a `view`: an `.ext-view` host the board
// toggles `hidden` on, holding the contribution's own `.ext-slot` element.
function mountView({ api: over = {}, twoPanes } = {}) {
  const window = new Window({ url: 'http://localhost:7777/' });
  const { document } = window;
  const host = document.createElement('div');
  host.className = 'ext-view';
  document.body.appendChild(host);
  const el = document.createElement('div');
  el.className = 'ext-slot';
  host.appendChild(el);
  const sent = [];
  const opened = [];
  const mounts = [];
  const timers = [];
  const api = {
    send: (frame) => sent.push(frame),
    openSession: (sid) => opened.push(sid),
    // Stands in for the board's sanitising renderer, marked so a test can see
    // where rendered markdown landed.
    ui: { markdownPreview: (md) => `<p class="md">${md.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` },
    mountSession: (target, sid) => {
      const m = { target, sid, unmounted: false };
      mounts.push(m);
      return { sessionId: sid, show() { return true; }, unmount() { m.unmounted = true; } };
    },
    ...over,
  };
  let clock = 20 * MIN;
  const view = createInboxView(el, api, {
    now: () => clock, leaveMs: 0,
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    cancel: () => {},
    twoPanes,
  });
  const root = el.querySelector('.ibx-root');
  const press = (key, opts = {}) => {
    const target = document.activeElement && root.contains(document.activeElement) ? document.activeElement : root;
    const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
    target.dispatchEvent(ev);
    return ev;
  };
  return {
    window, document, host, el, root, view, api, sent, opened, mounts, timers, press,
    tick: (ms) => { clock += ms; },
    rows: () => [...el.querySelectorAll('.ibx-queue .ibx-row')],
    q: (sel) => el.querySelector(sel),
  };
}

const ids = (rows) => rows.map((r) => r.dataset.id);
const text = (node) => node?.textContent ?? null;

test('the queue renders in cost-of-waiting order with kind, meta, age, unread dot and failed tag', () => {
  const v = mountView();
  const nb = item({ blocking: false, createdAt: 0, title: 'FYI-ish' });
  const fail = failedItem({ createdAt: 0 });
  const dec = item({ createdAt: 8 * MIN, readAt: 9 * MIN });
  const blocked = statusItem({ createdAt: 10 * MIN });
  v.view.update(graphOf([nb, fail, dec, blocked]));
  const rows = v.rows();
  assert.deepEqual(ids(rows), [blocked.id, dec.id, nb.id, fail.id]);
  assert.equal(text(rows[0].querySelector('.ibx-row-kind-label')), 'Permission');
  assert.equal(text(rows[0].querySelector('.ibx-row-title')), 'Permission prompt');
  assert.equal(text(rows[0].querySelector('.ibx-row-meta')), 'Worker · Auth');
  assert.equal(text(rows[0].querySelector('.ibx-row-age')), 'waiting 10m');
  assert.ok(rows[0].classList.contains('ibx-unread'));
  assert.ok(!rows[1].classList.contains('ibx-unread'), 'a read item has no dot');
  assert.equal(text(rows[3].querySelector('.ibx-tag-failed')), 'Not delivered');
  assert.equal(text(rows[3].querySelector('.ibx-row-age')), 'answered 19m ago', 'a failed answer is no longer waiting');
  assert.ok(rows[3].classList.contains('ibx-failed'));
  assert.equal(text(v.q('.ibx-count')), '4 waiting');
  assert.equal(v.q('.ibx-empty').hidden, true);
});

test('a status item of a spawned session says who spawned it', () => {
  const v = mountView();
  const s = statusItem({ sessionId: 'w1' });
  v.view.update(graphOf([s], {
    sessions: { w1: { name: 'Worker', taskName: '', spawnedBy: 'o1', canAsk: false }, o1: { name: 'Orchestrator', spawnedBy: null } },
  }));
  assert.equal(text(v.rows()[0].querySelector('.ibx-row-meta')), 'Worker · spawned by Orchestrator');
});

test('the empty state shows when nothing needs the human', () => {
  const v = mountView();
  v.view.update(graphOf([]));
  assert.equal(v.q('.ibx-empty').hidden, false);
  assert.equal(text(v.q('.ibx-empty')), 'Nothing needs you right now.');
  assert.equal(v.q('.ibx-next').disabled, true);
  assert.equal(v.q('.ibx-recent').hidden, true, 'no strip without anything resolved');
});

test('the recently resolved strip is collapsed and labels each reason', () => {
  const v = mountView();
  const gone = [
    item({ state: 'resolved', resolvedReason: 'delivered', updatedAt: 19 * MIN, title: 'A' }),
    item({ state: 'resolved', resolvedReason: 'withdrawn', updatedAt: 18 * MIN, title: 'B' }),
    statusItem({ state: 'resolved', resolvedReason: 'status-cleared', updatedAt: 17 * MIN, title: 'C' }),
  ];
  v.view.update(graphOf(gone));
  const strip = v.q('.ibx-recent');
  assert.equal(strip.hidden, false);
  assert.equal(strip.open, false);
  assert.equal(text(v.q('.ibx-recent-summary')), 'Recently resolved (3)');
  const recentRows = [...v.el.querySelectorAll('.ibx-recent-list .ibx-row')];
  assert.deepEqual(recentRows.map((r) => text(r.querySelector('.ibx-recent-reason'))), ['answered', 'withdrawn by agent', 'resolved in the session']);
  assert.deepEqual(recentRows.map((r) => text(r.querySelector('.ibx-row-age'))), ['1m ago', '2m ago', '3m ago']);
  // The same layout as a queue row: kind, title, session.
  assert.equal(text(recentRows[2].querySelector('.ibx-row-kind-label')), 'Permission');
  assert.equal(text(recentRows[0].querySelector('.ibx-row-title')), 'A');
  assert.equal(text(recentRows[2].querySelector('.ibx-row-meta')), 'Worker · Auth');
  assert.equal(v.rows().length, 0);
  assert.equal(v.q('.ibx-empty').hidden, false);
});

test('a status item detail: guidance, the terminal text once, Open session, terminal toggle, Dismiss without confirm', () => {
  const v = mountView();
  const s = statusItem();
  v.view.update(graphOf([s]));
  v.view.select(s.id);
  assert.equal(text(v.q('.ibx-d-guidance')), 'The agent wants to do this and needs your approval. Open the session to allow or deny it.');
  assert.equal(text(v.q('.ibx-from-terminal-head')), 'From the terminal');
  assert.equal(text(v.q('.ibx-terminal-text')), 'Approve a Bash command');
  assert.equal((v.q('.ibx-detail').textContent.match(/Approve a Bash command/g) || []).length, 1, 'the terminal text shows once');
  assert.equal(v.q('.ibx-d-waiting'), null);
  v.q('.ibx-open-session').click();
  assert.deepEqual(v.opened, ['s1']);
  v.q('.ibx-terminal-toggle').click();
  assert.equal(v.mounts.length, 1);
  assert.equal(v.mounts[0].target, v.q('.ibx-terminal'));
  assert.equal(v.q('.ibx-terminal').hidden, false);
  assert.equal(text(v.q('.ibx-terminal-toggle')), 'Hide terminal');
  v.q('.ibx-dismiss').click();
  assert.deepEqual(v.sent.at(-1), { type: 'inbox-dismiss', id: s.id });
});

test('the embedded terminal is unmounted when the selection changes and on unmount', () => {
  const v = mountView();
  const a = statusItem({ createdAt: 1 });
  const b = statusItem({ createdAt: 2, sessionId: 's2' });
  v.view.update(graphOf([a, b]));
  v.view.select(a.id);
  v.q('.ibx-terminal-toggle').click();
  v.view.select(b.id);
  assert.equal(v.mounts[0].unmounted, true);
  assert.equal(v.q('.ibx-terminal').hidden, true);
  v.q('.ibx-terminal-toggle').click();
  v.view.unmount();
  assert.equal(v.mounts[1].unmounted, true);
});

test('an open agent item: options, a note box, Send only once valid, the note rides with the choice', () => {
  const v = mountView();
  const d = item({ options: [{ id: 'a', label: 'Rebase', description: 'Keep history linear' }, { id: 'b', label: 'Merge' }], allowFreeText: true });
  v.view.update(graphOf([d]));
  v.view.select(d.id);
  const opts = [...v.el.querySelectorAll('.ibx-option')];
  assert.equal(opts.length, 2);
  assert.equal(text(opts[0].querySelector('.ibx-option-label')), 'Rebase');
  assert.equal(text(opts[0].querySelector('.ibx-option-desc')), 'Keep history linear');
  assert.equal(v.q('.ibx-send').disabled, true);
  opts[1].click();
  assert.equal(v.q('.ibx-option[data-option-id="b"]').getAttribute('aria-checked'), 'true');
  const ta = v.q('.ibx-text');
  ta.value = 'because';
  ta.dispatchEvent(new v.window.Event('input', { bubbles: true }));
  v.q('.ibx-send').click();
  assert.deepEqual(v.sent.at(-1), { type: 'inbox-answer', id: d.id, optionId: 'b', text: 'because' });
  assert.equal(v.q('.ibx-send').disabled, true, 'disabled while sending');
  assert.ok([...v.el.querySelectorAll('.ibx-option')].every((b) => b.disabled));
});

test('a free-text item sends on Cmd/Ctrl+Enter', () => {
  const v = mountView();
  const qn = item({ kind: 'question', options: [], allowFreeText: true });
  v.view.update(graphOf([qn]));
  v.view.select(qn.id);
  const ta = v.q('.ibx-text');
  assert.equal(v.el.querySelectorAll('.ibx-option').length, 0);
  ta.value = 'Use port 8080';
  ta.dispatchEvent(new v.window.Event('input', { bubbles: true }));
  ta.dispatchEvent(new v.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.deepEqual(v.sent.at(-1), { type: 'inbox-answer', id: qn.id, text: 'Use port 8080' });
});

test('sending re-enables when the item comes back changed (a refused answer)', () => {
  const v = mountView();
  const qn = item({ allowFreeText: true });
  v.view.update(graphOf([qn]));
  v.view.select(qn.id);
  const ta = v.q('.ibx-text');
  ta.value = 'x';
  ta.dispatchEvent(new v.window.Event('input', { bubbles: true }));
  v.q('.ibx-send').click();
  assert.equal(v.q('.ibx-send').disabled, true);
  v.view.update(graphOf([{ ...qn, updatedAt: qn.updatedAt + 1 }]));
  assert.equal(v.q('.ibx-send').disabled, false);
  assert.equal(v.q('.ibx-text').value, 'x', 'the draft survives');
});

test('an answered item that failed to deliver shows the answer, the error and Retry', () => {
  const v = mountView();
  const f = failedItem({ options: [{ id: 'go', label: 'Go' }], answer: { optionId: 'go', text: 'now', at: 1, delivery: 'failed', deliveryError: 'tmux went away', attempts: 1 } });
  v.view.update(graphOf([f]));
  v.view.select(f.id);
  assert.equal(text(v.q('.ibx-answer-choice')), 'You chose: Go');
  assert.equal(text(v.q('.ibx-answer-note')), 'Note: now');
  assert.equal(text(v.q('.ibx-delivery')), 'Not delivered: tmux went away');
  assert.ok(v.q('.ibx-retry').classList.contains('ibx-primary'), 'Retry leads when retrying can work');
  assert.ok(!v.q('.ibx-dismiss').classList.contains('ibx-primary'));
  v.q('.ibx-retry').click();
  assert.deepEqual(v.sent.at(-1), { type: 'inbox-retry', id: f.id });
});

test('a failed delivery to an archived session names it, and Dismiss leads', () => {
  for (const [why, f, core] of [
    ['the error says archived', failedItem({ answer: { optionId: null, text: 'x', at: 1, delivery: 'failed', deliveryError: 'Session s1 is archived; restore it first', attempts: 1 } }), {}],
    ['the board lists it archived', failedItem({ answer: { optionId: null, text: 'x', at: 1, delivery: 'failed', deliveryError: 'refused', attempts: 1 } }), { history: [{ sessionId: 's1' }] }],
  ]) {
    const v = mountView();
    v.view.update({ ...graphOf([f]), ...core });
    v.view.select(f.id);
    assert.equal(text(v.q('.ibx-delivery')), 'Not delivered: Worker is archived. Restore it from the archive, then retry, or dismiss this.', why);
    assert.ok(!v.q('.ibx-delivery').textContent.includes('s1'), `${why}: no raw card id`);
    const buttons = [...v.q('.ibx-d-answered .ibx-actions').querySelectorAll('button')];
    assert.ok(buttons[0].classList.contains('ibx-dismiss') && buttons[0].classList.contains('ibx-primary'), `${why}: Dismiss is first and primary`);
    assert.ok(!v.q('.ibx-retry').classList.contains('ibx-primary'), `${why}: Retry is secondary`);
  }
});

test('dismissing an agent item asks first: the agent will not be told', () => {
  const v = mountView();
  const d = item();
  v.view.update(graphOf([d]));
  v.view.select(d.id);
  v.q('.ibx-dismiss').click();
  assert.equal(v.sent.filter((f) => f.type === 'inbox-dismiss').length, 0);
  assert.equal(text(v.q('.ibx-confirm-text')), 'The agent will not be told.');
  v.q('.ibx-confirm-no').click();
  assert.equal(v.q('.ibx-confirm'), null);
  v.q('.ibx-dismiss').click();
  v.q('.ibx-confirm-yes').click();
  assert.deepEqual(v.sent.at(-1), { type: 'inbox-dismiss', id: d.id });
});

test('markdown lands only in the body container; agent text elsewhere is inert text', () => {
  const v = mountView();
  const d = item({
    title: `Title ${XSS}`, body: `**bold** ${XSS}`,
    options: [{ id: 'a', label: `Opt ${XSS}`, description: XSS }], allowFreeText: true,
  });
  const s = statusItem({ title: XSS, sessionId: 's2', body: XSS, status: { waitingFor: XSS, waitingReason: null, episode: 'e' } });
  const graph = graphOf([d, s], { sessions: { s1: { name: XSS, taskName: XSS }, s2: { name: 'Other' } } });
  v.view.update(graph);
  v.view.select(d.id);
  assert.equal(v.el.querySelectorAll('img').length, 0);
  assert.equal(v.el.querySelectorAll('.md').length, 1);
  assert.ok(v.q('.ibx-body .md'), 'the rendered markdown is inside .ibx-body');
  assert.equal(text(v.q('.ibx-d-title')), `Title ${XSS}`);
  assert.equal(text(v.q('.ibx-option-label')), `Opt ${XSS}`);
  assert.equal(text(v.q('.ibx-d-session')), XSS);
  assert.ok(v.rows().some((r) => text(r.querySelector('.ibx-row-title')) === `Title ${XSS}`));
  v.view.select(s.id);
  assert.equal(text(v.q('.ibx-terminal-text')), XSS, 'terminal text is plain text, not markdown');
  assert.equal(v.el.querySelectorAll('img').length, 0);
  assert.equal(globalThis.pwned, undefined);
});

test('an unchanged tick keeps row nodes, scroll and the half-typed answer', () => {
  const v = mountView();
  const a = item({ createdAt: 1, allowFreeText: true });
  const b = statusItem({ createdAt: 0 });
  v.view.update(graphOf([a, b]));
  v.view.select(a.id);
  const before = v.rows();
  const ta = v.q('.ibx-text');
  ta.value = 'half a tho';
  ta.dispatchEvent(new v.window.Event('input', { bubbles: true }));
  ta.focus();
  const pane = v.q('.ibx-list-pane');
  pane.scrollTop = 40;
  v.tick(MIN);
  // A fresh graph object with equal items, as every rebuild sends; the mark-read
  // landing (readAt set) must not rebuild the detail either.
  v.view.update(graphOf([{ ...a, readAt: 5 }, { ...b }]));
  const after = v.rows();
  assert.equal(after.length, 2);
  assert.ok(after.every((r, i) => r === before[i]), 'same row elements');
  assert.equal(v.q('.ibx-text'), ta, 'same textarea');
  assert.equal(ta.value, 'half a tho');
  assert.equal(v.document.activeElement, ta);
  assert.equal(pane.scrollTop, 40);
  assert.equal(text(after[0].querySelector('.ibx-row-age')), 'waiting 21m', 'the age still moves');
});

test('mark-read is sent once per item, and only while the view is on screen', async () => {
  const v = mountView();
  const a = item();
  const b = item();
  v.host.classList.add('hidden');
  v.view.update(graphOf([a, b]));
  v.view.select(a.id);
  assert.equal(v.sent.filter((f) => f.type === 'inbox-mark-read').length, 0, 'not while hidden');
  v.host.classList.remove('hidden');
  await new Promise((r) => setTimeout(r, 0));
  v.view.update(graphOf([a, b]));
  v.view.update(graphOf([a, b]));
  v.view.select(b.id);
  v.view.select(a.id);
  v.view.update(graphOf([a, b]));
  assert.deepEqual(v.sent.filter((f) => f.type === 'inbox-mark-read'), [
    { type: 'inbox-mark-read', ids: [a.id] },
    { type: 'inbox-mark-read', ids: [b.id] },
  ]);
});

test('Next walks the queue and selection advances in queue order as items resolve', () => {
  const v = mountView();
  const blocked = statusItem({ createdAt: 5 });
  const high = item({ urgency: 'high', createdAt: 7 });
  const normal = item({ createdAt: 1 });
  const all = [normal, high, blocked];
  v.view.update(graphOf(all));
  v.q('.ibx-next').click();
  assert.equal(v.view.selectedId, blocked.id, 'Next selects the top item');
  v.q('.ibx-next').click();
  assert.equal(v.view.selectedId, high.id, 'Next on the top item moves on');
  v.view.select(blocked.id);
  // The blocked session went back to work while the human was looking at it.
  v.view.update(graphOf([normal, high, { ...blocked, state: 'resolved', resolvedReason: 'status-cleared' }]));
  assert.equal(v.view.selectedId, high.id, 'moves to the next item');
  // The human answers it; the answer is in flight.
  v.view.update(graphOf([normal, { ...high, state: 'answered', answer: { delivery: 'pending' } }]));
  assert.equal(v.view.selectedId, normal.id);
  v.view.update(graphOf([{ ...normal, state: 'resolved', resolvedReason: 'withdrawn' }]));
  assert.equal(v.view.selectedId, null);
  assert.equal(v.q('.ibx-empty').hidden, false);
});

test('the keyboard answers a decision with no mouse', () => {
  const v = mountView();
  const other = item({ createdAt: 9 });
  const d = item({ createdAt: 1, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], allowFreeText: false });
  v.view.update(graphOf([other, d]));
  v.root.focus();
  v.press('n');
  assert.equal(v.view.selectedId, d.id);
  assert.equal(v.document.activeElement, v.q('.ibx-option'), 'focus on the primary control');
  v.press('2');
  assert.equal(v.q('.ibx-option[data-option-id="no"]').getAttribute('aria-checked'), 'true');
  assert.equal(v.document.activeElement, v.q('.ibx-send'));
  // Enter on a focused button is the button's own: the browser clicks it.
  const ev = v.press('Enter');
  assert.equal(ev.defaultPrevented, false);
  v.document.activeElement.click();
  assert.deepEqual(v.sent.filter((f) => f.type === 'inbox-answer'), [{ type: 'inbox-answer', id: d.id, optionId: 'no' }]);
  // The answer lands: selection and focus move to the next item.
  v.view.update(graphOf([other, { ...d, state: 'answered', answer: { delivery: 'pending' } }]));
  assert.equal(v.view.selectedId, other.id);
  assert.ok(v.root.contains(v.document.activeElement));
});

test('j/k and arrows move the selection; e dismisses; shortcuts ignore typing', () => {
  const v = mountView();
  const a = statusItem({ createdAt: 1 });
  const b = item({ createdAt: 2, allowFreeText: true });
  v.view.update(graphOf([a, b]));
  v.root.focus();
  v.press('j');
  assert.equal(v.view.selectedId, a.id);
  v.press('ArrowDown');
  assert.equal(v.view.selectedId, b.id);
  v.press('k');
  assert.equal(v.view.selectedId, a.id);
  v.press('e');
  assert.deepEqual(v.sent.at(-1), { type: 'inbox-dismiss', id: a.id }, 'a status item dismisses at once');
  v.view.select(b.id, { focus: true });
  assert.equal(v.document.activeElement, v.q('.ibx-text'));
  v.press('n');
  v.press('e');
  assert.equal(v.view.selectedId, b.id);
  assert.equal(v.q('.ibx-confirm'), null, 'typing "e" in the answer box is just typing');
  v.root.focus();
  v.press('e');
  assert.ok(v.q('.ibx-confirm'));
  assert.equal(v.document.activeElement, v.q('.ibx-confirm-yes'));
  v.press('Escape');
  assert.equal(v.q('.ibx-confirm'), null);
});

test('narrow layouts open the detail on selection and Back returns to the list', () => {
  const v = mountView();
  const a = item();
  v.view.update(graphOf([a]));
  assert.ok(!v.root.classList.contains('ibx-detail-open'));
  v.rows()[0].click();
  assert.ok(v.root.classList.contains('ibx-detail-open'));
  v.q('.ibx-back').click();
  assert.ok(!v.root.classList.contains('ibx-detail-open'));
});

test('selecting an item that has not arrived yet selects it when it does', () => {
  const v = mountView();
  const a = item();
  v.view.update(graphOf([]));
  assert.equal(v.view.select(a.id, { focus: true }), false);
  v.view.update(graphOf([a]));
  assert.equal(v.view.selectedId, a.id);
});

/* ── F15: a resolved item opens read-only ─────────────────────────────────── */

const ANSWER_CONTROLS = '.ibx-option, .ibx-text, .ibx-send, .ibx-dismiss, .ibx-confirm, .ibx-retry, .ibx-terminal-toggle';

test('a resolved agent item opens read-only: options with the choice marked, the note, how and when it closed', () => {
  const v = mountView();
  const live = item({ createdAt: 1 });
  const done = item({
    title: 'Ship it?', body: 'Context **here**', createdAt: 2 * MIN, updatedAt: 15 * MIN,
    state: 'resolved', resolvedReason: 'delivered',
    options: [{ id: 'yes', label: 'Yes', description: 'Ship now' }, { id: 'no', label: 'No' }],
    answer: { optionId: 'yes', text: 'after lunch', at: 14 * MIN, delivery: 'delivered', deliveryError: null, attempts: 1 },
  });
  v.view.update(graphOf([live, done]));
  v.q('.ibx-recent').open = true;
  v.el.querySelector(`.ibx-recent-list .ibx-row[data-id="${done.id}"]`).click();
  assert.equal(v.view.selectedId, done.id);
  assert.ok(v.q(`.ibx-recent-list .ibx-row[data-id="${done.id}"]`).classList.contains('ibx-selected'));
  assert.ok(v.q('.ibx-d-readonly'));
  assert.equal(text(v.q('.ibx-d-title')), 'Ship it?');
  assert.match(text(v.q('.ibx-d-kind')), /Decision/);
  assert.equal(text(v.q('.ibx-d-session')), 'Worker');
  assert.equal(text(v.q('.ibx-d-task')), 'Auth');
  assert.equal(text(v.q('.ibx-d-age')), 'asked 18m ago');
  assert.ok(v.q('.ibx-body .md'), 'the body is sanitised markdown, as for open items');
  const opts = [...v.el.querySelectorAll('.ibx-ro-option')];
  assert.deepEqual(opts.map((o) => text(o.querySelector('.ibx-option-label'))), ['Yes', 'No']);
  assert.ok(opts[0].classList.contains('ibx-chosen'));
  assert.equal(text(opts[0].querySelector('.ibx-ro-chosen')), 'Your choice');
  assert.ok(!opts[1].classList.contains('ibx-chosen'));
  assert.equal(text(v.q('.ibx-answer-note')), 'Your note: after lunch');
  assert.equal(text(v.q('.ibx-d-closed-reason')), 'Closed: answered');
  assert.equal(v.q('.ibx-d-closed-at').getAttribute('datetime'), new Date(15 * MIN).toISOString());
  assert.equal(text(v.q('.ibx-d-closed-age')), '5m ago');
  assert.equal(v.el.querySelectorAll(ANSWER_CONTROLS).length, 0, 'no answer, dismiss or retry controls');
  assert.equal(v.q('.ibx-d-readonly .ibx-actions'), null, 'no button row');
  assert.deepEqual([...v.q('.ibx-detail').querySelectorAll('button')].map((b) => b.className), ['ibx-btn ibx-link ibx-d-session'],
    'no buttons apart from the header session link');

  v.press('e');
  v.press('1');
  assert.equal(v.sent.filter((f) => f.type !== 'inbox-mark-read').length, 0, 'e and 1-6 do nothing on a read-only item');

  // The tick moves the relative time, and the selection stays put.
  v.tick(MIN);
  v.view.update(graphOf([live, done]));
  assert.equal(v.view.selectedId, done.id);
  assert.equal(text(v.q('.ibx-d-closed-age')), '6m ago');

  v.q('.ibx-d-session').click();
  assert.deepEqual(v.opened, ['s1'], 'the header link still opens the session');
});

test('a dismissed agent item shows how it closed and no answer', () => {
  const v = mountView();
  const d = item({ title: 'Never mind', state: 'resolved', resolvedReason: 'dismissed', updatedAt: 19 * MIN });
  v.view.update(graphOf([d]));
  assert.equal(v.view.select(d.id), true);
  assert.equal(text(v.q('.ibx-d-closed-reason')), 'Closed: dismissed');
  assert.equal(v.q('.ibx-ro-options'), null);
  assert.equal(v.q('.ibx-answer-note'), null);
  assert.equal(v.el.querySelectorAll(ANSWER_CONTROLS).length, 0);
  assert.equal(v.q('.ibx-d-readonly button'), null);
});

test('a cleared status item shows its terminal text, read-only, with no terminal toggle', () => {
  const v = mountView();
  const s = statusItem({ state: 'resolved', resolvedReason: 'status-cleared', updatedAt: 18 * MIN });
  v.view.update(graphOf([s]));
  v.view.select(s.id);
  assert.equal(text(v.q('.ibx-terminal-text')), 'Approve a Bash command');
  assert.equal(v.q('.ibx-d-guidance'), null, 'nothing left to do, so no guidance');
  assert.equal(text(v.q('.ibx-d-closed-reason')), 'Closed: resolved in the session');
  assert.equal(v.el.querySelectorAll(ANSWER_CONTROLS).length, 0);
  assert.equal(v.mounts.length, 0);
});

test('j/k continue from the queue into the strip only when it is expanded', () => {
  const v = mountView();
  const a = item({ createdAt: 1 });
  const r1 = item({ state: 'resolved', resolvedReason: 'withdrawn', updatedAt: 19 * MIN });
  const r2 = item({ state: 'resolved', resolvedReason: 'expired', updatedAt: 18 * MIN });
  v.view.update(graphOf([a, r1, r2]));
  v.root.focus();
  v.press('j');
  v.press('j');
  assert.equal(v.view.selectedId, a.id, 'collapsed: the strip is out of reach');
  v.q('.ibx-recent').open = true;
  v.press('j');
  assert.equal(v.view.selectedId, r1.id);
  assert.equal(v.document.activeElement, v.q(`.ibx-recent-list .ibx-row[data-id="${r1.id}"]`));
  v.press('j');
  assert.equal(v.view.selectedId, r2.id);
  v.press('j');
  assert.equal(v.view.selectedId, r2.id, 'stops at the end');
  v.press('k');
  v.press('k');
  assert.equal(v.view.selectedId, a.id);
  // Enter on a read-only item focuses its header's session link.
  v.press('j');
  v.root.focus();
  v.press('Enter');
  assert.equal(v.document.activeElement, v.q('.ibx-d-session'));
});

test('agent text in a read-only item stays inert', () => {
  const v = mountView();
  const d = item({
    title: XSS, body: XSS, state: 'resolved', resolvedReason: 'delivered',
    options: [{ id: 'a', label: XSS, description: XSS }],
    answer: { optionId: 'a', text: XSS, at: 1, delivery: 'delivered', deliveryError: null, attempts: 1 },
  });
  const s = statusItem({ title: XSS, body: XSS, state: 'resolved', resolvedReason: 'status-cleared', status: { waitingFor: XSS, waitingReason: null, episode: 'e' } });
  v.view.update(graphOf([d, s], { sessions: { s1: { name: XSS, taskName: XSS } } }));
  v.q('.ibx-recent').open = true;
  v.view.select(d.id);
  assert.equal(v.el.querySelectorAll('img').length, 0);
  assert.equal(text(v.q('.ibx-ro-option .ibx-option-label')), XSS);
  assert.equal(text(v.q('.ibx-answer-note')), `Your note: ${XSS}`);
  v.view.select(s.id);
  assert.equal(v.el.querySelectorAll('img').length, 0);
  assert.equal(text(v.q('.ibx-terminal-text')), XSS);
  assert.equal(globalThis.pwned, undefined);
});

test('rows and the detail show the cause label, and only failures are red', () => {
  const v = mountView();
  const perm = statusItem({ createdAt: 1 });
  const box = statusItem({ createdAt: 2, sessionId: 's2', status: { waitingFor: 'container bring-up failed', waitingReason: null, episode: 'e', cause: 'container' } });
  const old = statusItem({ createdAt: 3, sessionId: 's3', status: { waitingFor: 'x', waitingReason: null, episode: 'e' } });
  v.view.update(graphOf([perm, box, old]));
  const rows = v.rows();
  assert.deepEqual(rows.map((r) => text(r.querySelector('.ibx-row-kind-label'))), ['Permission', 'Blocked', 'Waiting']);
  assert.deepEqual(rows.map((r) => r.classList.contains('ibx-alarm')), [false, true, false]);
  assert.equal(rows[0].querySelector('.ibx-row-icon').dataset.kind, 'cause-permission');
  v.view.select(box.id);
  assert.equal(text(v.q('.ibx-d-kind')), 'Blocked');
  assert.ok(v.q('.ibx-d-kind').classList.contains('ibx-alarm'));
  assert.equal(text(v.q('.ibx-d-guidance')), "The session's container did not start. Open the session to see the error.");
});

test("a status item whose body is only core's phrase shows guidance and no terminal box", () => {
  const v = mountView();
  const s = statusItem({ body: '', status: { waitingFor: 'input needed', waitingReason: null, episode: 'e', cause: 'question' } });
  const legacy = statusItem({ sessionId: 's2', body: 'trust dialog', status: { waitingFor: 'trust dialog', waitingReason: null, episode: 'e', cause: 'trust' } });
  v.view.update(graphOf([s, legacy]));
  for (const it of [s, legacy]) {
    v.view.select(it.id);
    assert.ok(v.q('.ibx-d-guidance'));
    assert.equal(v.q('.ibx-from-terminal'), null);
    assert.equal(v.q('.ibx-body'), null);
  }
});

test('an urgent request carries an Urgent tag on its row and in its detail', () => {
  const v = mountView();
  const u = item({ urgency: 'high', title: 'Force-push?' });
  const n = item({ title: 'Normal' });
  v.view.update(graphOf([n, u]));
  const [first, second] = v.rows();
  assert.equal(first.dataset.id, u.id, 'urgent sorts first');
  assert.equal(text(first.querySelector('.ibx-tag-urgent')), 'Urgent');
  assert.equal(text(second.querySelector('.ibx-tag-urgent')), '');
  v.view.select(u.id);
  assert.equal(text(v.q('.ibx-d-head .ibx-tag-urgent')), 'Urgent');
});

test('two panes: the queue opens on its first item, without focus or marking it read', () => {
  const v = mountView({ twoPanes: () => true });
  v.view.update(graphOf([]));
  assert.equal(v.view.selectedId, null, 'an empty queue selects nothing');
  const a = statusItem({ createdAt: 1 });
  const b = item({ createdAt: 2 });
  v.view.update(graphOf([a, b]));
  assert.equal(v.view.selectedId, a.id);
  assert.equal(text(v.q('.ibx-d-title')), a.title);
  assert.ok(!v.root.contains(v.document.activeElement) || v.document.activeElement === v.root || v.document.activeElement === v.document.body);
  assert.equal(v.sent.filter((f) => f.type === 'inbox-mark-read').length, 0, 'not marked read');
  // Next starts on the item shown, then moves on.
  v.q('.ibx-next').click();
  assert.equal(v.view.selectedId, a.id);
  assert.deepEqual(v.sent.filter((f) => f.type === 'inbox-mark-read'), [{ type: 'inbox-mark-read', ids: [a.id] }]);
  v.q('.ibx-next').click();
  assert.equal(v.view.selectedId, b.id);
});

test('one pane: nothing is selected until the human picks', () => {
  const v = mountView({ twoPanes: () => false });
  v.view.update(graphOf([item()]));
  assert.equal(v.view.selectedId, null);
});

test('Next is disabled on an empty queue and when only the selected item remains', () => {
  const v = mountView();
  v.view.update(graphOf([]));
  assert.equal(v.q('.ibx-next').disabled, true);
  assert.equal(v.q('.ibx-next').getAttribute('aria-disabled'), 'true');
  const a = item();
  v.view.update(graphOf([a]));
  assert.equal(v.q('.ibx-next').disabled, false);
  assert.equal(v.q('.ibx-next').getAttribute('aria-disabled'), null);
  v.view.select(a.id);
  assert.equal(v.q('.ibx-next').disabled, true);
  assert.equal(v.q('.ibx-next').getAttribute('aria-disabled'), 'true');
  v.view.update(graphOf([a, item()]));
  assert.equal(v.q('.ibx-next').disabled, false);
});

test('the answer box has a visible label', () => {
  const v = mountView();
  const open = item({ kind: 'question' });
  const withOpts = item({ options: [{ id: 'a', label: 'A' }], allowFreeText: true });
  v.view.update(graphOf([open, withOpts]));
  v.view.select(open.id);
  const label = v.q('.ibx-text-label');
  assert.equal(text(label), 'Your answer');
  assert.equal(label.htmlFor, v.q('.ibx-text').id);
  v.view.select(withOpts.id);
  assert.equal(text(v.q('.ibx-text-label')), 'Add a note (optional)');
});

test('an action has a main Done button that answers "done", with the note', () => {
  const v = mountView();
  const a = item({ kind: 'action', blocking: false, title: 'Install the app' });
  v.view.update(graphOf([a]));
  v.view.select(a.id, { focus: true });
  const done = v.q('.ibx-done');
  assert.ok(done.classList.contains('ibx-primary'));
  assert.ok(!v.q('.ibx-send').classList.contains('ibx-primary'), 'Send is secondary');
  assert.equal(text(v.q('.ibx-text-label')), 'Add a note (optional)');
  assert.equal(v.document.activeElement, done, 'Done is the primary control');
  const ta = v.q('.ibx-text');
  ta.value = 'also on staging';
  ta.dispatchEvent(new v.window.Event('input'));
  v.q('.ibx-done').click();
  assert.deepEqual(v.sent.at(-1), { type: 'inbox-answer', id: a.id, text: 'done\n\nalso on staging' });
});

test('a non-blocking request says the agent is still working', () => {
  const v = mountView();
  const nb = item({ blocking: false });
  const b = item();
  v.view.update(graphOf([nb, b]));
  v.view.select(nb.id);
  assert.equal(text(v.q('.ibx-d-working')), 'The agent is still working.');
  v.view.select(b.id);
  assert.equal(v.q('.ibx-d-working'), null);
});
