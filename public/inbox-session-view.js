// Open a blocked session on its Terminal, not its Chat. The host API has no way
// to ask for a tab (openSession takes an id; mountSession takes only
// `view: 'diff'`), so this writes the board's own per-session choice before
// opening. That key is core's, not a contract: if it changes, the session just
// opens on whatever tab it would have anyway. Remove this once the host API
// takes `view: 'terminal'`.
export const SESSION_VIEW_KEY = 'cm-session-view';

export function preferTerminal(sessionId, storage = globalThis.localStorage) {
  try {
    let parsed = null;
    try { parsed = JSON.parse(storage.getItem(SESSION_VIEW_KEY)); } catch { /* corrupt: core reads {} too */ }
    const all = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    all[sessionId] = 'terminal';
    storage.setItem(SESSION_VIEW_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: open on the remembered tab */ }
}

// Only an open status item is waiting on the terminal.
export function wantsTerminal(item) {
  return item?.source === 'status' && item.state === 'open';
}
