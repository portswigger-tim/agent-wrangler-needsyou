// Interrupt only when work has stopped. On each graph, the open-and-unread
// item ids are diffed against the previous graph's; a NEW one that stops a
// session (a blocked status item, or a blocking agent request) raises a card
// in the board's notification stack. Non-blocking requests only join the queue.
//
// Seeding, as in core's notifier.js: the first graph after load announces
// nothing, so a reload, a second tab or a restart never re-announces a need.
// A card is withdrawn as soon as its item is read or leaves `open`.
//
// At most MAX_TOASTS item cards are up at once. Past that, one summary card
// (`id: 'summary'`) counts the overflow and goes when the overflow has.
import { inboxOf, isUnread, kindLabel, stopsWork } from './inbox-model.js';

export const MAX_TOASTS = 3;
export const SUMMARY_ID = 'summary';

export function createNotifier(api, { onOpen = () => {}, onOpenView = () => {} } = {}) {
  let seeded = false;
  let known = new Set();
  const shown = new Set();      // item ids with a card up
  const summarised = new Set(); // item ids counted by the summary card
  let summaryUp = false;
  let summaryGen = 0;

  const enabled = () => {
    try { return api.settings?.()?.notifyToasts !== false; } catch { return true; }
  };

  function withdraw(id) {
    try { api.ui?.withdraw?.(id); } catch { /* reported by the board */ }
  }

  function showItem(item) {
    shown.add(item.id);
    let answer;
    try {
      answer = api.ui?.notify?.({
        id: item.id,
        title: `Needs you: ${kindLabel(item.kind)}`,
        body: item.title,
        actions: [{ id: 'open', label: 'Open', primary: true }, { id: 'session', label: 'Go to session' }],
      });
    } catch { shown.delete(item.id); return; }
    Promise.resolve(answer).then((choice) => {
      shown.delete(item.id);
      if (choice === 'open') onOpen(item.id);
      else if (choice === 'session') api.openSession?.(item.sessionId);
    }, () => shown.delete(item.id));
  }

  function showSummary() {
    const n = summarised.size;
    summaryUp = true;
    let answer;
    try {
      answer = api.ui?.notify?.({
        id: SUMMARY_ID,
        title: 'Needs you',
        body: `${n} more ${n === 1 ? 'item needs' : 'items need'} you.`,
        actions: [{ id: 'open', label: 'Open', primary: true }],
      });
    } catch { summaryUp = false; return; }
    // Re-showing the same id updates the card in place, so only the answer
    // to the newest show means the card has actually gone.
    const gen = ++summaryGen;
    Promise.resolve(answer).then((choice) => {
      if (gen !== summaryGen || !summaryUp) return;
      summaryUp = false;
      summarised.clear();
      if (choice === 'open') onOpenView();
    }, () => { if (gen === summaryGen) summaryUp = false; });
  }

  function update(graph) {
    const inbox = inboxOf(graph);
    if (!inbox) return;
    const current = new Map();
    for (const item of inbox.items) if (isUnread(item)) current.set(item.id, item);

    if (!seeded) {
      seeded = true;
      known = new Set(current.keys());
      return;
    }

    for (const id of [...shown]) {
      if (!current.has(id)) { shown.delete(id); withdraw(id); }
    }
    let summaryChanged = false;
    for (const id of [...summarised]) {
      if (!current.has(id)) { summarised.delete(id); summaryChanged = true; }
    }

    const fresh = [...current.values()].filter((item) => !known.has(item.id) && stopsWork(item));
    known = new Set(current.keys());

    if (enabled()) {
      for (const item of fresh) {
        if (shown.size < MAX_TOASTS) showItem(item);
        else { summarised.add(item.id); summaryChanged = true; }
      }
    }

    if (summarised.size === 0) {
      if (summaryUp) { summaryUp = false; withdraw(SUMMARY_ID); }
    } else if (summaryChanged || !summaryUp) {
      showSummary();
    }
  }

  return { update };
}
