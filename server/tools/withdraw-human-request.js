import { z } from 'zod';
import { okResult, errorResult, NO_IDENTITY } from './result.js';

// Withdraw one of the caller's own requests: it no longer needs the human
// (the answer came another way, or the question went away). An answer that
// has not reached the session yet can be withdrawn too; a delivered one is
// already closed.
export const withdrawHumanRequestTool = {
  name: 'withdraw_human_request',
  description:
    'Withdraw one of your own requests from the human\'s "Needs you" queue, by the id '
    + 'request_human_input returned. Call it as soon as a request no longer needs the human: you got '
    + 'the answer another way (for example the human replied in your terminal), or the question went '
    + 'away. It acts only on requests made by the session you are running in; there is no session '
    + 'parameter. Never for status updates, summaries, or "done" notices. Those do not belong in the '
    + 'queue at all.',
  inputSchema: {
    id: z.string().min(1).max(64).describe('The request id, as returned by request_human_input or list_my_human_requests.'),
  },
  async handler({ host, caller }, args = {}) {
    if (caller == null) return errorResult(NO_IDENTITY);
    const store = host.stores.inbox;
    const item = typeof args.id === 'string' ? store.get(args.id) : null;
    if (!item || item.source !== 'agent' || item.sessionId !== caller) return errorResult('not your request');
    if (item.state === 'resolved') return errorResult(`This request is already closed (${item.resolvedReason}).`);
    const done = store.resolve(item.id, 'withdrawn');
    await host.rebuild();
    return okResult({ id: done.id, state: done.state, resolvedReason: done.resolvedReason });
  },
};
