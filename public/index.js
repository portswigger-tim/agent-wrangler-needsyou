// Client half of "Needs you" (extension id `needsyou`): the triage-queue view
// with its rail badge, the card pill and the "can ask the human" card action.
// The graph is the only read path (contracts §4); every mutation is an
// `inbox-*` control message (§5).
//
// Every graph reaches `seeGraph` from the view's update and from each card
// pill's update. It is deduplicated by graph identity, so the observer sees
// each graph once however many cards are on screen (§10).
import { startObserver } from './observer.js';
import { ICONS } from './icons.js';
import { VIEW_ID, VIEW_HASH } from './inbox-model.js';
import { createInboxView } from './inbox-view.js';
import { createPill } from './inbox-pill.js';
import { canAskAction } from './inbox-can-ask.js';
import { createInboxToasts } from './inbox-toasts.js';

export function createClient({ navigate = defaultNavigate, startObserver: start = startObserver } = {}) {
  return {
    register(reg) {
      const api = reg.api;
      const observer = start(api);
      let lastGraph = null;
      let view = null;
      let pendingSelect = null;

      // Show the view and, once it has the item, select it with focus.
      const openItem = (id) => {
        navigate(VIEW_HASH);
        if (view) view.select(id, { open: true, focus: true });
        else pendingSelect = id;
      };

      const toasts = createInboxToasts(api, openItem);

      function seeGraph(graph) {
        if (!graph || graph === lastGraph) return;
        lastGraph = graph;
        observer.update(graph);
        toasts.update(graph);
      }

      reg.register('view', {
        id: VIEW_ID,
        label: 'Needs you',
        icon: ICONS.inbox,
        mount(el, mountApi) {
          view = createInboxView(el, mountApi || api);
          if (lastGraph) view.update(lastGraph);
          if (pendingSelect) { view.select(pendingSelect, { open: true, focus: true }); pendingSelect = null; }
        },
        update(el, _session, graph) {
          seeGraph(graph);
          view?.update(graph);
        },
        // Open items (contracts §4 `open`), not unread ones; 0 draws no badge.
        badge: (graph) => graph?.inbox?.open ?? 0,
        unmount() {
          view?.unmount();
          view = null;
        },
      });

      reg.register('card.pill', createPill({ onGraph: seeGraph, onOpen: openItem }));
      reg.register('card.action', canAskAction);
    },
  };
}

function defaultNavigate(hash) {
  const loc = globalThis.location;
  if (loc && loc.hash !== hash) loc.hash = hash;
}

export default createClient();
