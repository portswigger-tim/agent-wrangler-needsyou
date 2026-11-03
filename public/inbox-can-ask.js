import { ICONS } from './icons.js';

// "Can ask the human" card action (contracts §8). Spawned sessions route their
// questions to their orchestrator by default; top-level sessions ask the human.
// The human can flip either, and only this browser path reaches
// `inbox-set-can-ask`.
//
// graph.inbox.sessions carries the effective `canAsk` and `canAskOverride`
// (null when the human hasn't chosen). There is one item (0.1.4, C5) with a
// fixed label and a tick as its hint when the session can ask the human. Core
// shows an extension's hint as escaped text, so the tick is a character, not
// core's SVG check. The click flips the effective state: setting an override
// always gives the non-default state, so clearing it (`null`) is the way back.
//
// The icon carries `icon ibx-icon`; core's `.context-menu-item svg` (15px)
// sizes it like core's own items, so the labels line up.
export const CAN_ASK_LABEL = 'Let it ask you directly';

export function canAskItems(session, graph, api) {
  const sid = session?.sessionId;
  const entry = sid ? graph?.inbox?.sessions?.[sid] : null;
  if (!entry) return [];
  const override = typeof entry.canAskOverride === 'boolean' ? entry.canAskOverride : null;
  const spawned = !!entry.spawnedBy;
  // Same four states as 0.1.2, leftover overrides included.
  const value = spawned ? (override === true ? null : true) : (override === false ? null : false);
  const item = { label: CAN_ASK_LABEL, icon: ICONS.inbox, run: () => api.send({ type: 'inbox-set-can-ask', sessionId: sid, allowed: value }) };
  if (entry.canAsk === true) item.hint = '✓';
  return [item];
}

export const canAskAction = { id: 'can-ask', items: canAskItems };
