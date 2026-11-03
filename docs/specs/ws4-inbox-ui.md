# WS-4 — Inbox UI (view, badge, toasts, card pill)

**Depends on:** WS-1 merged · **Parallel with:** WS-2, WS-3, WS-5 · **Branch:** `ws4-inbox-ui`
**Read first:** `00-overview.md`, `01-contracts.md` (§2, §4, §5, §7, §8, §10), agent-wrangler
`docs/extensions.md` (the `view` slot with `badge`, `card.pill`, `api.ui.notify`,
`api.ui.markdownPreview`, `api.openSession`, `api.mountSession`, `api.settings`, `api.onConnect`,
`api.storage`) and `public/slots.js`. Also the checklist builtin's `public/` (in-place DOM
patching so the ~4 s graph tick doesn't reset scroll). The wrangler-squared `public/` folder shows
a large view done well.

## Goal

A mailbox-style view that shows only required actions, with the "new mail" count on the rail, a
toast when new mail arrives, and quick answering.

## Owned files

```
public/index.js            # register(reg): view + card.pill + observer wiring + notify
public/inbox-view.js       # view mount/update/unmount; pure render helpers exported for tests
public/inbox-dom.js        # keyed in-place list patching (no full innerHTML rebuilds)
public/inbox-notify.js     # new-mail detection + api.ui.notify
public/inbox-pill.js       # card.pill: "📬 N" on cards with open items
public/inbox-can-ask.js    # card.action: allow/stop a spawned session asking the human
public/icons.js            # inline SVGs (an extension cannot import core's icons.js)
public/styles.css
public/*.test.js           # happy-dom or pure-function tests
```

## UX spec

**Rail button:** `view` contribution `{ id: 'inbox', label: 'Inbox', icon: <inbox svg>, badge: (graph) => graph.inbox?.unread ?? 0 }`.
The badge returns `0` (no badge) when there is no unread item.

**Layout:** two panes. On widths under 900 px it collapses to list → detail with a Back button.

*List pane*, top to bottom:
1. Header "Inbox", the count "N need you", and a filter segmented control: **Needs you** (default:
   `open` + failed-delivery `answered`) · **Done (24 h)** (resolved).
2. Rows grouped **High urgency** first, then by `createdAt` desc. A row shows: an unread dot, a kind
   icon/label (`Decision`, `Approval`, `Question`, `Action`, `Blocked`), the title (ellipsis), the
   session name · task name, and relative age. A delivery `failed` row shows a red "Not delivered" tag.
3. Empty state: "Nothing needs you right now." (no illustration needed).
4. Status items for sessions with `spawnedBy` set show "spawned by <spawner name>", from
   `graph.inbox.sessions`, so the human has context.

**"Can ask the human" card action** (`public/inbox-can-ask.js`, a `card.action` value slot):
- **When it shows:** only on cards whose session has `spawnedBy` set (read from
  `graph.inbox.sessions[sid]`).
- **Label:** "Allow asking the human directly" when `canAsk` is false, and "Route questions to
  orchestrator" when it is true.
- **Click:** sends `inbox-set-can-ask { sessionId, allowed: !canAsk }`.
- **Hint:** "default" when there is no override. Restoring the default is not needed in v1.

*Detail pane* for the selected item:
- Title, kind, the session (a link button → `api.openSession(sessionId)`), task, age.
- Body rendered with `api.ui.markdownPreview(body)` inside a container (sanitised HTML is allowed
  only here). Everything else uses `textContent`.
- **Agent item, open:** option buttons (label + description), a free-text box when
  `allowFreeText` (Cmd/Ctrl+Enter submits), **Send**. While sending, buttons are disabled. Sends
  `inbox-answer`. When `optionId` and text are both allowed, the text goes with the chosen option as a note.
- **Agent item, answered:** shows the answer and delivery state, plus **Retry** when `failed`.
- **Status item:** `waitingFor` text, **Open session** (primary), **Dismiss**. Optional nice-to-have:
  an inline embedded session via `api.mountSession(el, sessionId)` behind a "Show terminal here"
  toggle. Always `unmount()` on close or selection change.
- Every open item has **Dismiss**, with a confirm for agent items: "The agent will not be told.".
- Opening an item in the detail pane sends `inbox-mark-read {ids:[id]}` once (track sent ids so
  it doesn't repeat every tick).

**Keyboard** (only while the view is active): `j`/`k` or ↑/↓ move the selection, `Enter` opens
it, `1`–`6` choose an option, `e` dismisses. Use plain listeners scoped to the view element
(focus inside it), not `api.keys.bind`. That avoids the manifest `keybindings` disclosure in v1.

**New-mail toast** (`inbox-notify.js`): on each graph, diff `items` ids where `state === 'open' &&
readAt === null` against the previous set. A **seeding rule** applies, as in core's `notifier.js`:
the first graph after load notifies nothing. For each new id, if `api.settings().notifyToasts !==
false`, call `api.ui.notify({ id: item.id, title: 'Inbox: ' + kindLabel, body: title, actions: [{id:'open', label:'Open', primary:true}, {id:'session', label:'Go to session'}] })`.
`open` navigates to `#view=ext:inbox:inbox` and selects the item. `session` calls `api.openSession`.
Withdraw the toast (`api.ui.withdraw(id)`) when the item leaves `open` or becomes read. At most
3 toasts at once: past that, show one summary toast `id: 'summary'`.

**Card pill** (`inbox-pill.js`): `card.pill` `{ id: 'inbox', label: 'Inbox requests' }`. It renders
"📬 N" (with `title` = first item title) on cards with N open items, and nothing otherwise. Click →
open the view with that session's first item selected. Its `update(el, session, graph)` also calls
`observer.update(graph)`, **at most once per graph object** (compare by identity), because the pill
has one host per card.

**Theming:** use only board CSS variables (`var(--bg)`, `--surface`, `--fg`, `--fg-muted`, `--accent`,
`--red`, `--border-muted` …) so dark, light and extension themes all work. Prefix all classes with `ibx-`.

## Observer wiring (contracts §10)

In `register(reg)`: `const observer = startObserver(reg.api)`. Call `observer.update(graph)` from
the view's `update` and from the pill's `update`, deduplicated by graph identity. Don't touch the
observer's internals.

## Acceptance criteria

- [ ] Render tests (pure helpers or happy-dom): list grouping/sorting, filter, empty state, failed
      tag, detail per kind/state, markdown only in the body container, agent text escaped elsewhere
      (inject `<img onerror>` in the title and assert it is inert).
- [ ] Notify tests: seeding (no toast on the first graph), one toast per new item, the setting off
      suppresses it, withdraw on read/resolve, the summary toast above 3.
- [ ] The badge equals `graph.inbox.unread`. Mark-read is sent once per item.
- [ ] In-place patching: a graph tick with an unchanged item set does not replace row elements
      (assert node identity) and keeps the scroll position and text-box contents.
- [ ] Manual: works in Dark and Light and at 375 px wide; keyboard flow answers a decision with no mouse.
