# Foundation: manifest, store, graph (WS-1)

The non-obvious decisions behind `server/manifest.js`, `server/store.js`,
`server/item.js` and `server/graph.js`. What the host API does (sweep shape,
hook payloads, the settings view, `host.deliver` results) is in `AGENTS.md`,
"Confirmed against agent-wrangler main".

## The manifest

- `server/manifest.js` holds the manifest, and the root `index.js` only
  re-exports it. The wrangler's import scanner quarantines an extension with a
  file whose import climbs to the wrangler's own `index.js`, so tests import
  `./manifest.js`, never the root.
- The store factory's `bag.settings` is a frozen `{ get, all }` view that
  re-reads `config.json` on every call, not a values object. The manifest
  passes `getSettings: () => bag.settings?.all?.() ?? {}`, so a value changed in
  Settings reaches the store with no restart.
- A setting def has no `default` (the loader refuses one). Each consumer
  applies its own fallback from contracts §7.

## The store

- **One open item per `dedupeKey`.** `create` refuses a second open item with
  the same key. An agent without a key gets `agent:<sid>:<item id>`. A status
  item must bring `status:<sid>:<episode>`.
- **`update()` keeps `id`, `readAt`, `createdAt` and `dedupeKey`.** That is how a
  restated need (the same `dedupe_key`, or a status whose `waitingFor` changed)
  updates in place without being announced again.
- **`normaliseItem` repairs, and only `validateAgentRequest` rejects.** Stored
  data is coerced (trimmed, single-lined, clipped, invalid options dropped).
  Agent input goes through `validateAgentRequest` first, which refuses instead,
  so an agent learns its request was wrong rather than seeing it silently
  clipped.
- **`rev()` is seeded from the clock.** A restart never reuses a rev an open
  tab already saw.
- **A corrupt `inbox.json`** (bad JSON, the wrong shape or version) is moved to
  `inbox.json.corrupt-<ts>`, and the store starts empty, logged once. Losing
  the queue is better than refusing to boot the extension.
- **Caps:** 500 items in total (the oldest resolved items are pruned first) and
  `maxOpenPerSession` open agent items per session (default 5).

## The graph

- `graph.inbox.items` lists live items first, then resolved ones updated in the
  last 24 hours, each group newest first. The 200-item cap can only ever cut
  history, never something that needs action.
- `graph.inbox.sessions` covers every session that has an item **and** every
  session with `spawnedBy` set, so the card menu's "may ask" action has
  something to read before the worker has asked anything. It also lists each
  listed session's spawner (0.1.1), so "spawned by X" has X's name even when X
  has no item.
- Each entry has the effective `canAsk` and `canAskOverride` (`true`, `false`,
  or `null` when the human hasn't chosen). The card menu needs the override to
  show "default" honestly and to offer **Use default**.
- The contributor runs on every rebuild (about 4 s) and must not throw, so
  every host read is guarded and a failed lookup reads as an absent session.

## Tests

- `npm test` hands Node quoted globs, which Node expands from version 21, and
  they reach nested directories (`server/test-discovery.test.js` checks this).
  CI runs Node 22 and 24.
- `server/test-helpers.js` `fakeHost()` is the one fake host every server suite
  builds on. Its `deliver` answers like the real one, including
  `{ mode: 'error' }` for an unknown or archived card.
