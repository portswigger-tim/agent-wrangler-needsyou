import { singleLine } from './item.js';

// Turns a snapshot of session statuses into status items (docs/specs/ws3-passive-signals.md).
// Pure apart from the store calls and the small in-process `state` below, and it
// knows nothing about where `observed` came from, so a server-side source can
// call it unchanged. The caller rebuilds the board if anything came back.

const GRACE_MS = 15_000;
const MAX_STATUS_STRING = 500;
const MAX_SESSION_ID = 200;
const TITLE_WAITING_FOR = 80;

// What a restart forgets. Everything durable is in the store; this only closes
// the gaps the store can't see (see "dismissed" and "answered elsewhere" below).
export function createReconcileState() {
  return {
    openItem: new Map(), // sessionId -> id of the status item this process last saw open for it
    dismissed: new Map(), // sessionId -> true while the dismissed episode is still going
    idleSeen: new Set(), // ids of agent items whose session was seen idle/needs-you after they appeared
  };
}

const defaultState = createReconcileState();
export const resetReconcileState = () => {
  for (const v of Object.values(defaultState)) v.clear();
};

// Backslash-escapes every ASCII punctuation character markdown gives meaning to.
// waitingFor is text the terminal produced, not markup.
const escapeMarkdown = (s) => s.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, '\\$&');

const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function titleFor(waitingFor, waitingReason) {
  if (waitingReason === 'api-error-blocking') return 'API error — action needed';
  if (waitingReason === 'api-error') return 'API error — retry';
  const text = typeof waitingFor === 'string' ? singleLine(waitingFor) : '';
  if (!text) return 'Session needs you';
  // Phrases core itself emits (tmux-scraper.js), not bare words: a permission
  // prompt such as "Bash: npm update" or "git log --trust" must not be retitled.
  const t = text.toLowerCase();
  if (t === 'permission prompt') return 'Permission needed in the session';
  if (t === 'input needed') return 'Question waiting in the session';
  if (t === 'trust dialog' || t.includes('whether to trust this folder')) return 'Confirm folder trust';
  if (t.includes('select login method') || t.includes('oauth/authorize')) return 'Sign-in required';
  if (/\b(update finished|cli update available)\b/.test(t)) return 'Agent update needs a restart';
  if (t.includes('container bring-up failed')) return 'Container failed to start';
  return `Waiting for you: ${clip(text, TITLE_WAITING_FOR)}`;
}

const statusString = (v) => (typeof v === 'string' && v ? v.slice(0, MAX_STATUS_STRING) : null);
const isNeedsYou = (o) => o.status === 'needs-you';
const asFn = (v) => (typeof v === 'function' ? v : () => v);

// `settings` is either the values (`{ includeTransientApiErrors, autoResolveOnWorking }`)
// or a host.settings-style `{ get }` view.
const readSetting = (settings, key) => (typeof settings?.get === 'function' ? settings.get(key) : settings?.[key]);

// reconcile(store, observed, { settings, now, taskIdFor, log, state }) -> { opened, updated, resolved }
// `observed` is every non-archived session (ObservedSession[], contracts §5), so one
// that is missing has gone. The returned arrays hold item ids.
export function reconcile(store, observed, { settings = {}, now = Date.now, taskIdFor = () => null, log = () => {}, state = defaultState } = {}) {
  const t = asFn(now)();
  const includeTransient = readSetting(settings, 'includeTransientApiErrors') === true;
  const autoResolve = readSetting(settings, 'autoResolveOnWorking') !== false;

  const sessions = new Map();
  for (const o of Array.isArray(observed) ? observed : []) {
    if (o && typeof o.sessionId === 'string' && o.sessionId) sessions.set(o.sessionId, o);
  }

  const items = store.snapshot();
  const openStatus = new Map(); // sessionId -> its open status item
  const dismissedKeys = new Set(); // dedupeKeys of status items the human dismissed
  for (const i of items) {
    if (i.source !== 'status') continue;
    if (i.state === 'open' && !openStatus.has(i.sessionId)) openStatus.set(i.sessionId, i);
    else if (i.state === 'resolved' && i.resolvedReason === 'dismissed') dismissedKeys.add(i.dedupeKey);
  }

  // A session out of needs-you (or gone) ends its episode: forget the dismissal.
  for (const sid of [...state.openItem.keys(), ...state.dismissed.keys()]) {
    if (!sessions.has(sid) || !isNeedsYou(sessions.get(sid))) {
      state.openItem.delete(sid);
      state.dismissed.delete(sid);
    }
  }

  const opened = [];
  const updated = [];
  const resolved = [];

  // Resolve: the status cleared, or the session is no longer listed (a missed archive hook).
  const cleared = store.resolveWhere(
    (i) => i.source === 'status' && i.state === 'open' && !(sessions.has(i.sessionId) && isNeedsYou(sessions.get(i.sessionId))),
    'status-cleared',
  );
  for (const i of cleared) {
    resolved.push(i.id);
    openStatus.delete(i.sessionId);
  }

  for (const o of sessions.values()) {
    if (!isNeedsYou(o) || o.sessionId.length > MAX_SESSION_ID) continue;
    const sid = o.sessionId;
    const waitingFor = statusString(o.waitingFor);
    const waitingReason = statusString(o.waitingReason);
    const title = titleFor(waitingFor, waitingReason);
    const body = waitingFor ? escapeMarkdown(waitingFor) : '';
    const urgency = waitingReason === 'api-error-blocking' ? 'high' : 'normal';

    const open = openStatus.get(sid);
    if (open) {
      state.openItem.set(sid, open.id);
      if (open.status?.waitingFor !== waitingFor || open.status?.waitingReason !== waitingReason) {
        // The same need, restated: in place, so readAt survives and it isn't announced again.
        try {
          store.update(open.id, { title, body, urgency, status: { waitingFor, waitingReason } });
          updated.push(open.id);
        } catch (err) {
          log(`needs-you update failed for ${sid}: ${err.message}`);
        }
      }
      continue;
    }

    if (waitingReason === 'api-error' && !includeTransient) continue;

    // The dismissal itself is the WS-1 handler's, which can't tell this module, so it
    // shows up here as the item this process saw open now being resolved 'dismissed'.
    const last = state.openItem.get(sid);
    if (last && !state.dismissed.has(sid) && store.get(last)?.resolvedReason === 'dismissed') state.dismissed.set(sid, true);
    const firstSeenAt = Number.isFinite(o.updatedAt) ? o.updatedAt : t;
    const episode = `${sid}:${firstSeenAt}`;
    const dedupeKey = `status:${episode}`;
    // Two checks: the store's record survives a restart; the in-process one covers
    // updatedAt drifting inside one episode.
    if (state.dismissed.has(sid) || dismissedKeys.has(dedupeKey)) continue;

    try {
      const item = store.create({
        source: 'status',
        kind: 'blocked',
        sessionId: sid,
        taskId: taskIdFor(sid) ?? null,
        title,
        body,
        blocking: true,
        urgency,
        dedupeKey,
        status: { waitingFor, waitingReason, episode },
      });
      opened.push(item.id);
      state.openItem.set(sid, item.id);
    } catch (err) {
      log(`needs-you item for ${sid} not created: ${err.message}`);
    }
  }

  // Answered elsewhere: a blocking request whose session is working again with no
  // answer from us was settled in the terminal. Only after the session was seen
  // idle (or asking) since the request appeared, so the turn that raised it can't
  // close it, and only past the grace for that turn still finishing.
  const live = new Set();
  for (const i of items) {
    if (i.source !== 'agent' || i.state !== 'open' || !i.blocking) continue;
    live.add(i.id);
    const status = sessions.get(i.sessionId)?.status;
    if (status === 'idle' || status === 'needs-you') state.idleSeen.add(i.id);
    else if (autoResolve && status === 'working' && state.idleSeen.has(i.id) && t - i.createdAt > GRACE_MS) {
      try {
        if (store.resolve(i.id, 'answered-elsewhere')) resolved.push(i.id);
      } catch (err) {
        log(`needs-you could not close ${i.id}: ${err.message}`);
      }
    }
  }
  for (const id of state.idleSeen) if (!live.has(id)) state.idleSeen.delete(id);

  return { opened, updated, resolved };
}
