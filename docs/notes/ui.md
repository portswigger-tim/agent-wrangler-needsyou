# The "Needs you" view (WS-4)

The non-obvious decisions behind `public/index.js`, `public/inbox-*.js`,
`public/icons.js` and `public/styles.css`.

## Queue order and states

- Tiers (0.1.2, F4): every status item **and** every high-urgency agent request
  are tier 0, oldest first. So an urgent request raised after older status
  items sorts below them, but above every other request. Then come normal
  blocking requests, then non-blocking ones, then failed deliveries.
- An urgent request shows an **Urgent** tag on its row and in its detail, and
  the card pill takes the warning colour while its session has one open.
- At desktop width (two panes), the view selects the first item when nothing
  is selected (0.1.2, F5). The auto-picked item is not marked read until you
  act on it. At phone width the list shows first.
- There is no **Next** button (0.1.3, at the human's request). With the first
  item auto-selected and answering or dismissing moving on by itself, it added
  nothing on a desktop. The `n` key stays.
- An answer still being delivered leaves the queue and shows as "sending"
  under **Recently resolved**. A failed delivery comes back as the last tier of
  the queue, with **Retry**.
- "Unread" decides only the row dot, never the order or the badge.

## Keyboard and focus

- Number keys pick an option and focus **Send**, so `Enter` sends. `n` jumps to
  the **top** item of the queue, not to the item below the selection. On the
  top item it moves to the second. On an auto-picked first item it opens that
  item first.
- Keys are scoped to the view and stop propagating, so the board's own
  shortcuts don't fire while you work the queue.
- A MutationObserver focuses the view when it's shown. That is also when a
  pending selection (from a card pill) lands, and when items are
  marked read: an item counts as read once it has been on screen.

## Status items (0.1.2)

- The label, icon and colour come from `status.cause`, which reconcile sets
  (F1): Permission, Question, Trust, Sign-in, Restart, Waiting, and **Blocked**
  for a container failure or a blocking API error (a transient one says
  Error). Only those two causes are red. An item without a cause shows as
  Waiting.
- The detail gives one sentence saying what to do, chosen by cause (F2). Under
  it, "From the terminal" shows the terminal text once. Reconcile leaves the
  body empty when the text is only core's phrase (`permission prompt`, `input
  needed`, `trust dialog`), so there is no box then. The body is
  markdown-escaped by reconcile, so it goes through `api.ui.markdownPreview`.
  `white-space: pre-wrap` sits on the paragraph, not the box, or the newline
  after `</p>` shows as a blank line.

## Answering

- The text box is full width with a visible label (F6): "Your answer" for an
  open question, "Add a note (optional)" when there are options. There is a
  12 px gap before the box and before the button row.
- An `action` request with no options has a main **Done** button (F9). It sends
  `done`, or `done` plus the note. **Send** stays as a secondary button.
- A non-blocking request says "The agent is still working." under its header.
- A failed delivery names the session (F3). If the session is archived
  (`graph.history`, a session marked archived, or "archived" in the error), the
  text says to restore it then retry, or dismiss, and **Dismiss** is the main
  button. The row says "answered <age> ago", and the "Not delivered" tag is a
  tinted danger chip (contrast 6.9 Dark, 5.9 Light).

## Dismissing

An agent request asks you to confirm inline, since dismissing means the agent
never gets an answer. A status item dismisses at once: it comes back on the
session's next `needs-you` episode anyway.

## No toasts

0.1.0 raised a toast for each new item that stopped a session. 0.1.1 removed
them at the human's request (fixes F14): the rail badge and the queue are
enough. There is no `api.ui.notify` call and no `notifyToasts` setting. An old
`notifyToasts` value left in config.json is ignored. Error toasts from the
control router (a refused answer, for example) are the board's own and stay.

## Icon and card chip

- The rail button and the card pill use one person-silhouette SVG
  (`ICONS.inbox`), in the board's icon style (24 × 24, stroke `currentColor`).
  There is no emoji anywhere in `public/` (a test checks).
- The pill is `<button class="card-tag ibx-pill">`. `card-tag` is core's chip
  class (`public/cards.js` on agent-wrangler main, checked 2026-11-03), so the
  pill takes the size, padding, colours and the 10 px icon size of the other
  chips in every theme. `ibx-pill` adds only the pointer cursor and the
  slightly stronger fill that core's own button chips (`.subagent-pill`, the
  checklist pill) use, because `--surface-2` barely shows on a dark card.
- The icon is 10 px, not the 12 to 14 px the fixes spec suggested, because core's
  `.card-tag svg` rule sizes every chip icon to 10 px. Matching the other chips
  was the stated aim.

## Layout

- The narrow layout uses a container query on `.ibx-root` (< 900 px), not a
  media query, so it follows the view's width.
- Status items have a **Show terminal here** toggle (`api.mountSession`).
- Colour comes only from the board's CSS variables, so both themes work.

## Recently resolved (read-only view)

- Strip rows use the queue row's layout (kind, title, session, then the reason
  and "Nm ago" where a queue row has its dot, tag and age).
- Selecting one opens it in the detail pane read-only (0.1.1, F15): kind,
  title, session and task, the body (sanitised markdown), the options with the
  chosen one marked, the note, the `waitingFor` text for a status item, and how
  and when it closed (reason label, a `<time>` with the absolute local time,
  and a relative age the tick keeps moving). It has no buttons (0.1.2, F11, at
  the human's request): the header's session link opens the session, and the
  list is beside it. `Enter` focuses that link. `e` and the number keys do
  nothing there.
- "Read-only" is anything resolved, or answered and still sending. A failed
  delivery is back in the queue with **Retry**.
- `j`/`k` walk the queue and then the strip, but only while the strip is
  expanded. A resolved item stays selected across ticks. A queued item that
  leaves the queue still moves the selection on, as before.

## Card menu and spawner names

- A spawner's name comes from `graph.inbox.sessions`, which lists every
  listed session's spawner (0.1.1). It falls back to `graph.sessions`, then
  to a short id.
- The card menu has one "can ask" item on every listed card (0.1.2, F7), with
  the silhouette icon. Core's `.context-menu-item svg` sizes it to 15 px, like
  its own items. The label names the state the click moves to, and the hint
  names the current state (the table is in `docs/specs/ws4-inbox-ui.md`).
  Setting an override always gives the non-default state, so clearing it
  (`allowed: null`) is the way back, and there is no **Use default** item.

## Test fixtures

The client suites' fixtures are in `test/fixtures/inbox.js`, outside
`public/`, because the wrangler serves everything in `public/` under
`/ext/needsyou/`. Moved there in 0.1.1. The boot smoke checks that
`/ext/needsyou/inbox-fixtures.js` returns 404.
