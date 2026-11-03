# The "Needs you" view (WS-4)

The non-obvious decisions behind `public/index.js`, `public/inbox-*.js`,
`public/icons.js` and `public/styles.css`.

## Queue order and states

- An answer still being delivered leaves the queue and shows as "sending"
  under **Recently resolved**. A failed delivery comes back as the last tier of
  the queue, with **Retry**.
- "Unread" decides only the row dot, never the order or the badge.

## Keyboard and focus

- Number keys pick an option and focus **Send**, so `Enter` sends. `n` moves on
  from the current item, not from the top.
- Keys are scoped to the view and stop propagating, so the board's own
  shortcuts don't fire while you work the queue.
- A MutationObserver focuses the view when it's shown. That is also when a
  pending selection (from a card pill) lands, and when items are
  marked read: an item counts as read once it has been on screen.

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
  and a relative age the tick keeps moving). The only buttons are **Open
  session** and **Back to queue**. `e` and the number keys do nothing there.
- "Read-only" is anything resolved, or answered and still sending. A failed
  delivery is back in the queue with **Retry**.
- `j`/`k` walk the queue and then the strip, but only while the strip is
  expanded. A resolved item stays selected across ticks. A queued item that
  leaves the queue still moves the selection on, as before.
- **Back to queue** selects the top of the queue (or nothing, if it is empty)
  and focuses its row.

## Card menu and spawner names

- A spawner's name comes from `graph.inbox.sessions`, which lists every
  listed session's spawner (0.1.1). It falls back to `graph.sessions`, then
  to a short id.
- The card menu's "can ask" item reads `canAskOverride`: the hint is "default"
  only when it is `null`, and **Use default** (`allowed: null`) shows only when
  an override exists, including on a top-level session the human turned off.

## Test fixtures

The client suites' fixtures are in `test/fixtures/inbox.js`, outside
`public/`, because the wrangler serves everything in `public/` under
`/ext/needsyou/`. Moved there in 0.1.1. The boot smoke checks that
`/ext/needsyou/inbox-fixtures.js` returns 404.
