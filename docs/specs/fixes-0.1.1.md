# Fixes for 0.1.1

Status: **in progress** (reviewed 2026-11-03; contracts updated for F3, F4 and F14) · Source: live testing on a real board (2026-11-03), and the workers'
completion notes. Every fix goes through the verification gate. Contract changes are marked;
only the orchestrator edits `01-contracts.md`.

Each fix has a priority:
- **P1:** wrong or misleading for the user
- **P2:** a known gap with a workaround
- **P3:** tidy-up

## Live test results so far

| Check | Result |
| --- | --- |
| A session asks the human directly (`request_human_input` → answer → `[Needs you]`) | Pass |
| A worker is refused and routed to its spawner by mail; nothing reaches the queue | Pass |
| A permission prompt becomes one Blocked item in ~4 s and clears on approval | Pass |
| Two board tabs give one item | Pass |
| `AskUserQuestion` surfaces as needs-you (`waitingFor: "input needed"`) | Pass (confirmed) |
| UI: Light, Dark, 375 px, keyboard-only answer | To do |
| Routing eval (3 spawned workers, 2026-11-03) | **Fail**: 2/3 called the tool and were refused correctly, but 0/3 mailed their spawner. See F10–F12 |
| Compliance eval (3 Claude + 3 Codex, board-launched, target ≥ 5/6) | To do: re-run per F13 |

## Fixes

### F1 (P1): Clearer titles for the two commonest blocked states
**Problem:** live testing shows core's `waitingFor` is often a bare phrase. Titles read "Waiting for
you: permission prompt" and "Waiting for you: input needed", which are vague.
**Change:** in `titleFor` (`server/reconcile.js`), match the exact phrases (case-insensitive,
whole string) before the generic fallback:
- `permission prompt` → **"Permission needed in the session"**
- `input needed` → **"Question waiting in the session"**

Update the WS-3 spec table. **Acceptance:** tests for both phrases, and the
"Bash: npm update" style regression cases still pass.

### F2 (P1): Record that `AskUserQuestion` is covered
**Problem:** the docs still list it as an open question (~65%).
**Change:** `docs/notes/passive-signals.md` and `docs/notes/testing.md` say it is confirmed, with
the observed `waitingFor` ("input needed") and the date. Remove the open-question line from
`00-overview.md` §3. **Acceptance:** no doc calls it open.

### F3 (P2): Card action hint can't tell "default" from an explicit choice [contract §4]
**Problem:** `graph.inbox.sessions[sid]` carries the effective `canAsk`, but not whether the human
set it. The card menu can't show "default" correctly, or offer "Restore default".
**Change:**
- Add `canAskOverride: boolean | null` to each `graph.inbox.sessions` entry (`server/graph.js`).
- The `card.action` hint shows "default" only when the override is `null`.
- Add a **Use default** item that sends `inbox-set-can-ask { allowed: null }` when an override exists.

**Acceptance:** graph and pill tests cover all three override states.

### F4 (P2): The spawner's name is sometimes missing [contract §4]
**Problem:** "spawned by X" falls back to a short id when the spawner has no item and wasn't itself
spawned, because it isn't in `graph.inbox.sessions`.
**Change:** `server/graph.js` also includes each listed session's `spawnedBy` target (name and task
only). **Acceptance:** a graph test shows a top-level spawner with its name.

### F5 (P2): A restart forgets the "answered elsewhere" sequence
**Problem:** after a server restart, a still-open blocking agent request closes only once its
session is seen idle and then working again, because that sequence is kept in memory.
**Change (docs only for 0.1.1):** state this in `docs/notes/passive-signals.md` and in the
README's "When it closes" wording. Persisting it needs a store field; consider it for 0.2.

### F6 (P3): `AGENTS.md` overstates the import rule
**Problem:** it says any `from '../index.js'` is quarantined. Agent Wrangler main matches only two
or more `../` levels (found by WS-6).
**Change:** state the real rule. Keep the advice to import `./manifest.js` in tests.

### F7 (P3): Test fixtures are served to the browser
**Problem:** `public/inbox-fixtures.js` is test-only, but it sits in `public/`, so it is served
under `/ext/needsyou/`.
**Change:** move it to `test/fixtures/inbox.js` and update the imports in `public/*.test.js`.
**Acceptance:** `/ext/needsyou/inbox-fixtures.js` returns 404 in boot-smoke.

### F8 (P3): The startup retention run keeps ticking
**Problem:** the `retention-boot` sweep does its work once, then wakes every 30 s for nothing, and
its run-once flag does not reset when the extension is turned off and on.
**Change (decided after review):** keep the sweep (sweeps have only `everyMs`). Replace the closure
flag with a `WeakSet` of the store instances it has already run for. The store is built afresh on
each activation, so the run repeats once after every enable, and no manifest change is needed.
Document this in `docs/notes/lifecycle.md`.
**Acceptance:** tests show one run per store instance, and a second run for a new instance.

### F9 (P3): Version and changelog
**Change:** bump to 0.1.1 in `package.json`, regenerate the lockfile
(`npm install --package-lock-only --ignore-scripts`, which the lockfile-in-sync hook checks), and add
a `CHANGELOG.md` entry listing the fixes.

## From the human's testing

### F10 (P1): Refused workers ask in chat instead of mailing their spawner
**Seen:** a session asked to spawn 3 workers, each told to end by asking which improvement to do.
- 2 of 3 workers called `request_human_input`, were refused (correct), retried the same call once,
  then asked the human in chat.
- None used `send_message` to reach the spawner. The refusal text said to, but read as advice.

**Change** (`server/can-ask.js` `refusalText`, plus the tool description):
- Make the refusal an explicit next step: "Refused. Next step: call send_message now (to:
  "<spawnedBy>") with your question, its options and your recommendation. Do not call
  request_human_input again. The human will not see a question you write in chat."
- Keep the no-spawner variant's meaning, in the same imperative style.

**Acceptance:**
- Tests pin both texts.
- Update `scripts/dev-smoke.mjs`'s refusal expectation in the same commit, so the boot smoke stays
  green.
- Re-run the spawned-worker scenario: each worker mails its spawner, and none asks in chat. This is
  the human's live re-test.

### F11 (P1): Spawners don't know their workers' questions come to them
**Seen:** the spawning session told the human "their questions … will reach you from those
sessions". In fact, they are routed to the spawner, which didn't expect them and had already ended
its turn.

**Change** (`skills/inbox/WRANGLER.md` and `SKILL.md`), one short rule for spawners:
- Sessions you launch can't ask the human.
- Their questions come to you by mail.
- Answer what you can. For anything only the human can decide, raise one `request_human_input`
  yourself, combining related questions.
- Never tell the human that a worker will ask them directly.

**Acceptance:** re-run the scenario. The spawner relays or answers, and never promises direct
questions.

### F12 (P2): One in three workers ignored the nudge entirely
**Seen:** one worker never called the tool, and ended with "Which one would you like me to do next?"
in chat only. The nudge and the skill were both on its launch command.

**Change:**
- Move the end-of-turn rule to the first sentence of `WRANGLER.md`, as the trigger: "Before you end
  a turn with a question for the human, call `request_human_input`."
- Measure again in the compliance eval (F13) before doing anything heavier.

### F13 (P2): The compliance eval must use board-launched sessions
**Seen:** asking one session to "create 3 sessions" makes them workers, so the eval measured the
routing path, not direct asking.

**Change:** `docs/notes/testing.md` states the sessions must be started from the board UI, not by
another session, and adds the spawned-worker scenario above as a separate routing eval. The
pass criterion is that each worker mails its spawner.

### F14 (P1): Remove the toast notifications [contract §7]
**From the human:** get rid of the toast pop-ups. The badge and the queue are enough.

**Change:**
- Delete `public/inbox-notify.js` and its wiring in `public/index.js`. Keep the shared `seeGraph`
  path for the observer.
- Remove the `notifyToasts` setting from the manifest and contracts §7. Settings go from 5 to 4.
  An old value left in config.json is harmless.
- Update `scripts/validate-manifest.mjs` (expected settings), `dev-smoke.mjs` if it checks
  settings, README "Settings", `docs/notes/ui.md` "Toasts" and `docs/notes/testing.md`.

**Acceptance:** no `api.ui.notify` call remains. Tests and the validate/smoke scripts expect 4
settings.

### F15 (P2): Show a resolved request as a read-only view
**From the human:** the "Recently resolved" strip is hard to use. Opening one should show the
request read-only.

**Change:**
- Selecting a resolved row opens it in the detail pane in a **read-only** state:
  - title, kind, session and task
  - the body (sanitised markdown, as for open items)
  - the options, with the chosen one marked
  - the note the human sent
  - how and when it closed (the existing reason labels, with an absolute and a relative time)
  - for status items, the `waitingFor` text
- The only actions are **Open session** and **Back to queue**. No answer, dismiss or retry controls.
- Give the strip rows the same layout as queue rows (kind, title, session, reason, age), and make
  them keyboard-reachable (`j`/`k` continue into the strip when it is expanded).

**Acceptance:**
- Render tests for a resolved agent item (with choice and note), a dismissed item and a cleared
  status item.
- The read-only view has no answer controls.
- Agent text stays inert (the `<img onerror>` test).

### F16 (P2): A human silhouette icon, and a card chip that matches the others
**From the human:** use a human silhouette instead of the mail-inbox icon, and make the card
indicator look like the board's other card chips, not a coloured emoji.

**Change:**
- Replace `ICONS.inbox` (rail button) with a monochrome person-silhouette SVG. Use the board's
  icon style: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
  `stroke-width="2"`, round caps and joins. For example:
  `<circle cx="12" cy="7" r="4"/><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>`.
- The card pill (`public/inbox-pill.js`) drops the `📬` emoji. It renders the same silhouette
  SVG (about 12–14 px, `currentColor`) plus the count. It uses the same chip markup and classes
  as core's card chips (`card-tag`; check `cards.js` for the current class names) and only board
  CSS variables, so it matches every theme.
- Update the README screenshot alt text and `docs/notes/ui.md`.

**Acceptance:**
- No emoji in `public/`.
- Pill tests assert the SVG and the chip class.
- A manual check on the board, in Light and Dark, shows the chip beside the core chips at the
  same size and colour.

_Add more items here as they come up. Same format: problem, change, acceptance._

## Out of scope (not this extension)

- **Spawned sessions default to `auto` permission mode** (Agent Wrangler's `spawn_session`
  default). The extension changes no permission mode. An orchestrator that wants stricter workers
  should pass `permission_mode` on each spawn.
- **A read-only command such as `echo` never prompts**, even in `manual` mode (Claude Code
  behaviour). Use a command that writes when you test the blocked flow.

## How the fixes run

One worker session takes F1–F16 on branch `fixes-0.1.1`, commits through the gate, and mails the
orchestrator. The orchestrator applies the contract changes (§4 for F3 and F4, §7 for F14) first. Items from the
human's testing are added before the worker starts, or batched into a follow-up.
