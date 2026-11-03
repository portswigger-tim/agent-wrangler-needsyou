// Test fixtures for the client suites (not a *.test.js, so the glob doesn't
// run it). Items follow contracts §2; graphs carry just what the client reads.
let n = 0;

export function item(over = {}) {
  n += 1;
  return {
    id: `ibx_${String(n).padStart(12, '0')}`, source: 'agent', kind: 'decision', sessionId: 's1', taskId: null,
    title: 'Pick one', body: '', options: [], allowFreeText: true, blocking: true, urgency: 'normal',
    dedupeKey: `agent:s1:${n}`, state: 'open', resolvedReason: null, createdAt: 1000, updatedAt: 1000, readAt: null,
    expiresAt: null, answer: null, ...over,
  };
}

export const statusItem = (over = {}) => item({
  source: 'status', kind: 'blocked', blocking: true, allowFreeText: true, title: 'Permission prompt',
  status: { waitingFor: 'Approve a Bash command', waitingReason: 'permission', episode: 'e1' }, ...over,
});

export const failedItem = (over = {}) => item({
  state: 'answered', readAt: 1000,
  answer: { optionId: null, text: 'ship it', at: 1000, delivery: 'failed', deliveryError: 'card archived', attempts: 1 }, ...over,
});

export function graphOf(items, { sessions = { s1: { name: 'Worker', taskId: 't1', taskName: 'Auth', spawnedBy: null, canAsk: true } }, core = [] } = {}) {
  const needs = items.filter((i) => i.state === 'open' || (i.state === 'answered' && i.answer?.delivery === 'failed'));
  return {
    sessions: core,
    inbox: {
      rev: 1,
      unread: items.filter((i) => i.state === 'open' && i.readAt === null).length,
      open: needs.length,
      items,
      sessions,
    },
  };
}
