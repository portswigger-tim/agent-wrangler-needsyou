# WS-5 — Lifecycle & retention

**Depends on:** WS-1 merged · **Parallel with:** WS-2, WS-3, WS-4 · **Branch:** `ws5-lifecycle`
**Read first:** `01-contracts.md` §1–3, §7; agent-wrangler `docs/extensions.md` (session hooks:
`onArchive`, `onPurge`; sweeps; the rule that hooks are logged-not-thrown), and the `todos` builtin's
sweep and `onTaskDelete` for shape.

## Goal

Inbox items never outlive the thing they are about, and the store stays bounded.

## Owned files

```
server/lifecycle.js  server/lifecycle.test.js   # export const lifecycleHooks = { onArchive, onPurge }
server/sweeps.js     server/sweeps.test.js      # export const inboxSweeps = [retentionSweep, expirySweep]
```

## Requirements

1. **`onArchive({ sessionId, host })`**: resolve every non-resolved item for that session as
   `session-archived`, then rebuild. An `answered` item with `pending` delivery is resolved too: an
   archived card refuses delivery.
2. **`onPurge({ sessionId, host })`**: `store.forgetSession(sessionId)`, which removes every item and the can-ask override for that session (the card is gone
   from `mappings.json`), then rebuild.
3. **Expiry sweep** (every 60 s): resolve open agent items whose `expiresAt <= now` as `expired`.
   Rebuild only if something changed.
4. **Retention sweep** (every hour, and once 30 s after activation): remove resolved items whose
   `updatedAt` is older than `retentionDays` (fallback 7). Never touch an open item.
5. Sweeps must not log per tick. Log once per sweep that removed or resolved something, with counts
   only and no item text.
6. Both hooks re-read the store each call (no caching), and must not throw. Wrap them, log errors via
   `host.log` if present, and swallow.
7. Use the sweep entry shape WS-1 confirmed in `AGENTS.md`. If WS-1 found sweeps take no `host`, stop
   and message the orchestrator.

## Acceptance criteria

- [ ] Tests with the fake host and an injected clock: archive resolves (open, answered-pending),
      leaves other sessions alone; purge removes; expiry; retention boundary (exactly N days kept,
      N days + 1 ms removed); open items are never removed; rebuild only on change; a throwing store is
      swallowed.
- [ ] Manual: archive a card with an open request. The item moves to Done with "Session archived".
