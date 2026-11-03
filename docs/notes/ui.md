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

## Layout

- The narrow layout uses a container query on `.ibx-root` (< 900 px), not a
  media query, so it follows the view's width.
- Status items have a **Show terminal here** toggle (`api.mountSession`).
- Colour comes only from the board's CSS variables, so both themes work.

## Known v1 limits

- The card-menu hint can't tell "the default" from "an explicit override",
  because the graph has no override flag. It shows the effective value.
- A spawner's name falls back to `graph.sessions`, then to a short id.
- `public/inbox-fixtures.js` is test-only but is served under `/ext/needsyou/`.
  It's harmless.
