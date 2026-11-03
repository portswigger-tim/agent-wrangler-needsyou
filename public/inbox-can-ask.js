// "Can ask the human" card action (contracts §8): only on a card whose session
// another session spawned. Spawned sessions route their questions to their
// orchestrator by default; the human can let one ask directly, and turn that
// back off. Only this browser path reaches `inbox-set-can-ask`.
//
// graph.inbox.sessions carries the EFFECTIVE `canAsk`, not whether an override
// is set. For a spawned session the default is false, so `false` reads as the
// default and `true` can only be the human's override.
export function canAskItems(session, graph, api) {
  const sid = session?.sessionId;
  const entry = sid ? graph?.inbox?.sessions?.[sid] : null;
  if (!entry?.spawnedBy) return [];
  const allowed = entry.canAsk === true;
  return [{
    label: allowed ? 'Route questions to orchestrator' : 'Allow asking the human directly',
    hint: allowed ? 'allowed' : 'default',
    run: () => api.send({ type: 'inbox-set-can-ask', sessionId: sid, allowed: !allowed }),
  }];
}

export const canAskAction = { id: 'can-ask', items: canAskItems };
