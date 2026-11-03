# WS-3 — Passive signals (needs-you observer & reconcile)

**Depends on:** WS-1 merged · **Parallel with:** WS-2, WS-4, WS-5 · **Branch:** `ws3-passive-signals`
**Read first:** `00-overview.md` §3–4, `01-contracts.md` §2, §5, §7, §10. In agent-wrangler:
`server/state-reader.js` (`apiErrorPromotion`, `apiErrorReason`: `waitingReason` values),
`server/tmux-scraper.js` (the `waitingFor` strings), `server/notifier.js` (`diffNeedsYou`, the
seeding rule), `public/app.js` around `trackJustFinished`/`isAcknowledged`.

## Goal

Turn core's `needs-you` session status into items, and close them when the status clears, so
"Needs you" mirrors reality with no duplicates across tabs or restarts. Also apply the
"answered-elsewhere" rule to blocking agent items.

## Owned files

```
public/observer.js  public/observer.test.js
server/reconcile.js server/reconcile.test.js
server/handlers/observe.js server/handlers/observe.test.js
```

## Client: `startObserver(api)` (contracts §10)

- `update(graph)`: build `ObservedSession[]` from `graph.sessions` (skip `archived` and
  `sample === true`). Keep only `{ sessionId, status, waitingFor, waitingReason, updatedAt }`.
- Compute a stable signature (sorted by id). Send `{ type: 'inbox-observe', sessions, complete: true }`
  only when the signature changes, and also on every `api.onConnect` (re-sync after a server restart).
- **The signature must ignore `updatedAt` for sessions that are not `needs-you`**, or every tick
  would send. Throttle to at most one send per 2 s, with a trailing send.
- `stop()` unsubscribes. The module must be importable under node (no top-level DOM access).
- Several tabs will send the same snapshot. That is expected, and the server is idempotent.

## Server: `reconcile(store, observed, { settings, now })` → `{ opened, updated, resolved }`

Pure apart from store calls. Rules:

1. **Episode identity.** A needs-you episode is keyed by
   `episode = \`${sessionId}:${firstSeenAt}\``, where `firstSeenAt` comes from an existing open status
   item for that session. If there is none, it is `observed.updatedAt ?? now`.
   `dedupeKey = 'status:' + episode`. One session has at most one open status item.
2. **Open.** For each observed session with `status === 'needs-you'` and no open status item: skip
   it if `waitingReason === 'api-error'` and `includeTransientApiErrors` is not `true`. Skip it if
   this episode was dismissed. Two checks, so a restart can't bring a dismissed item back:
   - **persistent:** a resolved `dismissed` item already has this episode's `dedupeKey`
     (`status:<sid>:<observed.updatedAt>`)
   - **in-process:** a `Map<sessionId, true>` set on dismissal and cleared when an observation
     shows the session out of `needs-you`. It covers `updatedAt` drifting within one episode. Otherwise create a status item:
   `kind:'blocked'`, `title` from `titleFor(waitingFor, waitingReason)` (below),
   `body` = `waitingFor` (markdown-escaped), `blocking:true`, `urgency` = `'high'` for
   `api-error-blocking`, else `'normal'`.
3. **Update.** If an open status item exists and `waitingFor` changed, update `status.waitingFor`
   and the title in place with `store.update`. This does **not** reset `readAt`, so it isn't
   announced again.
4. **Resolve.** For every open status item whose session is in the snapshot with a status other
   than `needs-you`, resolve it as `status-cleared`. Because `complete: true`, a session **absent**
   from the snapshot is resolved too, as `status-cleared`. Archive is WS-5's job, but absence covers
   a missed hook.
5. **Answered elsewhere.** If `autoResolveOnWorking !== false`: for each open, blocking
   `source:'agent'` item, when its session is observed `working` and the item was created more than
   15 s ago (grace for the agent still finishing its turn after the tool call), resolve it as
   `answered-elsewhere`. Track that the session was seen non-working after creation, so an item
   created mid-turn isn't killed by that same turn: require the sequence created → observed
   idle/needs-you → observed working.
6. Returns `{ opened, updated, resolved }` (item ids). The handler calls `host.rebuild()` only
   if any of them is non-empty.

`titleFor` mapping (exact strings, case-insensitive substring match on `waitingFor`, first match wins):

| match | title |
| --- | --- |
| `waitingReason === 'api-error-blocking'` | `API error — action needed` |
| `waitingReason === 'api-error'` | `API error — retry` |
| `trust` | `Confirm folder trust` |
| `login` / `oauth` / `select login method` | `Sign-in required` |
| `update` | `Agent update needs a restart` |
| `container bring-up failed` | `Container failed to start` |
| `permission` or anything else non-empty | `Waiting for you: <waitingFor truncated to 80>` |
| empty / null | `Session needs you` |

## Handler: `inbox-observe`

Validate per contracts §5: an array of ≤500 entries, string ids, string fields ≤500,
`complete === true`. Read settings via `host.settings.get(key)`. Call `reconcile`, then rebuild if
anything changed. Export `observeHandlers = [observeHandler]`.

## Keep the input source swappable

Keep `reconcile` independent of where `observed` comes from (no browser assumptions), so a future
server-side source can call the same function.

## Acceptance criteria

- [ ] Reconcile tests: open on needs-you; no duplicate on a repeated snapshot (×3 "tabs"); title/
      waitingFor update without unread reset; dismissed episode stays dismissed across a simulated
      restart (fresh in-memory state, same store); resolve on status change; resolve on absence; transient
      api-error excluded/included per setting; dismissed episode not re-opened until status clears,
      then re-opened on the next episode; answered-elsewhere honours the grace and the
      idle→working sequence; setting off disables it.
- [ ] Observer tests (no DOM): no send on an unchanged graph; send on change; `updatedAt` churn on
      non-needs-you sessions is ignored; throttling; re-send on connect; archived/sample skipped.
- [ ] Manual: in a dev wrangler, trigger a trust dialog or permission prompt. The item appears
      within ~4 s and disappears after you approve in the terminal. Two tabs give one item.
