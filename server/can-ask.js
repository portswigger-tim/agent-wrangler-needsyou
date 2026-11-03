// Who may ask the human directly (docs/specs/01-contracts.md §8). A session
// launched by another session (`spawnedBy`) is refused by default and pointed
// at its spawner; the human can flip either default per session from the card
// menu (`inbox-set-can-ask`). No agent-reachable path changes an override.
export function canAsk(host, store, sessionId) {
  const spawnedBy = host.sessions.get(sessionId)?.spawnedBy ?? null;
  const override = store.canAskOverride(sessionId);
  return { allowed: override ?? !spawnedBy, spawnedBy };
}

// What request_human_input tells a refused caller. Naming the spawner is the
// point: the worker's next move is a send_message to exactly that card.
export function refusalText({ spawnedBy }) {
  if (spawnedBy) {
    return 'You can\'t ask the human directly: this session was launched by another session. '
      + `Send your question to it with send_message (to: "${spawnedBy}"), including the context and options it needs.`;
  }
  return 'The human has turned off direct requests from this session. '
    + 'Decide using your brief and sensible defaults, or stop and explain in chat what you need.';
}
