# WS-1 — Foundation & store

**Blocks:** WS-2, WS-3, WS-4, WS-5. Keep it small and merge it fast.
**Branch:** `ws1-foundation` · **Read first:** `00-overview.md`, `01-contracts.md`, and wrangler-squared's
`AGENTS.md`, `server/manifest.js`, `server/test-helpers.js`, `server/atomic-json.js`,
`server/data-dir.js`, `scripts/validate-manifest.mjs` (`gh repo clone PortSwigger/wrangler-squared`).
Agent Wrangler source for reference: `gh repo clone PortSwigger/agent-wrangler`, mainly
`docs/extensions.md`, `server/extensions/index.js` (`validateManifest`), and
`server/extensions/builtin/checklist/` (the closest analogue).

## Goal

A repo that installs and loads as an enabled, do-nothing-yet extension. It contains the full
manifest, the real store, the graph contribution, the read/dismiss handlers, a fake host for
tests, and **stub files for every other workstream**, so those workstreams never edit the manifest.

## Owned files

```
package.json, package-lock.json, index.js, .gitignore, LICENSE (Apache-2.0), AGENTS.md, CLAUDE.md (@AGENTS.md)
test-setup.js                         # sets AW_DATA_DIR to a temp dir (copy wrangler-squared)
server/manifest.js                    # final manifest per contracts §1, settings per §7
server/item.js  server/item.test.js
server/store.js server/store.test.js
server/data-dir.js server/atomic-json.js
server/graph.js server/graph.test.js
server/handlers/index.js              # export const inboxHandlers = [...readHandlers, ...answerHandlers, ...observeHandlers]
server/handlers/read.js server/handlers/read.test.js
server/test-helpers.js                # fakeHost({ sessions, tasks, settings, deliver }) with spies on rebuild/deliver/broadcast
.github/workflows/test.yml            # npm ci && npm test on Node 20 and 22
```

## Stubs you create, which other workstreams own

Each stub must load and export the contracted name with an inert value:

| File | Stub export |
| --- | --- |
| `server/tools/index.js` | `export const inboxTools = [];` |
| `server/handlers/answer.js` | `export const answerHandlers = [];` |
| `server/handlers/observe.js` | `export const observeHandlers = [];` |
| `server/answer.js` | `export async function deliverAnswer() { throw new Error('not implemented'); }` |
| `server/reconcile.js` | `export function reconcile() { return { opened: [], resolved: [] }; }` |
| `server/lifecycle.js` | `export const lifecycleHooks = {};` |
| `server/sweeps.js` | `export const inboxSweeps = [];` |
| `server/can-ask.js` | `export function canAsk() { return { allowed: true, spawnedBy: null }; }` |
| `skills/inbox/SKILL.md` | frontmatter `name: inbox` + a one-line description (the loader quarantines a declared skill with no SKILL.md) |
| `public/index.js` | `export default { register() {} };` |
| `public/observer.js` | `export function startObserver() { return { update() {}, stop() {} }; }` |
| `public/styles.css` | empty |

Each stub starts with the comment `// Owned by WS-N — stub from WS-1.`, or the Markdown equivalent.

## Requirements

1. `package.json` `wranglerExtension` block and manifest agree exactly on `id`, `requires`,
   `engines`. Add a test (`server/manifest.test.js`) asserting that, importing `./manifest.js`
   (never `../index.js`).
2. `item.js` implements every limit in contracts §2 (`validateAgentRequest`, `normaliseItem`,
   `newItemId`). Titles are trimmed, newlines in the title collapse to spaces, options get unique
   ids, and an empty `options` array forces `allowFreeText = true`.
3. `store.js` implements contracts §3 exactly, with an injectable `now` and `idGen` for tests.
   - Atomic writes. Corrupt-file recovery as specified.
   - The `create` cap and per-session cap behave as specified. `maxOpenPerSession` is read from a
     `getSettings` function passed in by the factory (the store-factory bag has a read-through
     `settings`, host API ≥ 1.3.0).
   - `resolve` is idempotent. Every mutation bumps `rev`.
   - `update` never resets `readAt`.
   - The `canAsk` override map persists alongside the items, and `forgetSession` clears both.
4. `graph.js` implements contracts §4:
   - the 24 h resolved window and the 200 cap
   - `sessions` entries for item sessions and for every session with `spawnedBy` set, including
     `canAsk`. Get it by calling `canAsk(host, store, sessionId)` from `server/can-ask.js`. While
     that is still the WS-2 stub, it reports `true`; once WS-2 lands, it reports the real value with
     no change to graph.js.
   - defensive name lookups: a missing session reads
     `{ name: '', taskId: null, taskName: '', spawnedBy: null, canAsk: true }`.
5. `handlers/read.js` implements `inbox-mark-read` and `inbox-dismiss` with payload validation
   (unknown ids are ignored for mark-read; dismiss of an unknown id throws `unknown inbox item`).
6. `npm test` runs `node --test --import ./test-setup.js 'server/**/*.test.js' 'public/**/*.test.js'`.
7. `AGENTS.md` covers the repo's purpose, the no-import rule, file ownership (from overview §6),
   the commands, the dev-install recipe (copy into `<AW_DATA_DIR>/extensions/inbox`, never
   symlink), and the confirmed `sweeps` entry shape.

## Acceptance criteria

- [ ] `npm test` passes. Store coverage includes: create/answer/deliver/resolve transitions, an
      illegal transition throws, caps, dedupe lookup, persistence round-trip, corrupt-file recovery.
- [ ] `AW_REPO=<agent-wrangler checkout> node scripts/validate-manifest.mjs` passes: no quarantine,
      tools/handlers registered (copy and adapt wrangler-squared's script; WS-6 later extends it).
- [ ] Hand-placed into a dev wrangler, the extension appears enabled under Settings → Extensions
      with its five settings, and `graph.inbox` is present with `items: []`.
- [ ] No file imports agent-wrangler, `../index.js`, or a forbidden core module.
