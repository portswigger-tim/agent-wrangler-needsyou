# Needs you — product & architecture overview

Status: **Draft v3** (extension-only) · Owner: product (orchestrator session) · Target: Agent Wrangler host API `^1.57.0`

## 1. Problem

A busy Agent Wrangler board runs many sessions in parallel. Some of them are stuck on the human:
- **blocked:** a permission prompt, trust dialog, sign-in or blocking API error
- **waiting on a decision:** an agent has reached a fork in the road

Today the human finds these by scanning cards or reading terminals. Sessions also produce a lot of
output that does *not* need the human, which buries the real asks.

## 2. Product goal

A **"Needs you"** view (extension id `needsyou`): a triage queue listing only what needs the human to
**decide or act**, ordered by the cost of waiting. It is glanceable like a live feed, self-clearing
and usually empty, and is worked one item at a time: answering or dismissing moves on to the next item.
An item appears only when a new decision or action is **required**. Everything else stays out:
progress, finished sessions, peer mail, FYIs.

This is built as an **external extension, with no changes to Agent Wrangler**.

### Success criteria

1. With a board tab open, every session in core `needs-you` (except transient API errors, §3) has
   exactly one open item within ~4 s.
2. An agent can raise a structured decision with one MCP tool call. The answer reaches that
   session without the human opening its terminal.
3. Items close themselves when the need goes away. "Needs you" never shows a stale "action required".
4. Each need surfaces **once**. Polls, reloads, restarts and several tabs never re-announce it.
5. Sessions spawned by another session cannot ask the human directly unless the human allows it.
   They are told to ask their orchestrator.
6. No item is created for an idle/finished session, peer `send_message`, checklist change, or
   anything not declared as a required action.

### Non-goals (v1)

- Answering core `needs-you` prompts (e.g. approving a permission) from "Needs you". v1 links to
  the session.
- Inferring decisions from chat text. An extension has no transcript access. We rely on the skill
  rule (WS-2) and measure compliance first.
- Routing workers' questions through orchestrators with answer/escalate tools. v1 refuses the
  worker and points it at its orchestrator over existing mail.
- Email, Slack or phone push, and events for other extensions. Planned for v1.1 (§8).

## 3. What appears in "Needs you"

| Source | Trigger | Item kind | Closes when |
| --- | --- | --- | --- |
| **Agent request** (`source: "agent"`) | Agent calls MCP `request_human_input` with a required-action `kind` | `decision`, `approval`, `question`, `action` | Human answers (delivered), agent withdraws, session archived/purged, or (blocking) session works again with no answer → `answered-elsewhere` |
| **Session status** (`source: "status"`) | A graph session enters core `status === "needs-you"` | `blocked` | Status leaves `needs-you`, session archived/purged, or the human dismisses that episode |

Excluded by default:
- `needs-you` with `waitingReason === "api-error"` (transient, retryable). The
  `includeTransientApiErrors` setting turns these on.
- `working` sessions that carry a `waitingFor`, e.g. "starting container".

**Who may ask:**
- A session with `spawnedBy` set (launched by another session, not the human) **cannot** use
  `request_human_input` by default. The tool refuses and names the spawner, so the worker
  `send_message`s its orchestrator.
- The human can allow a specific session from its card menu. Agents can never change this.

Claude Code's `AskUserQuestion` prompt surfaces as core `needs-you` (`waitingFor: "input needed"`,
confirmed on a live board on 2026-11-03), so the status source already covers agents that use it.

## 4. The one platform limitation

Server-side extension code cannot see session status. `host.sessions.*` returns an allow-listed
projection (`server/host-api/project.js`) with **no `status`, `waitingFor` or `waitingReason`**.
They exist only on the **graph** the browser receives.

So status detection runs in the **client half**:
1. Each board tab diffs `graph.sessions` and sends an idempotent `inbox-observe` snapshot.
2. The server's store is still the single source of truth: it reconciles, dedupes across tabs and
   persists.

The consequence: **status items appear only while a board tab is open**. On connect, a tab
reconciles immediately, and that is when the human looks anyway. Agent requests are unaffected.

v1 accepts this limitation. Keep `reconcile()` independent of where its input comes from, so
detection can move server-side later without other changes.

Answers go back with `host.deliver`, not mail. Mail from an extension is sent as `ext:needsyou` and
framed as an untrusted peer message that invites a reply to a non-session address.

## 5. Architecture

```
            ┌──────────────────────── agent session (Claude/Codex) ────────────────────────┐
            │ MCP: request_human_input / withdraw_human_request / list_my_human_requests    │
            └──────────────┬───────────────────────────────────────────▲────────────────────┘
                           │ tool call (caller = card id)               │ host.deliver(sid,"[Needs you] …")
┌──────────────────────────▼────────────────── server half ─────────────┴───────────────────┐
│ tools/ (WS-2) ──► InboxStore (WS-1) ◄── reconcile.js (WS-3) ◄── handlers/observe (WS-3)    │
│   (canAsk check)    ▲      │  ▲                                                             │
│ lifecycle (WS-5) ───┘      │  └── handlers: read/dismiss (WS-1), answer/retry/set-can-ask (WS-2) │
│                            └──► graph contributor `inbox` (WS-1) ──► board graph            │
└──────────────────────────────────────────────────────────────┬─────────────────────────────┘
                                                               │ graph.inbox / api.send(...)
┌──────────────────────────────────────────── client half ─────▼─────────────────────────────┐
│ public/index.js (WS-4): view "Needs you" + badge · card.pill · card.action · api.ui.notify   │
│ public/observer.js (WS-3): diff graph.sessions → api.send('inbox-observe', snapshot)         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Design rules:

- **One store, one writer API.** Every mutation goes through `InboxStore` (contracts §3), then
  `host.rebuild()`.
- **The graph is the read path.** The client reads `graph.inbox` in `update(el, ctx, graph)`.
  Handlers use `reply` only for errors.
- **Pure core, thin shells.** Logic lives in pure functions, tested with `node --test` and the
  shared fake host.
- **Text is text.** Agent-written strings go into the DOM via `textContent`, or through
  `api.ui.markdownPreview` (sanitised) for the body.

## 6. Workstreams and parallelism

| WS | Spec | Depends on | Parallel with | Owns (files) |
| --- | --- | --- | --- | --- |
| WS-1 Foundation & store | `ws1-foundation.md` | — | — | package.json, index.js, server/manifest.js, server/store.js, server/item.js, server/data-dir.js, server/atomic-json.js, server/graph.js, server/handlers/index.js, server/handlers/read.js, server/test-helpers.js, test-setup.js, AGENTS.md, CLAUDE.md, **stubs** for every other WS file |
| WS-2 Agent requests | `ws2-agent-requests.md` | WS-1 | WS-3, WS-4, WS-5 | server/tools/**, server/answer.js, server/can-ask.js, server/handlers/answer.js, skills/inbox/** |
| WS-3 Passive signals | `ws3-passive-signals.md` | WS-1 | WS-2, WS-4, WS-5 | public/observer.js, server/reconcile.js, server/handlers/observe.js |
| WS-4 "Needs you" UI | `ws4-inbox-ui.md` | WS-1 | WS-2, WS-3, WS-5 | public/index.js, public/inbox-*.js, public/icons.js, public/styles.css |
| WS-5 Lifecycle & retention | `ws5-lifecycle.md` | WS-1 | WS-2, WS-3, WS-4 | server/lifecycle.js, server/sweeps.js |
| WS-6 Integration & release | `ws6-integration.md` | WS-2..5 | — | scripts/**, .github/**, README.md, docs/notes/**, CHANGELOG.md |

```
WS-1 ──┬──► WS-2 ──┐
       ├──► WS-3 ──┤
       ├──► WS-4 ──┼──► WS-6 (v1 release)
       └──► WS-5 ──┘
```

- **Scripts and CI hand-over:** WS-1 creates the first `scripts/validate-manifest.mjs` and
  `.github/workflows/test.yml`. Ownership of both passes to WS-6 once WS-1 is merged. No other
  workstream edits them.
- **File ownership is exclusive.** A worker edits only files its spec owns. WS-1 creates stubs
  with the contracted exports, so `server/manifest.js` never changes after WS-1. A worker that
  needs anything else (including a contract change) messages the orchestrator rather than editing.
- **Branches and merging:** the repo has no git remote, so there are no PRs. Each worker works in
  a git worktree on branch `ws<N>-<slug>` from `main` and commits there. When done, it mails the
  orchestrator: the branch, the commit sha, the test output, and any decisions or deviations.
  The orchestrator reviews, merges into `main` and tells the next workers. Each worker's
  completion mail is also the source for WS-6's `docs/notes/`.

## 7. How to issue a spec to a worker session

Spawn one board session per workstream (worktree on, cwd = this repo), with this prompt:

> You are the WS-N worker for the "Needs you" Agent Wrangler extension (id `needsyou`). Read
> `docs/specs/00-overview.md`, `docs/specs/01-contracts.md` and `docs/specs/wsN-*.md` in full
> before writing code, and `AGENTS.md` too. Implement only the files your spec owns, meet every
> acceptance criterion, run `npm test`, and commit on your branch. Then `send_message` the
> orchestrator (card `<orchestrator id>`) with the branch, commit sha, test output and any
> decisions or deviations. If a contract seems wrong or you need a file you don't own, stop and
> message the orchestrator instead of working around it.

## 8. After v1

- **v1.1:** emit `ext:needsyou:attention` (started/cleared, once per item) on `host.events`. Adds the
  `events` capability, so installs re-consent. Phone/Slack/digest extensions can build on it.
- **Measure usage:** needs-you episodes per day, how often agents call the tool versus ending a
  turn with an unflagged question, and time-to-answer. This informs what to build next.
