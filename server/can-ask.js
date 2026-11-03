// Who may ask the human directly (docs/specs/01-contracts.md §8). A session
// launched by another session (`spawnedBy`) is refused by default and pointed
// at its spawner; the human can flip either default per session from the card
// menu (`inbox-set-can-ask`). No agent-reachable path changes an override.
export function canAsk(host, store, sessionId) {
  const spawnedBy = host.sessions.get(sessionId)?.spawnedBy ?? null;
  const override = store.canAskOverride(sessionId);
  return { allowed: override ?? !spawnedBy, spawnedBy };
}

// What request_human_input tells a refused caller. Live testing showed agents
// read a polite refusal as advice, retried and then asked in chat, so each
// variant is one explicit next step. Naming the spawner is the point: the
// worker's next move is a send_message to exactly that card.
export function refusalText({ spawnedBy }) {
  if (spawnedBy) {
    return 'Refused: this session was launched by another session, so it cannot ask the human. '
      + `Next step: call send_message now (to: "${spawnedBy}") with your question, its options and your recommendation. `
      + 'Do not call request_human_input again. The human will not see a question you write in chat.';
  }
  return 'Refused: the human has turned off direct requests from this session. '
    + 'Next step: decide using your brief and sensible defaults, say in chat which default you chose, and carry on. '
    + 'If you cannot proceed without the human, stop and explain in chat what you need. '
    + 'Do not call request_human_input again.';
}
