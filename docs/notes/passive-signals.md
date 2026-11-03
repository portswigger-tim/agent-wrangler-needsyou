# Passive signals: observer and reconcile (WS-3)

The non-obvious decisions behind `public/observer.js`, `server/reconcile.js`
and `server/handlers/observe.js`.

## Why detection runs in the browser

`host.sessions.*` has no `status`, `waitingFor` or `waitingReason`. Only the
graph the browser receives does. So each board tab diffs `graph.sessions` and
sends an `inbox-observe` snapshot, and the server reconciles. `reconcile()` is
pure apart from its store calls and knows nothing about where its input came
from, so a server-side source can replace the tabs later with no other change.

## The observer

- It sends only on a change, plus on every reconnect.
- **It ignores a graph with no `sessions` array.** A snapshot is `complete:
  true` (every non-archived session), so an empty one would resolve every
  status item.
- It clips strings to 500 characters and caps a snapshot at 500 sessions,
  `needs-you` first.

## Reconcile

- **Episodes.** A status item's `dedupeKey` is `status:<sid>:<updatedAt when
  first seen>`. Several tabs and repeated snapshots give one item.
  A changed `waitingFor` updates it in place, so it isn't announced again.
- **Titles** match core's exact phrases (from its terminal scraper), not bare
  words, so a permission prompt such as "Bash: npm update" keeps its own text
  ("Waiting for you: Bash: npm update").
- **Dismissal is lazy.** The dismiss handler can't tell reconcile, so reconcile
  remembers the status item it last saw open per session and notices when that
  item comes back `dismissed`. After a restart, the persistent check is a
  dismissed item with the same `dedupeKey`. A dismissed episode stays closed
  until the session next enters `needs-you`.
- **Answered elsewhere.** A blocking agent request closes as
  `answered-elsewhere` when its session goes `working` with no answer from the
  queue, but only once the session has been seen idle (or in `needs-you`) since
  the request appeared, and only past a 15 s grace period. Without those, the
  turn that raised the request could close it. **Setting:** "Close when the
  session moves on".
- **That "seen idle" flag is in memory.** After a server restart, a still-open
  blocking request closes only once its session is seen idle and then working
  again. If the human answered in the terminal just before the restart, the
  item stays open until the agent withdraws it or the human dismisses it.

## Open question

Does Claude Code's `AskUserQuestion` prompt show as core `needs-you`? Claude's
`needs-you` comes only from Claude Code's session file `status: 'waiting'`, not
from scraping the pane. WS-3 estimated a 65% chance it does. The check is in
[`testing.md`](testing.md#askuserquestion-ws-3). If it doesn't, agents that use
`AskUserQuestion` instead of `request_human_input` stay invisible to the queue.
