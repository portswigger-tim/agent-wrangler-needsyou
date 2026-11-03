# Changes for 0.1.4

Status: **draft** · Source: the human's last round of ideas (2026-11-03), from a live board
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
  **Open (n)** · **Closed (n)** · **All**. Buttons with `aria-pressed`, in a group with
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

## How it runs

- One UI worker on branch `fixes-0-1-4` in a worktree. It owns `public/**`, their tests,
  `test/fixtures/**` and `e2e/screens.mjs` (extend it for the new states; never weaken an
  expectation). The orchestrator owns docs, specs, CHANGELOG and the version.
- Acceptance for the batch: `npm run verify` passes, `AW_REPO=<agent-wrangler checkout>
  e2e/run.sh` exits 0, and the worker looks at the changed shots in Dark, Light and 375 px. Then it
  mails the orchestrator.
- The orchestrator merges, regenerates the README screenshot (`E2E_README=1`), bumps to 0.1.4,
  updates `docs/notes/ui.md`, the WS-4 spec and the CHANGELOG, and pushes when CI is green.
