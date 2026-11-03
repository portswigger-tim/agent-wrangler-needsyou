// Pure helpers over graph.inbox (contracts §2, §4), shared by the view, the
// toasts and the card pill. No DOM here, so every rule is a plain unit test.

export const VIEW_ID = 'inbox';
export const VIEW_HASH = '#view=ext:needsyou:inbox';

const KIND_LABELS = { blocked: 'Blocked', decision: 'Decision', approval: 'Approval', question: 'Question', action: 'Action' };

const RESOLVED_LABELS = {
  delivered: 'answered',
  withdrawn: 'withdrawn by agent',
  'answered-elsewhere': 'answered in the session',
  'status-cleared': 'resolved in the session',
  dismissed: 'dismissed',
  'session-archived': 'session archived',
  expired: 'expired',
};

export function kindLabel(kind) {
  return KIND_LABELS[kind] || 'Request';
}

export function resolvedLabel(item) {
  if (item?.state === 'answered') return 'sending';
  return RESOLVED_LABELS[item?.resolvedReason] || 'resolved';
}

export const isFailed = (item) => item?.state === 'answered' && item.answer?.delivery === 'failed';
export const needsAction = (item) => item?.state === 'open' || isFailed(item);
export const isUnread = (item) => item?.state === 'open' && item.readAt === null;
// Only what stops a session interrupts the human (spec "Interrupt only when work has stopped").
export const stopsWork = (item) => item?.kind === 'blocked' || item?.blocking === true;

export function inboxOf(graph) {
  const inbox = graph?.inbox;
  return inbox && Array.isArray(inbox.items) ? inbox : null;
}

// The cost-of-waiting tier: lower waits less well.
export function queueTier(item) {
  if (isFailed(item)) return 4;
  if (item.kind === 'blocked' || item.source === 'status') return 0;
  if (!item.blocking) return 3;
  return item.urgency === 'high' ? 1 : 2;
}

// The queue: everything that needs action, by tier, oldest first within a
// tier, id as the last tie-break so the order is total and stable.
export function queueOrder(items = []) {
  return items
    .filter(needsAction)
    .map((item) => ({ item, tier: queueTier(item) }))
    .sort((a, b) => a.tier - b.tier
      || (a.item.createdAt ?? 0) - (b.item.createdAt ?? 0)
      || String(a.item.id).localeCompare(String(b.item.id)))
    .map((e) => e.item);
}

// The "Recently resolved" strip: resolved in the last 24 h (the graph already
// windows them) plus answers still on their way, newest first.
export function recentItems(items = []) {
  return items
    .filter((i) => i.state === 'resolved' || (i.state === 'answered' && !isFailed(i)))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function ageLabel(from, now = Date.now()) {
  const mins = Math.floor(Math.max(0, now - (from ?? now)) / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function waitingLabel(item, now = Date.now()) {
  return `waiting ${ageLabel(item.createdAt, now)}`;
}

function coreSessionName(graph, sessionId) {
  const list = graph?.sessions;
  const found = Array.isArray(list) ? list.find((s) => s?.sessionId === sessionId) : list?.[sessionId];
  return typeof found?.name === 'string' ? found.name : '';
}

export function sessionName(graph, sessionId) {
  return inboxOf(graph)?.sessions?.[sessionId]?.name || coreSessionName(graph, sessionId) || shortId(sessionId);
}

export function shortId(id) {
  return typeof id === 'string' ? id.slice(0, 8) : '';
}

// "session name · task name", without a dangling separator.
export function sessionMeta(graph, item) {
  const s = inboxOf(graph)?.sessions?.[item.sessionId];
  return [sessionName(graph, item.sessionId), s?.taskName || ''].filter(Boolean).join(' · ');
}

// "spawned by <spawner>" for a status item whose session another session launched.
export function spawnedByLabel(graph, item) {
  if (item.source !== 'status') return '';
  const spawner = inboxOf(graph)?.sessions?.[item.sessionId]?.spawnedBy;
  return spawner ? `spawned by ${sessionName(graph, spawner)}` : '';
}

// The id to select after the selected one left the queue: the first item that
// followed it before and is still queued, else whatever now sits at its index.
export function nextAfter(prevOrder, removedId, order) {
  if (!order.length) return null;
  const ids = new Set(order.map((i) => i.id));
  const at = prevOrder.indexOf(removedId);
  if (at >= 0) {
    for (const id of prevOrder.slice(at + 1)) if (ids.has(id)) return id;
    return order[Math.min(at, order.length - 1)].id;
  }
  return order[0].id;
}

// What Send would carry, or null when it would be refused (mirrors the
// store's validateAnswer so the button can say so before a round trip).
export function answerPayload(item, { optionId = null, text = '' } = {}) {
  const choice = optionId && item.options?.some((o) => o.id === optionId) ? optionId : null;
  const note = item.allowFreeText ? String(text ?? '').trim() : '';
  if (!choice && !note) return null;
  if (note.length > 4000) return null;
  return { type: 'inbox-answer', id: item.id, ...(choice ? { optionId: choice } : {}), ...(note ? { text: note } : {}) };
}
