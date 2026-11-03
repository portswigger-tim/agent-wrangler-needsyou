# Lifecycle and retention (WS-5)

The non-obvious decisions behind `server/lifecycle.js` and `server/sweeps.js`.

## Hooks

- **`onArchive` closes every item for the session**, an answered one still
  waiting on delivery included, as `session-archived`. An archived card refuses
  delivery, so leaving it open would only produce a failed delivery.
- **`onPurge` forgets the session**: its items and its can-ask override.
- Hooks re-read the store on every call and never throw. The host logs and
  swallows a throw anyway, but a throw must not skip the rebuild.
- There is no restore hook in use. A restored session's items stay closed, and
  a new need raises a new item.

## Sweeps

- `expiry` (every minute) closes open agent requests past `expiresAt` as
  `expired`.
- `retention` (hourly) removes resolved items older than **Keep resolved
  items** days (default 7).
- `retention-boot` runs retention once, 30 s after activation. Sweeps only have
  `everyMs`, so it is a 30 s sweep that does its work on its first tick only.
- Sweeps are quiet: one log line only when a tick changed something, with
  counts only.
- Sweeps are fire-and-forget and not awaited, and start only once the wrangler
  holds its instance lock (see `AGENTS.md`).

## Edge

`request_human_input` doesn't check whether its caller is archived. A real
archived session has no process to call it, so this only shows up in tests
(`scripts/dev-smoke.mjs` relies on it to exercise a refused delivery).
