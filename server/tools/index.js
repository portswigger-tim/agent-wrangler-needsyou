import { makeRequestHumanInputTool } from './request-human-input.js';
import { withdrawHumanRequestTool } from './withdraw-human-request.js';
import { makeListMyHumanRequestsTool } from './list-my-human-requests.js';

// The agent-facing MCP tools (docs/specs/01-contracts.md §9). None takes a
// session parameter: each acts for its caller's card id.
export function makeInboxTools({ now = Date.now } = {}) {
  return [makeRequestHumanInputTool({ now }), withdrawHumanRequestTool, makeListMyHumanRequestsTool({ now })];
}

export const inboxTools = makeInboxTools();
