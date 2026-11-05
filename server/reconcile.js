import { singleLine } from './item.js';

// Turns a snapshot of session statuses into status items (docs/specs/ws3-passive-signals.md).
// Pure apart from the store calls and the small in-process `state` below, and it
// knows nothing about where `observed` came from, so a server-side source can
// call it unchanged. The caller rebuilds the board if anything came back.

const MAX_STATUS_STRING = 500;
const MAX_SESSION_ID = 200;
const TITLE_WAITING_FOR = 80;

// What a restart forgets. Everything durable is in the store; this only closes
// the gap the store can't see (see "dismissed" below).
export function createReconcileState() {
  return {
    openItem: new Map(), // sessionId -> id of the status item this process last saw open for it
    dismissed: new Map(), // sessionId -> true while the dismissed episode is still going
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

// One table for both the title and the cause, so the two can never disagree
// (first match wins). Phrases core itself emits (tmux-scraper.js), not bare words:
// a permission prompt such as "Bash: npm update" or "git log --trust" must not be
// retitled. `t` is the single-lined, lower-cased waitingFor.
const STATUS_RULES = [
  { match: (t, r) => r === 'api-error-blocking', title: () => 'API error — action needed', cause: 'api-error' },
  { match: (t, r) => r === 'api-error', title: () => 'API error — retry', cause: 'api-error' },
  { match: (t) => !t, title: () => 'Session needs you', cause: 'other' },
  { match: (t) => t === 'permission prompt', title: () => 'Permission needed in the session', cause: 'permission' },
  { match: (t) => t === 'input needed', title: () => 'Question waiting in the session', cause: 'question' },
  { match: (t) => t === 'trust dialog' || t.includes('whether to trust this folder'), title: () => 'Confirm folder trust', cause: 'trust' },
  { match: (t) => t.includes('select login method') || t.includes('oauth/authorize'), title: () => 'Sign-in required', cause: 'sign-in' },
  { match: (t) => /\b(update finished|cli update available)\b/.test(t), title: () => 'Agent update needs a restart', cause: 'update' },
  { match: (t) => t.includes('container bring-up failed'), title: () => 'Container failed to start', cause: 'container' },
  // Anything else is a tool call: core shows one only while it waits for approval.
  { match: () => true, title: (text) => `Waiting for you: ${clip(text, TITLE_WAITING_FOR)}`, cause: 'permission' },
];

// Core's bare phrases carry nothing the title and cause don't already say.
const CORE_PHRASES = new Set(['permission prompt', 'input needed', 'trust dialog']);

function ruleFor(waitingFor, waitingReason) {
  const text = typeof waitingFor === 'string' ? singleLine(waitingFor) : '';
  const rule = STATUS_RULES.find((r) => r.match(text.toLowerCase(), waitingReason));
  return { rule, text };
}

export function titleFor(waitingFor, waitingReason) {
  const { rule, text } = ruleFor(waitingFor, waitingReason);
  return rule.title(text);
}

export function causeFor(waitingFor, waitingReason) {
  return ruleFor(waitingFor, waitingReason).rule.cause;
}

// The terminal text, unless it is only one of core's phrases.
export function bodyFor(waitingFor) {
  if (typeof waitingFor !== 'string' || !waitingFor) return '';
  return CORE_PHRASES.has(singleLine(waitingFor).toLowerCase()) ? '' : escapeMarkdown(waitingFor);
}

const statusString = (v) => (typeof v === 'string' && v ? v.slice(0, MAX_STATUS_STRING) : null);
const isNeedsYou = (o) => o.status === 'needs-you';
const asFn = (v) => (typeof v === 'function' ? v : () => v);

// `settings` is either the values (`{ includeTransientApiErrors }`)
// or a host.settings-style `{ get }` view.
const readSetting = (settings, key) => (typeof settings?.get === 'function' ? settings.get(key) : settings?.[key]);

// reconcile(store, observed, { settings, now, taskIdFor, log, state }) -> { opened, updated, resolved }
// `observed` is every non-archived session (ObservedSession[], contracts §5), so one
// that is missing has gone. The returned arrays hold item ids.
export function reconcile(store, observed, { settings = {}, now = Date.now, taskIdFor = () => null, log = () => {}, state = defaultState } = {}) {
  const t = asFn(now)();
  const includeTransient = readSetting(settings, 'includeTransientApiErrors') === true;

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
    const cause = causeFor(waitingFor, waitingReason);
    const body = bodyFor(waitingFor);
    const urgency = waitingReason === 'api-error-blocking' ? 'high' : 'normal';

    const open = openStatus.get(sid);
    if (open) {
      state.openItem.set(sid, open.id);
      // A cause that differs is an item from before 0.1.2 (read back as 'other').
      if (open.status?.waitingFor !== waitingFor || open.status?.waitingReason !== waitingReason || open.status?.cause !== cause) {
        // The same need, restated: in place, so readAt survives and it isn't announced again.
        try {
          store.update(open.id, { title, body, urgency, status: { waitingFor, waitingReason, cause } });
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
        status: { waitingFor, waitingReason, episode, cause },
      });
      opened.push(item.id);
      state.openItem.set(sid, item.id);
    } catch (err) {
      log(`needs-you item for ${sid} not created: ${err.message}`);
    }
  }

  // Agent requests are never closed here. A session going back to work says
  // nothing about whether the human answered (issue #1): the agent withdraws
  // a request once it has its answer in chat.

  return { opened, updated, resolved };
}
