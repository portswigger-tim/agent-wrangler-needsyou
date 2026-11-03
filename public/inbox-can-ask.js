import { ICONS } from './icons.js';

// "Can ask the human" card action (contracts §8). Spawned sessions route their
// questions to their orchestrator by default; top-level sessions ask the human.
// The human can flip either, and only this browser path reaches
// `inbox-set-can-ask`.
//
// graph.inbox.sessions carries the effective `canAsk` and `canAskOverride`
// (null when the human hasn't chosen). There is one item (F7): its label names
// the state it moves to, its hint the current state. Setting an override always
// gives the non-default state, so clearing it (`null`) is the way back.
//
// The icon carries `icon ibx-icon`; core's `.context-menu-item svg` (15px)
// sizes it like core's own items, so the labels line up.
export function canAskItems(session, graph, api) {
  const sid = session?.sessionId;
  const entry = sid ? graph?.inbox?.sessions?.[sid] : null;
  if (!entry) return [];
  const override = typeof entry.canAskOverride === 'boolean' ? entry.canAskOverride : null;
  const spawned = !!entry.spawnedBy;
  const set = (value) => () => api.send({ type: 'inbox-set-can-ask', sessionId: sid, allowed: value });
  const item = (label, hint, value) => [{ label, hint, icon: ICONS.inbox, run: set(value) }];
  if (spawned) {
    return override === true
      ? item('Send its questions to the orchestrator', 'asks you directly', null)
      : item('Let it ask you directly', 'asks its orchestrator', true);
  }
  return override === false
    ? item('Let it ask you directly', 'blocked by you', null)
    : item('Stop it asking you directly', 'asks you directly', false);
}

export const canAskAction = { id: 'can-ask', items: canAskItems };
