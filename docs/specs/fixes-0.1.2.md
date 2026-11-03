# Fixes for 0.1.2

Status: **draft** · Source: the e2e screenshot walk-through (`e2e/run.sh`, 2026-11-03) and the
human's review of it. Screenshot numbers refer to the files in `e2e/screens/`. Every fix goes
through the verification gate. Contract changes are marked; only the orchestrator edits
`01-contracts.md`.

Priorities, as in 0.1.1:
- **P1:** wrong or misleading for the user
- **P2:** a known gap with a workaround
- **P3:** tidy-up

## Fixes

### F1 (P1): Label a status item by its cause, not always "Blocked" [contract §2]
**Problem:** every status item shows the red **Blocked** label (`09`). Most are not failures. A
permission prompt asks for approval, `AskUserQuestion` is a question, and a trust dialog asks for
confirmation. The human: "Not every status item is labelled as 'blocked'."
**Change:**
- Add `status.cause` to the item model (contracts §2):
  `'permission' | 'question' | 'trust' | 'sign-in' | 'update' | 'container' | 'api-error' | 'other'`.
  `normaliseItem` keeps a valid value and sets anything else, or a missing value, to `'other'`.
- `reconcile` sets it from one table, `causeFor(waitingFor, waitingReason)`, beside `titleFor`.
  Use the same phrase matches as `titleFor`, so the two can never disagree. Each `titleFor` row maps
  to one cause. A `waitingFor` that matches no phrase (such as `Bash: npm publish`) is a
  **permission** prompt: core shows the tool call only while it waits for approval. If that is
  wrong for some value, it is `'other'`.
- `store.update` may change `status.cause`, as it may change `waitingFor`.
- `item.kind` stays `'blocked'` for every status item, so no other contract changes.
- The client shows a label and an icon per cause. Only real failures are red:

| cause | label | colour |
| --- | --- | --- |
| permission | Permission | default |
| question | Question | default |
| trust | Trust | default |
| sign-in | Sign-in | default |
| update | Restart | default |
| container | Blocked | red |
| api-error | Blocked (blocking) or Error (transient) | red |
| other | Waiting | default |

An item without `status.cause` (one made before 0.1.2) shows as `other`.
**Acceptance:**
- `causeFor` tests cover every row, and they include the `Bash: npm update` regression case.
- Model tests cover the label and colour for each cause.
- The e2e queue (`09`) shows 7 different labels, and only the API error and the container
  failure are red.

### F2 (P1): A status item says what to do, and shows its text once
**Problem:** the status detail shows `waitingFor` twice (`10`, `15`, `26`). It appears in the body
box (reconcile copies it into `body`) and again as a plain line, which sits against the buttons
(`public/inbox-view.js:264`). Neither tells the human what to do. "trust dialog" and
"input needed" are core's internal phrases.
**Change:**
- The detail shows one guidance sentence per cause, in plain English:
  - **permission:** "The agent wants to do this and needs your approval. Open the session to allow or deny it."
  - **question:** "The agent asked you a question in its terminal. Open the session to answer it."
  - **trust:** "The agent is asking whether to trust this folder. Open the session to confirm."
  - **sign-in:** "The agent needs you to sign in. Open the session to finish signing in."
  - **update:** "The agent was updated and needs a restart. Open the session to restart it."
  - **container:** "The session's container did not start. Open the session to see the error."
  - **api-error:** "The agent hit an API error that it cannot retry. Open the session to see it."
  - **other:** "The session is waiting for you. Open the session to see what it needs."
- Under the guidance sentence, show the terminal text once in the body box, headed
  "From the terminal". Leave it out when it is only core's phrase (`permission prompt`,
  `input needed`, `trust dialog`): reconcile sets `body` to `''` for those.
- Remove the plain `ibx-d-waiting` line.
- Leave a gap of at least 12 px between the text and the buttons.
**Acceptance:**
- View tests: the text appears once, the guidance sentence matches the cause, and the body is
  absent for core's phrases.
- In e2e, `10`, `14`, `15` and `26` show it once with guidance.

### F3 (P1): A failed delivery is readable, named and honest
**Problem:** `24` and `28` show four problems:
- The red **Not delivered** tag can't be read: its text is red on red, and in Light it is dark
  red on red.
- The error shows the raw card id (`Session e2e-archived is archived; …`).
- **Retry** is the main button, but retrying an archived session can never work.
- The row still says "waiting <1m" although the human has answered.
**Change:**
- The tag uses the board's danger colour on a tinted background, like core's error chips. Check
  contrast at 4.5:1 or more in Light and Dark.
- Show the error in plain words with the session's name. If the session is archived (from
  `graph.sessions`, or the error text says archived), show: "Not delivered: <name> is archived.
  Restore it from the archive, then retry, or dismiss this." Otherwise show "Not delivered:
  <core's error>".
- When the session is archived, **Dismiss** is the main button and **Retry** is secondary. Otherwise
  **Retry** stays the main button.
- The row of an answered-but-failed item shows "answered <age> ago", not "waiting".
**Acceptance:**
- View tests for the archived and the generic case.
- e2e `24` and its Light version show a readable tag and the session name.

### F4 (P1): Show high urgency, and sort it with the blockers
**Problem:** `urgency: 'high'` shows nowhere: not on the row, not in the detail and not on the
card pill. An urgent approval sits below 7 status items (`09`), because `queueTier` puts every
status item in tier 0 and high-urgency requests in tier 1.
**Change:**
- Tier 0 is every status item **and** every high-urgency agent request, oldest first.
- Show an **Urgent** tag on the row and in the detail header, in the board's warning colour.
- The card pill uses the warning colour when its session has an urgent open item.
**Acceptance:**
- Model tests for the new tiers.
- e2e `09` shows the force-push approval among the first items, with the tag.

### F5 (P2): The queue opens on its first item
**Problem:** at desktop width, opening the view with items selects nothing, so the right half is
blank with no hint (`09`).
**Change:**
- At desktop width (two panes), when nothing is selected, select the first item without moving
  focus and without marking it read. Marking it read stays tied to the human opening it.
- At phone width, keep the list first.
- When the queue is empty, the right pane stays empty, and the left pane already says
  "Nothing needs you right now."
**Acceptance:** a view test, and e2e `09` shows a detail.

### F6 (P1): The answer box is full width, and Send has room
**Problem:** the note and answer box is about 250 px wide under full-width options. **Send** sits
directly under the box with no gap. In an approval it sits directly under the options
(`17`, `19`, `21`, `31`). The human: "The send button is way too close."
**Change:**
- The textarea is the full width of the detail column, with at least 3 rows.
- Give it a visible label: "Your answer" for an open question, or "Add a note (optional)" when
  options are present. A placeholder is not enough, because it disappears once you type.
- Leave a 12 px gap between the options and the textarea, and between the textarea (or the
  options) and the button row.
**Acceptance:** e2e `17`, `19`, `21` and `31` show the full-width box and the gaps, in Light,
Dark and 375 px.

### F7 (P2): Card-menu items match core's, and the override reads clearly
**Problem:**
- Our card-menu items have no icon, so their text does not line up with core's items (`07`, `08`).
- After the human allows a worker, the menu shows two similar items: "Route questions to
  orchestrator · allowed by you" and "Use default · route to orchestrator".
- The hint "default" alone is unclear.
**Change:**
- Give each item the person-silhouette icon, so the text lines up. Core's menu passes a
  `card.action` item's `icon` through (confirmed in agent-wrangler `public/app.js`, the
  `card.action` mapping).
- Show **one** item that names the state it moves to, with a hint that names the current state:
  - **Spawned, no override:** "Let it ask you directly", hint "asks its orchestrator".
  - **Spawned, allowed:** "Send its questions to the orchestrator", hint "asks you directly".
    This item clears the override (`null`), which restores the default.
  - **Top-level, no override:** "Stop it asking you directly", hint "asks you directly".
  - **Top-level, refused:** "Let it ask you directly", hint "blocked by you". This item clears
    the override.
- Drop the separate "Use default" item. No state then needs it: for each kind of session,
  clearing the override always restores the default, and setting it gives the other state.
**Acceptance:**
- `inbox-can-ask` tests for all 4 states.
- e2e `07` and `08` show aligned icons and one item.

### F8 (P3): Next is disabled on an empty queue
**Problem:** **Next** looks active when nothing is waiting (`02`).
**Change:** disable it, with `aria-disabled`, when the queue is empty or only the selected item
remains.
**Acceptance:** a view test, and e2e `02`.

### F9 (P2): An action request has a Done button, and non-blocking requests say so
**Problem:** an `action` asks the human to do something, then "reply done". The human has to type
it (`20`). Nothing shows that `blocking: false` requests leave their session working.
**Change:**
- For `kind: 'action'` with no options, show a main **Done** button. It sends free text `done`,
  using the same answer path. The text box stays, for a note.
- A non-blocking request shows "The agent is still working." under the detail header.
**Acceptance:** a view test, and e2e `20`.

### F10 (P3): Version and changelog
**Change:** bump to 0.1.2 in both `package.json` and the lockfile. Add a CHANGELOG entry that lists
F1–F9.

## How the fixes run

- The orchestrator applies the contract change first, on `main`: §2 `status.cause` (done with
  this spec). After the merge, the orchestrator updates the WS-3 (`causeFor`) and WS-4 (labels,
  card action) specs to match.
- One worker takes F1–F10 on branch `fixes-0.1.2` in a worktree, and commits through the gate.
- **Acceptance for the whole batch:**
  - `npm run verify` passes.
  - `AW_REPO=<agent-wrangler checkout> e2e/run.sh` exits 0.
  - The worker looks at every screenshot it names above, in Dark, Light and 375 px.
  - The worker mails the orchestrator the screenshots that changed.
- The e2e harness (`e2e/**`) belongs to the orchestrator. The worker may extend `screens.mjs` to
  reach a new state (such as a Done click on an archived card), but must not weaken an
  expectation.
