# Changelog

## 0.1.0 (unreleased)

The first release, for Agent Wrangler host API `^1.57.0`. It asks for
`sessions:read`, `tasks:read`, `deliver` and `board:rebuild`.

### Added

- **The "Needs you" view:** a triage queue with a rail badge, worked one item
  at a time with **Next** and the keyboard. A new item that stops a session
  (a blocked session or a blocking request) gets a toast, at most three at
  once, withdrawn once it is read or closes. A card pill counts a session's
  items and opens the first.
- **Agent requests:** the `request_human_input`, `withdraw_human_request` and
  `list_my_human_requests` MCP tools, and the `inbox` skill with its wrangler
  nudge. Requests can carry options, a free-text answer, blocking or not,
  urgency, a `dedupe_key` that updates in place, and an expiry. Answers are
  delivered into the session's prompt as `[Needs you] …`. A failed delivery
  stays in the queue with **Retry**.
- **Status items:** one `blocked` item per `needs-you` episode, detected by the
  open board tabs and reconciled server-side, so several tabs give one item.
  Each closes itself when the session moves on. Transient API errors are left
  out unless **Include API errors** is on.
- **Who may ask:** sessions spawned by another session are refused and pointed
  at their spawner. The human can allow or disallow any session from its card
  menu.
- **Lifecycle:** items close when their session is archived, and are forgotten
  when it is purged. Expired requests close every minute. Resolved items are
  removed after **Keep resolved items** days (default 7).
- **Settings:** toasts, API errors, open requests per session, retention, and
  closing a blocking request when the session moves on.
- **Release tooling:** `scripts/validate-manifest.mjs` (the wrangler's real
  loader and MCP server), `scripts/boot-smoke.sh` and `scripts/dev-smoke.mjs`
  (a throwaway wrangler, driven end to end), and CI running both against
  agent-wrangler `main`.

### Known limits

- Status items appear only while a board tab is open
  ([README](README.md#limitation-status-items-need-a-board-tab-open)).
- `needs-you` prompts are answered in the terminal, not from the queue.
- After a server restart, a blocking request is closed as answered elsewhere
  only once its session has been seen idle and then working again
  ([notes](docs/notes/passive-signals.md)).
