# Changes for 0.1.4

Status: **done**: merged on 2026-11-03. All of C1–C6 are in. · Source: the human's last round of ideas (2026-11-03), from a live board
screenshot: an empty queue beside a closed item's detail, which could not be put away. UI only: no
contract or server change. Every change goes through the verification gate.

## C1: An X closes the detail

**Problem:** at desktop width the detail pane shows the selected item until something else is
selected. With an empty queue, a closed item stays open on the right with no way to close it.
**Change:**
- Two panes (≥ 900 px): put an icon button (×, `aria-label="Close"`, title "Close (Esc)") in the
  detail's top-right corner. Use the board's icon style (an inline SVG in `public/icons.js`,
  stroke `currentColor`), not a text glyph.
- It and `Escape` (when not typing, no confirm open) clear the selection. The right pane is then
  empty apart from a muted hint: "Select an item, or press n for the top one." (the existing
  placeholder), or nothing when no list is showing items.
- **Auto-select (0.1.2 F5) respects it.** After the human closes the detail, the view does not
  auto-select again on later ticks. It selects again when the human picks a row, presses `n`, or
  a **new** open item arrives (an id not seen before). Reopening the view (unmount and mount)
  starts fresh.
- One pane (< 900 px): no X. **Back** stays, and does what it does now.
- Focus after closing: the row that was selected, if it is still listed. Otherwise the list.
**Acceptance:** view tests for click and `Escape`, no auto-reselect on the next tick, reselect on a
new item, and no X at one pane. e2e: a shot of the closed state.

## C2: Open / Closed / All filters replace "Recently resolved"

**Problem:** the closed items hide in a small collapsible strip under the queue.
**Change:**
- Replace the `<details>` strip with a segmented control in the list header:
  **Open (n)** · **Closed (n)** · **All (n)**. Buttons with `aria-pressed`, in a group with
  `role="group"` and `aria-label="Show"`. It opens on **Open**.
- **Open:** the queue, in `queueOrder` (unchanged), including failed deliveries.
- **Closed:** resolved items, and answers still on their way ("sending"), sorted by **when they
  closed, newest first**. That is `updatedAt`, which the store sets on every close and never
  changes afterwards (`server/store.js`: `update` takes only open items, and `markRead` leaves
  `updatedAt` alone). For a "sending" answer, use `answer.at`. Write the sort as a named model
  function with its own test, so the rule is explicit. Rows open in the existing read-only view.
- **All:** the Open list, then the Closed list, each in its own order.
- Each row in Closed (and the closed part of All) shows "closed 5m ago" (or "sending"), instead
  of a bare age, so the order is obvious.
- Empty states: Open "Nothing needs you right now." Closed "Nothing closed in the last 24 hours."
  All "Nothing in the last 24 hours." (The graph lists closed items for 24 hours only.)
- Remember the chosen filter per browser (`localStorage`, key `needsyou.filter`), inside try/catch;
  default Open if storage fails.
- `j`/`k` and ↑/↓ walk the list that is showing. `n` always means the top **open** item: from
  Closed or All it switches to Open and selects it.
- The rail badge still counts open items only. The card pill is unchanged.
- Remove the strip's code, CSS and tests. Keep the read-only detail view as it is.
**Acceptance:** model tests for the three lists and the closed order. View tests for the filter
buttons, `aria-pressed`, counts, empty states, remembering the choice, and `n` from Closed. e2e
shots of each filter.

## C3: The header says "3 open"

**Change:** the count reads "<n> open" (was "<n> waiting"), matching the **Open** filter. Hide it
when nothing is open. Row ages for open items keep "waiting 5m": that is how long it has waited.
**Acceptance:** a view test.

## C4: The session link shows the card's name

**Problem:** the detail's session link showed `b4c9473a` for a session with no custom name.
`coreSessionName` in `public/inbox-model.js` reads core's `name`, but core's graph session has
`label` (the name the board shows on the card).
**Change:** fall back to the core session's `label` (then `name`, then the short id). Keep
`graph.inbox.sessions[sid].name` first. Clip a long label to 60 characters with "…".
**Acceptance:** a model test with a session that has only `label`.

## C5: The card-menu item is one tick toggle

**Problem:** the can-ask item (0.1.2 F7) changes its label with the state, which takes reading. The
human asked for one fixed label with a tick, like core's **Auto-fix PR checks ✓**.
**Change** (`public/inbox-can-ask.js`):
- One item on every listed card, with a fixed label: **Let it ask you directly**, and the silhouette
  icon as now.
- The hint is `✓` when the session can ask the human (effective `canAsk === true`), and absent
  otherwise. An extension item can only show escaped text there, not core's SVG `CHECK_ICON`, so
  the tick is a text character. The human chose this over an upstream `checked` field.
- The click flips the effective state, with the same four-state logic as 0.1.2:
  - spawned, no override (unticked) → `allowed: true`
  - spawned, allowed (ticked) → `allowed: null`
  - top-level, no override (ticked) → `allowed: false`
  - top-level, refused (unticked) → `allowed: null`
  - Leftover overrides behave as in 0.1.2.
**Acceptance:** `inbox-can-ask` tests for all four states (label, tick or not, value sent). e2e:
step 07 still clicks "Let it ask you directly", and shot 08 shows the ticked state.

## C6: Every request is also said in chat (done on main, e0b826f)

**Problem:** the human chats with agents, and should not have to switch between chat and the queue
to see a question. The skill said "Keep the chat text too" only for end-of-turn decisions. The
nudge, the tool description and the tool's reply did not say it at all.
**Change:** the tool's success reply (read at the moment of asking), its description, the skill (a
new rule, "Always say it in chat too") and the nudge all say the same thing:
- write the question, its options and your recommendation in your reply too
- if the human answers in chat, call `withdraw_human_request`

**Acceptance:** `tools.test.js` checks the reply text for blocking and non-blocking requests.
Re-run the compliance eval (`docs/notes/testing.md`) to see whether agents follow it.

## How it runs

- One UI worker on branch `fixes-0-1-4` in a worktree. It owns `public/**`, their tests,
  `test/fixtures/**` and `e2e/screens.mjs` (extend it for the new states; never weaken an
  expectation). The orchestrator owns docs, specs, CHANGELOG and the version.
- Acceptance for the batch: `npm run verify` passes, `AW_REPO=<agent-wrangler checkout>
  e2e/run.sh` exits 0, and the worker looks at the changed shots in Dark, Light and 375 px. Then it
  mails the orchestrator.
- The orchestrator merges, regenerates the README screenshot (`E2E_README=1`), bumps to 0.1.4,
  updates `docs/notes/ui.md`, the WS-4 spec and the CHANGELOG, and pushes when CI is green.
