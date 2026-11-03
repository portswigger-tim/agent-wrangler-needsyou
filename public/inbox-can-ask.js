// "Can ask the human" card action (contracts §8): only on a card whose session
// another session spawned. Spawned sessions route their questions to their
// orchestrator by default; the human can let one ask directly, and turn that
// back off. Only this browser path reaches `inbox-set-can-ask`.
//
// graph.inbox.sessions carries the effective `canAsk` and `canAskOverride`
// (null when the human hasn't chosen). The hint says "default" only when there
// is no override, and an override can be dropped with **Use default**.
export function canAskItems(session, graph, api) {
  const sid = session?.sessionId;
  const entry = sid ? graph?.inbox?.sessions?.[sid] : null;
  const override = typeof entry?.canAskOverride === 'boolean' ? entry.canAskOverride : null;
  if (!entry || (!entry.spawnedBy && override === null)) return [];
  const allowed = entry.canAsk === true;
  const set = (value) => () => api.send({ type: 'inbox-set-can-ask', sessionId: sid, allowed: value });
  const items = [{
    label: allowed ? (entry.spawnedBy ? 'Route questions to orchestrator' : 'Stop direct requests') : 'Allow asking the human directly',
    hint: override === null ? 'default' : (allowed ? 'allowed by you' : 'turned off by you'),
    run: set(!allowed),
  }];
  if (override !== null) {
    items.push({
      label: 'Use default',
      hint: entry.spawnedBy ? 'route to orchestrator' : 'ask directly',
      run: set(null),
    });
  }
  return items;
}

export const canAskAction = { id: 'can-ask', items: canAskItems };
