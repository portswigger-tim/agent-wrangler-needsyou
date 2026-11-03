# The "Needs you" view (WS-4)

The non-obvious decisions behind `public/index.js`, `public/inbox-*.js`,
`public/icons.js` and `public/styles.css`.

## Queue order and states

- An answer still being delivered leaves the queue and shows as "sending"
  under **Recently resolved**. A failed delivery comes back as the last tier of
  the queue, with **Retry**.
- "Unread" decides only the toasts and the row dot, never the order or the
  badge.

## Keyboard and focus

- Number keys pick an option and focus **Send**, so `Enter` sends. `n` moves on
  from the current item, not from the top.
- Keys are scoped to the view and stop propagating, so the board's own
  shortcuts don't fire while you work the queue.
- A MutationObserver focuses the view when it's shown. That is also when a
  pending selection (from a toast or a card pill) lands, and when items are
  marked read: an item counts as read once it has been on screen.

## Dismissing

An agent request asks you to confirm inline, since dismissing means the agent
never gets an answer. A status item dismisses at once: it comes back on the
session's next `needs-you` episode anyway.

## Toasts

A new item that stops a session (a blocked status item or a blocking request)
raises a toast. A non-blocking request only joins the queue. The first graph
after a load announces nothing, so a reload, a second tab or a restart never
re-announces anything. At most three item toasts show at once, and one summary
toast counts the rest. A toast is withdrawn once its item is read or closes.

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
