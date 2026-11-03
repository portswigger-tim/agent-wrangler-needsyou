# WS-2 — Agent requests (MCP tools, skill, answer delivery)

**Depends on:** WS-1 merged · **Parallel with:** WS-3, WS-4, WS-5 · **Branch:** `ws2-agent-requests`
**Read first:** `00-overview.md`, `01-contracts.md` (§2, §3, §5, §6, §8, §9), agent-wrangler
`server/extensions/builtin/checklist/tools/*.js` (tool shape), `.../adversarial-review/` (why a skill must
name its tool: tool descriptions alone are not followed, see `docs/extensions.md`, "adversarial-review"),
and `docs/extensions.md` on `host.deliver`.

## Goal

Agents can raise a **required** decision or action for the human, and the human's answer comes
back into the agent's prompt. The tool's design must stop agents using it for FYIs.

## Owned files

```
server/tools/index.js                     # export const inboxTools = [request, withdraw, list]
server/tools/request-human-input.js
server/tools/withdraw-human-request.js
server/tools/list-my-human-requests.js
server/tools/tools.test.js
server/answer.js  server/answer.test.js
server/can-ask.js server/can-ask.test.js
server/handlers/answer.js server/handlers/answer.test.js
skills/inbox/SKILL.md  skills/inbox/WRANGLER.md
```

## Tools

All tools take `handler({ host, caller }, args)`. If `caller == null`, return an error result
("no session identity"). Results return `{ content: [{type:'text', text: JSON}], structuredContent }`,
and errors return `isError: true`. Call `await host.rebuild()` after every mutation.

### `request_human_input`

```js
inputSchema: {
  kind: z.enum(['decision','approval','question','action']).describe(...),
  title: z.string().min(1).max(120),
  body: z.string().max(8000).optional(),          // markdown: context, trade-offs, what you recommend
  options: z.array(z.object({ id, label: z.string().min(1).max(80), description: z.string().max(300).optional() })).max(6).optional(),
  allow_free_text: z.boolean().optional(),
  blocking: z.boolean().optional(),               // default true
  urgency: z.enum(['normal','high']).optional(),
  dedupe_key: z.string().max(120).optional(),
  expires_in_minutes: z.number().int().min(5).max(10080).optional(),
}
```

Behaviour:
0. **Who may ask** (contracts §8): call `canAsk(host, store, caller)` first. If not allowed, return
   an error result:
   *"You can't ask the human directly: this session was launched by another session. Send your
   question to it with send_message (to: "<spawnedBy>"), including the context and options it
   needs."*
   The refusal never creates an item.
1. `validateAgentRequest` (WS-1 `item.js`) is the only validator. Map snake_case to the item fields.
2. If `dedupe_key` matches an open item **of the same session**, resolve the old item as
   `superseded` and create the new one. A matching key from another session is a separate namespace:
   store keys as `agent:<sid>:<key>`.
3. Enforce `maxOpenPerSession`. On breach, the error must tell the agent to withdraw or wait.
4. `taskId` comes from `host.sessions.get(caller)?.taskId ?? null`.
5. Return `{ id, state: 'open', blocking }` plus, as the text result, an instruction:
   *"Request queued in the human's Inbox. If blocking, end your turn now; the answer will arrive
   as a message starting `[Inbox]`."*

The description must say plainly: **use only when you cannot proceed correctly without the human's
decision or action. Never for status updates, summaries, or "done" notices.** Include one good and
one bad example.

### `withdraw_human_request`

`{ id: string, reason?: string(≤200) }`. Only the caller's own open/answered item. It resolves as
`withdrawn` and returns `{ id, state }`. An unknown id or another session's item → error
"not your request".

### `list_my_human_requests`

No args. Returns the caller's items from the last 24 h:
`[{ id, kind, title, state, resolvedReason, answer: { optionId, text } | null }]`. This lets an agent
that missed the delivered text (compaction, restart) recover its answer.

## Answer handlers

- `inbox-answer {id, optionId?, text?}`: the item must be `source:'agent'` and `state:'open'`.
  `store.answer`, then `await deliverAnswer(host, store, id)`, then `host.rebuild()`. Validate:
  `optionId` must be one of the item's options. `text` is required when there are no options. If
  `allowFreeText` is false and text is given, it is an error.
- `inbox-set-can-ask {sessionId, allowed}`: `allowed` is `true`, `false` or `null` (back to the
  default). The session must exist (`host.sessions.get`). Calls `store.setCanAskOverride`, then
  rebuilds. Only the human's browser sends this frame (WS-4's card menu). No MCP tool may change
  an override.
- `inbox-retry {id}`: only for `answered` items whose delivery is `failed`. At most 5 attempts in
  total; after that it throws "delivery keeps failing — open the session".

`deliverAnswer` follows contracts §6. `host.deliver` wakes a dormant card and refuses an archived
one. Store its error string verbatim (≤500 chars).

## Skill (`skills/inbox/SKILL.md` + `WRANGLER.md`)

`SKILL.md` frontmatter: `name: inbox`, plus a description that triggers on "need the human to
decide/approve/act". The body:
- **When to use:** a choice between materially different approaches, an irreversible or
  outward-facing action needing approval, missing information or credentials only the human has,
  or a manual action only the human can do (e.g. click an OAuth consent).
- **When not to use:** progress, summaries, "I'm done", questions you can answer with sensible
  defaults, anything already asked and not yet answered.
- **Ending a turn with a decision:** if you are about to end your turn by asking the human to choose,
  call `request_human_input`, with the choices as options, instead of only writing them in chat.
  That includes "what should I focus on next?", a "Decisions for you" or "Open questions" section,
  and "should I commit / spawn / proceed?". Keep the chat text too. One request per distinct
  decision (up to the per-session cap). Use `blocking: true`, because you are ending your turn.
  Worked example for the skill: an orchestrator ends its turn with
  "Decisions for you: spawn WS-1 now? commit the specs first?". That becomes
  two `decision` requests (or one with a free-text box, if they are related), each with yes/no
  options and a recommendation in the body.
- **How:** name the `request_human_input` tool explicitly. Give a 1-line title, a body with
  context, your recommendation, and 2–4 options. If blocking, end your turn right after the call.
- **On `[Inbox]` messages:** treat them as the human's answer to that id and continue.
- **If you get the answer elsewhere** (the human typed in the terminal): call `withdraw_human_request`.
- Recovery: call `list_my_human_requests` after a restart.
- **If the tool refuses because another session launched you:** send the question to that session
  with `send_message` (the refusal gives its id). Do not ask the human in chat instead.

`WRANGLER.md` is a one-paragraph nudge (look at a builtin's `WRANGLER.md` for the format).

## Acceptance criteria

- [ ] Unit tests (fake host) cover: happy path, every validation failure, dedupe supersede (same
      session only), per-session cap, withdraw of a foreign item refused, list scoping, answer
      with option / text / both / invalid, delivery success → `resolved:delivered`, delivery failure →
      `failed` with error and retry, retry cap.
- [ ] The delivered text matches contracts §6 byte-for-byte for a fixture (snapshot test).
- [ ] `canAsk` tests:
      - the default is allowed with no `spawnedBy` and refused with it
      - overrides win in both directions; `null` restores the default
      - the refusal text names the spawner id
      - a refused call creates nothing
      - no tool can change an override
- [ ] Compliance eval, in the style of agent-wrangler's adversarial-review measurement: 3 Claude + 3 Codex
      runs of a task that ends with a choice of next steps. Record how many call `request_human_input`
      before ending the turn (target ≥ 5/6) in the PR description.
- [ ] The tool descriptions contain the "never for status updates" sentence. A test asserts this,
      so later edits keep it.
- [ ] No session parameter on any tool. A test asserts every inputSchema lacks `session`/`sessionId`.
- [ ] Manual: in a dev wrangler, a Claude session that follows the skill raises a request, the item
      appears in `graph.inbox`, and answering via a raw `inbox-answer` frame delivers `[Inbox] …` to its pane.
