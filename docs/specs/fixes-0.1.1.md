# Fixes for 0.1.1

Status: **collecting** · Source: live testing on a real board (2026-11-03), and the workers'
completion notes. Every fix goes through the verification gate. Contract changes are marked;
only the orchestrator edits `01-contracts.md`.

Each fix has a priority:
- **P1:** wrong or misleading for the user
- **P2:** a known gap with a workaround
- **P3:** tidy-up

## Live test results so far

| Check | Result |
| --- | --- |
| A session asks the human directly (`request_human_input` → answer → `[Needs you]`) | Pass |
| A worker is refused and routed to its spawner by mail; nothing reaches the queue | Pass |
| A permission prompt becomes one Blocked item in ~4 s and clears on approval | Pass |
| Two board tabs give one item | Pass |
| `AskUserQuestion` surfaces as needs-you (`waitingFor: "input needed"`) | Pass (confirmed) |
| UI: Light, Dark, 375 px, keyboard-only answer | To do |
| Compliance eval (3 Claude + 3 Codex, target ≥ 5/6) | To do |

## Fixes

### F1 (P1): Clearer titles for the two commonest blocked states
**Problem:** live testing shows core's `waitingFor` is often a bare phrase. Titles read "Waiting for
you: permission prompt" and "Waiting for you: input needed", which are vague.
**Change:** in `titleFor` (`server/reconcile.js`), match the exact phrases (case-insensitive,
whole string) before the generic fallback:
- `permission prompt` → **"Permission needed in the session"**
- `input needed` → **"Question waiting in the session"**

Update the WS-3 spec table. **Acceptance:** tests for both phrases, and the
"Bash: npm update" style regression cases still pass.

### F2 (P1): Record that `AskUserQuestion` is covered
**Problem:** the docs still list it as an open question (~65%).
**Change:** `docs/notes/passive-signals.md` and `docs/notes/testing.md` say it is confirmed, with
the observed `waitingFor` ("input needed") and the date. Remove the open-question line from
`00-overview.md` §3. **Acceptance:** no doc calls it open.

### F3 (P2): Card action hint can't tell "default" from an explicit choice [contract §4]
**Problem:** `graph.inbox.sessions[sid]` carries the effective `canAsk`, but not whether the human
set it. The card menu can't show "default" correctly, or offer "Restore default".
**Change:**
- Add `canAskOverride: boolean | null` to each `graph.inbox.sessions` entry (`server/graph.js`).
- The `card.action` hint shows "default" only when the override is `null`.
- Add a **Use default** item that sends `inbox-set-can-ask { allowed: null }` when an override exists.

**Acceptance:** graph and pill tests cover all three override states.

### F4 (P2): The spawner's name is sometimes missing [contract §4]
**Problem:** "spawned by X" falls back to a short id when the spawner has no item and wasn't itself
spawned, because it isn't in `graph.inbox.sessions`.
**Change:** `server/graph.js` also includes each listed session's `spawnedBy` target (name and task
only). **Acceptance:** a graph test shows a top-level spawner with its name.

### F5 (P2): A restart forgets the "answered elsewhere" sequence
**Problem:** after a server restart, a still-open blocking agent request closes only once its
session is seen idle and then working again, because that sequence is kept in memory.
**Change (docs only for 0.1.1):** state this in `docs/notes/passive-signals.md` and in the
README's "When it closes" wording. Persisting it needs a store field; consider it for 0.2.

### F6 (P3): `AGENTS.md` overstates the import rule
**Problem:** it says any `from '../index.js'` is quarantined. Agent Wrangler main matches only two
or more `../` levels (found by WS-6).
**Change:** state the real rule. Keep the advice to import `./manifest.js` in tests.

### F7 (P3): Test fixtures are served to the browser
**Problem:** `public/inbox-fixtures.js` is test-only, but it sits in `public/`, so it is served
under `/ext/needsyou/`.
**Change:** move it to `test/fixtures/inbox.js` and update the imports in `public/*.test.js`.
**Acceptance:** `/ext/needsyou/inbox-fixtures.js` returns 404 in boot-smoke.

### F8 (P3): The startup retention run keeps ticking
**Problem:** the `retention-boot` sweep does its work once, then wakes every 30 s for nothing, and
its run-once flag does not reset when the extension is turned off and on.
**Change:** keep the sweep (sweeps have only `everyMs`), but reset the flag in a `deactivate`
manifest hook, or derive "first run" from activation time. Document the choice in
`docs/notes/lifecycle.md`.

### F9 (P3): Version and changelog
**Change:** bump to 0.1.1 in `package.json`, and add a `CHANGELOG.md` entry listing the fixes.

## From the human's testing

_Add items here as they come up. Same format: problem, change, acceptance._

## Out of scope (not this extension)

- **Spawned sessions default to `auto` permission mode** (Agent Wrangler's `spawn_session`
  default). The extension changes no permission mode. An orchestrator that wants stricter workers
  should pass `permission_mode` on each spawn.
- **A read-only command such as `echo` never prompts**, even in `manual` mode (Claude Code
  behaviour). Use a command that writes when you test the blocked flow.

## How the fixes run

One worker session takes F1–F9 on branch `fixes-0.1.1`, commits through the gate, and mails the
orchestrator. The orchestrator applies the contract §4 changes (F3, F4) first. Items from the
human's testing are added before the worker starts, or batched into a follow-up.
