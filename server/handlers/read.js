// The human reading and dismissing items. The graph is the read path, so these
// only mutate and rebuild; a bad payload throws, which the router toasts.
const MAX_IDS = 200;

export const markReadHandler = {
  type: 'inbox-mark-read',
  async handler(msg, host) {
    const { ids } = msg ?? {};
    if (!Array.isArray(ids) || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string')) {
      throw new Error(`inbox-mark-read needs ids: an array of at most ${MAX_IDS} item ids`);
    }
    if (host.stores.inbox.markRead(ids)) await host.rebuild();
  },
};

// A status item's dedupeKey names its needs-you EPISODE, so a dismissed one
// stays closed only until the session next enters needs-you (reconcile.js).
export const dismissHandler = {
  type: 'inbox-dismiss',
  async handler(msg, host) {
    const { id } = msg ?? {};
    if (typeof id !== 'string' || !id) throw new Error('inbox-dismiss needs an item id');
    if (host.stores.inbox.resolve(id, 'dismissed')) await host.rebuild();
  },
};

export const readHandlers = [markReadHandler, dismissHandler];
