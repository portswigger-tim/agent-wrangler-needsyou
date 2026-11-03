# Changelog

## 0.1.1 (unreleased)

Fixes from the first live tests on a real board (`docs/specs/fixes-0.1.1.md`).
Same host API (`^1.57.0`) and capabilities.

### Changed

- **Routing for spawned sessions (F10, F11, F12).** The refusal a spawned
  session gets is now one explicit next step: call `send_message` to the
  spawner now, don't call `request_human_input` again, and the human won't see
  a question written in chat. The tool description says the same. The skill
  nudge opens with the end-of-turn trigger, and tells spawners that their
  workers' questions come to them by mail and must not be promised to the
  human.
- **No toasts (F14).** The toast notifications and the **Notify when a session
  is stopped** setting are gone; there are four settings. An old value left in
  config.json is ignored.
- **Read-only resolved items (F15).** A row in **Recently resolved** has the
  queue row's layout and opens read-only: body, options with the choice
  marked, the note, the `waitingFor` text, and how and when it closed. `j`/`k`
  move into the strip while it is expanded.
- **Icon and card chip (F16).** A person silhouette replaces the inbox icon.
  The card pill drops its emoji and is a core `card-tag` chip, so it matches
  the other card chips in every theme.
- **Clearer blocked titles (F1).** "permission prompt" and "input needed"
  become "Permission needed in the session" and "Question waiting in the
  session".
- **Card menu (F3).** `graph.inbox.sessions` entries carry `canAskOverride`.
  The menu says "default" only when there is no override, and offers **Use
  default** when there is one.
- **Spawner names (F4).** Each listed session's spawner is in
  `graph.inbox.sessions`, so "spawned by X" shows X's name.

### Fixed

- The startup retention run now runs once per activation (a disable and
  enable runs it again), not once per process (F8).
- The client test fixtures moved from `public/` to `test/fixtures/`, so they
  are no longer served under `/ext/needsyou/` (F7).

### Docs

- `AskUserQuestion` is confirmed to show as `needs-you` (`waitingFor` "input
  needed", 2026-11-03) (F2).
- The restart gap in "answered elsewhere" is stated in the README and the
  notes (F5).
- `AGENTS.md` states the wrangler's real import rule (F6).
- The compliance eval must use board-launched sessions, and a separate
  routing eval checks that workers mail their spawner (F13).

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
