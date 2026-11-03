import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAsk, refusalText } from './can-ask.js';
import { makeInboxTools } from './tools/index.js';
import { inboxHandlers } from './handlers/index.js';
import { fakeHost, seq, clock } from './test-helpers.js';

function setup() {
  return fakeHost({
    sessions: [{ sessionId: 'top' }, { sessionId: 'worker', spawnedBy: 'orch' }, { sessionId: 'orch' }],
    now: clock(),
    idGen: seq(),
  });
}

test('the default: a top-level session may ask, a spawned one may not', () => {
  const { host, store } = setup();
  assert.deepEqual(canAsk(host, store, 'top'), { allowed: true, spawnedBy: null });
  assert.deepEqual(canAsk(host, store, 'worker'), { allowed: false, spawnedBy: 'orch' });
});

test('an override wins in both directions, and null restores the default', () => {
  const { host, store } = setup();
  store.setCanAskOverride('worker', true);
  store.setCanAskOverride('top', false);
  assert.deepEqual(canAsk(host, store, 'worker'), { allowed: true, spawnedBy: 'orch' });
  assert.deepEqual(canAsk(host, store, 'top'), { allowed: false, spawnedBy: null });
  store.setCanAskOverride('worker', null);
  store.setCanAskOverride('top', null);
  assert.equal(canAsk(host, store, 'worker').allowed, false);
  assert.equal(canAsk(host, store, 'top').allowed, true);
});

test('the refusal names the spawner; a top-level session turned off gets the other variant', () => {
  assert.equal(
    refusalText({ spawnedBy: 'orch' }),
    'Refused: this session was launched by another session, so it cannot ask the human. '
      + 'Next step: call send_message now (to: "orch") with your question, its options and your recommendation. '
      + 'Do not call request_human_input again. The human will not see a question you write in chat.',
  );
  assert.equal(
    refusalText({ spawnedBy: null }),
    'Refused: the human has turned off direct requests from this session. '
      + 'Next step: decide using your brief and sensible defaults, say in chat which default you chose, and carry on. '
      + 'If you cannot proceed without the human, stop and explain in chat what you need. '
      + 'Do not call request_human_input again.',
  );
});

test('a refused request_human_input creates nothing and tells the caller who to ask', async () => {
  const { host, store, calls } = setup();
  const [request] = makeInboxTools();
  const out = await request.handler({ host, caller: 'worker' }, { kind: 'decision', title: 'Which way?' });
  assert.equal(out.isError, true);
  assert.match(out.content[0].text, /launched by another session/);
  assert.match(out.content[0].text, /to: "orch"/);
  assert.equal(store.snapshot().length, 0);
  assert.equal(calls.rebuild, 0);

  store.setCanAskOverride('top', false);
  const off = await request.handler({ host, caller: 'top' }, { kind: 'decision', title: 'Which way?' });
  assert.equal(off.isError, true);
  assert.match(off.content[0].text, /turned off direct requests/);
  assert.equal(store.snapshot().length, 0);
});

test('a human-allowed spawned session can ask', async () => {
  const { host, store } = setup();
  store.setCanAskOverride('worker', true);
  const [request] = makeInboxTools();
  const out = await request.handler({ host, caller: 'worker' }, { kind: 'decision', title: 'Which way?' });
  assert.equal(out.isError, undefined);
  assert.equal(store.snapshot().length, 1);
});

test('no MCP tool can change an override: no tool takes one, and calling every tool leaves them alone', async () => {
  const { host, store } = setup();
  store.setCanAskOverride('top', false);
  const tools = makeInboxTools();
  for (const tool of tools) {
    const keys = Object.keys(tool.inputSchema);
    for (const k of keys) assert.doesNotMatch(k, /can_?ask|allow(ed)?$|override/i, `${tool.name} must not take ${k}`);
    await tool.handler({ host, caller: 'worker' }, { kind: 'decision', title: 't', id: 'ibx_x', allowed: true, canAsk: true, sessionId: 'worker' });
    await tool.handler({ host, caller: 'top' }, { kind: 'decision', title: 't', id: 'ibx_x', allowed: true, canAsk: true, sessionId: 'top' });
  }
  assert.equal(store.canAskOverride('worker'), null);
  assert.equal(store.canAskOverride('top'), false);
  // The only writer is the human's browser frame.
  assert.ok(inboxHandlers.some((h) => h.type === 'inbox-set-can-ask'));
});
