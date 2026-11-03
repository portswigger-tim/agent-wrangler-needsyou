# Agent requests: tools, answers, who may ask (WS-2)

The non-obvious decisions behind `server/tools/`, `server/answer.js`,
`server/can-ask.js`, `server/handlers/answer.js` and `skills/inbox/`.

## `request_human_input`

- **The order of checks:** identity → canAsk → validate → dedupe update → rate
  limit → create. A refusal, a validation failure, a dedupe update or a cap
  refusal doesn't count towards the rate limit (3 new items per session per 10
  minutes), so an agent that restates or fixes a request is never throttled
  for it.
- **A dedupe update replaces the request wholesale**: title, body, options and
  the rest, except `kind`, which can't change. It keeps the item's id and read
  state, so the human isn't notified again.
- **The result** is `structuredContent: { id, state, blocking, updated }` plus
  a lead line. A blocking request is told to end its turn. A non-blocking one
  is told to "carry on with work that does not depend on it".
- `list_my_human_requests` returns `{ requests: [...] }`, since
  structuredContent must be an object. It lists only the caller's agent items.
- **The tool description is not how agents find the tool.** Agent Wrangler
  measured a tool description alone at 0/6. The `inbox` skill and its
  WRANGLER.md nudge are what make agents call it. The description says plainly
  what the tool is *not* for.
- **zod 4 against the wrangler's zod 3.** This repo's schemas are zod 4 and pass
  straight to the wrangler's MCP SDK, which sits beside zod 3.
  `scripts/validate-manifest.mjs` serves them through the wrangler's real
  `buildMcpServer` on every run, and `scripts/dev-smoke.mjs` does it over the
  real `/mcp`. Both check that `tools/list` keeps the schemas, that a valid call
  succeeds and that an invalid one is refused.

## Answers

- **Answers go back with `host.deliver`, not mail.** Extension mail is sent as
  `ext:needsyou` and framed as an untrusted peer message that invites a
  `send_message` reply to an address that isn't a session.
- The text starts `[Needs you] The human answered your request "<title>" (<id>).`,
  then `Choice:` and `Note:` lines. The skill teaches agents that prefix, so
  the format is a contract (§6).
- `deliverAnswer` treats anything but `mode: live | dormant` as failed, and
  records `error` results and throws the same way. It never throws for a
  failed delivery. If the item moved on while the delivery was in flight (it was
  withdrawn, say), it records nothing.
- **Delivering to a dormant card wakes it**, which launches the agent. Keep that
  in mind when testing: `scripts/dev-smoke.mjs` delivers only to an archived
  card, which is refused.

## Who may ask

- `canAsk`: a store override (`true`/`false`) wins. Otherwise a session with
  `spawnedBy` is refused. `spawnedBy` is always returned, so the refusal can
  name the spawner, or say the human turned direct requests off.
- Only `inbox-set-can-ask` changes an override, and only the human's browser
  sends it. No MCP tool reaches it.

## Compliance eval

The procedure is in [`testing.md`](testing.md#compliance-eval-ws-2). It hasn't
been run yet.
