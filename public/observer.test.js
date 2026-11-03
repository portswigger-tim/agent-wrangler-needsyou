import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startObserver, observedSessions } from './observer.js';

// A hand-cranked clock and timer, so throttling is deterministic.
function rig() {
  let t = 10_000;
  const timers = [];
  const sent = [];
  const connectFns = [];
  let unsubscribed = 0;
  const api = {
    send: (frame) => sent.push(frame),
    onConnect: (fn) => {
      connectFns.push(fn);
      return () => { unsubscribed++; };
    },
  };
  const opts = {
    now: () => t,
    setTimer: (fn, ms) => { const timer = { fn, at: t + ms, live: true }; timers.push(timer); return timer; },
    clearTimer: (timer) => { timer.live = false; },
  };
  const advance = (ms) => {
    t += ms;
    for (const timer of timers) {
      if (timer.live && timer.at <= t) {
        timer.live = false;
        timer.fn();
      }
    }
  };
  return { api, opts, sent, connectFns, advance, pending: () => timers.filter((x) => x.live).length, unsubscribed: () => unsubscribed };
}

const sess = (sessionId, status = 'idle', extra = {}) => ({ sessionId, status, waitingFor: null, waitingReason: null, updatedAt: 1, ...extra });
const graph = (...sessions) => ({ sessions });

test('does not import or touch the DOM at load', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof window, 'undefined');
});

test('sends the first graph at once, with only the contracted fields', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  o.update(graph(
    { ...sess('b', 'needs-you', { waitingFor: 'trust dialog', waitingReason: null, updatedAt: 77 }), name: 'ignored', cwd: '/x' },
    sess('a', 'working', { waitingFor: 'starting container', updatedAt: 5 }),
  ));
  assert.deepEqual(r.sent, [{
    type: 'inbox-observe',
    complete: true,
    sessions: [
      { sessionId: 'a', status: 'working', waitingFor: null, waitingReason: null, updatedAt: null },
      { sessionId: 'b', status: 'needs-you', waitingFor: 'trust dialog', waitingReason: null, updatedAt: 77 },
    ],
  }]);
});

test('no send on an unchanged graph, whatever order the cards come in', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  o.update(graph(sess('a'), sess('b', 'needs-you', { updatedAt: 9 })));
  r.advance(60_000);
  o.update(graph(sess('a'), sess('b', 'needs-you', { updatedAt: 9 })));
  o.update(graph(sess('b', 'needs-you', { updatedAt: 9 }), sess('a')));
  r.advance(60_000);
  assert.equal(r.sent.length, 1);
  assert.equal(r.pending(), 0);
});

test('sends on a real change', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  o.update(graph(sess('a', 'working')));
  r.advance(2000);
  o.update(graph(sess('a', 'needs-you', { waitingFor: 'trust dialog', updatedAt: 5 })));
  assert.equal(r.sent.length, 2);
  r.advance(2000);
  o.update(graph(sess('a', 'needs-you', { waitingFor: 'permission', updatedAt: 5 })));
  assert.equal(r.sent.length, 3);
  r.advance(2000);
  o.update(graph(sess('a', 'needs-you', { waitingFor: 'permission', updatedAt: 6 })));
  assert.equal(r.sent.length, 4, 'a new needs-you episode (updatedAt) is a change');
  r.advance(2000);
  o.update(graph(sess('a', 'needs-you', { waitingFor: 'permission', updatedAt: 6 }), sess('b')));
  assert.equal(r.sent.length, 5, 'a new session is a change');
  r.advance(2000);
  o.update(graph(sess('a', 'needs-you', { waitingFor: 'permission', updatedAt: 6 })));
  assert.equal(r.sent.length, 6, 'a removed session is a change (the server resolves by absence)');
});

test('updatedAt and waitingFor churn on a session that is not needs-you is ignored', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  o.update(graph(sess('a', 'working', { updatedAt: 1 }), sess('b', 'idle', { updatedAt: 1 })));
  for (let i = 2; i < 20; i++) {
    r.advance(5000);
    o.update(graph(sess('a', 'working', { updatedAt: i, waitingFor: `tick ${i}` }), sess('b', 'idle', { updatedAt: i })));
  }
  assert.equal(r.sent.length, 1);
});

test('throttles to one send per 2 s, with a trailing send of the newest graph', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  o.update(graph(sess('a', 'idle')));
  assert.equal(r.sent.length, 1);
  r.advance(500);
  o.update(graph(sess('a', 'working')));
  r.advance(500);
  o.update(graph(sess('a', 'needs-you', { updatedAt: 3 })));
  assert.equal(r.sent.length, 1, 'held back inside the interval');
  assert.equal(r.pending(), 1, 'one trailing timer, not one per update');
  r.advance(999);
  assert.equal(r.sent.length, 1);
  r.advance(1);
  assert.equal(r.sent.length, 2);
  assert.equal(r.sent[1].sessions[0].status, 'needs-you', 'the trailing send carries the newest graph');
  assert.equal(r.pending(), 0);
  r.advance(10_000);
  assert.equal(r.sent.length, 2);
});

test('a change that reverts before the trailing send sends nothing', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  o.update(graph(sess('a', 'idle')));
  r.advance(500);
  o.update(graph(sess('a', 'working')));
  o.update(graph(sess('a', 'idle')));
  r.advance(5000);
  assert.equal(r.sent.length, 1);
});

test('re-sends the current graph on every connect, even if unchanged', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  assert.equal(r.connectFns.length, 1);
  o.update(graph(sess('a', 'needs-you', { updatedAt: 4 })));
  assert.equal(r.sent.length, 1);
  r.advance(5000);
  r.connectFns[0]();
  assert.equal(r.sent.length, 2);
  assert.deepEqual(r.sent[1], r.sent[0]);
  r.connectFns[0]();
  assert.equal(r.sent.length, 2, 'throttled');
  r.advance(2000);
  assert.equal(r.sent.length, 3);
});

test('a connect before any graph sends nothing, and the first graph then goes out', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  r.connectFns[0]();
  assert.equal(r.sent.length, 0);
  o.update(graph(sess('a')));
  assert.equal(r.sent.length, 1);
});

test('archived and sample sessions are skipped', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  o.update(graph(
    sess('a'),
    sess('arch', 'needs-you', { archived: true }),
    sess('demo', 'needs-you', { sample: true }),
    sess('b', 'idle', { archived: false, sample: false }),
  ));
  assert.deepEqual(r.sent[0].sessions.map((x) => x.sessionId), ['a', 'b']);
  r.advance(2000);
  o.update(graph(sess('a'), sess('b'), sess('arch2', 'needs-you', { archived: true })));
  assert.equal(r.sent.length, 1, 'archiving or adding an archived card is not a change');
});

test('ignores a graph with no session list, which would otherwise resolve everything', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  o.update(undefined);
  o.update({});
  o.update({ sessions: null });
  assert.equal(r.sent.length, 0);
  o.update(graph());
  assert.deepEqual(r.sent[0].sessions, []);
});

test('clips long strings and drops entries without a usable id', () => {
  const list = observedSessions(graph(
    sess('a', 'needs-you', { waitingFor: 'x'.repeat(900), waitingReason: 'r', updatedAt: NaN }),
    { status: 'idle' },
    sess(''),
    sess('z'.repeat(501)),
    null,
  ));
  assert.equal(list.length, 1);
  assert.equal(list[0].waitingFor.length, 500);
  assert.equal(list[0].updatedAt, null);
});

test('past 500 sessions the needs-you ones are kept', () => {
  const sessions = Array.from({ length: 600 }, (_, i) => sess(`s${String(i).padStart(3, '0')}`));
  sessions.push(sess('zzz', 'needs-you', { updatedAt: 1 }));
  const list = observedSessions(graph(...sessions));
  assert.equal(list.length, 500);
  assert.ok(list.some((o) => o.sessionId === 'zzz'));
});

test('stop() unsubscribes, cancels the trailing send and silences update', () => {
  const r = rig();
  const o = startObserver(r.api, r.opts);
  o.update(graph(sess('a')));
  r.advance(100);
  o.update(graph(sess('a', 'working')));
  assert.equal(r.pending(), 1);
  o.stop();
  assert.equal(r.pending(), 0);
  assert.equal(r.unsubscribed(), 1);
  r.advance(10_000);
  o.update(graph(sess('a', 'needs-you')));
  r.connectFns[0]();
  assert.equal(r.sent.length, 1);
});

test('works with an api that has no onConnect', () => {
  const sent = [];
  const o = startObserver({ send: (f) => sent.push(f) });
  o.update(graph(sess('a')));
  o.stop();
  assert.equal(sent.length, 1);
});
