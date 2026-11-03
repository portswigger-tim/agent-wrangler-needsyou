// The card pill: a person silhouette and N on a card whose session has N items
// needing action, titled with the first one (in queue order), and nothing
// otherwise. A click opens the view on that session's first item.
//
// It is a core chip: `card-tag` (core public/cards.js) gives it the size, fill
// and icon size of the card's other chips in every theme; `ibx-pill` adds only
// what a clickable chip needs (styles.css).
//
// card.pill has one host PER CARD, so `onGraph` (the observer, deduplicated by
// graph identity in index.js) is called from every card's update; nothing here
// may assume it runs once per tick.
import { inboxOf, queueOrder } from './inbox-model.js';
import { setText, setAttr } from './inbox-dom.js';
import { ICONS } from './icons.js';

export function sessionQueue(graph, sessionId) {
  const inbox = inboxOf(graph);
  if (!inbox || !sessionId) return [];
  return queueOrder(inbox.items.filter((i) => i.sessionId === sessionId));
}

export function createPill({ onGraph = () => {}, onOpen = () => {} } = {}) {
  return {
    id: 'inbox',
    label: 'Needs you',
    mount(el) {
      const btn = el.ownerDocument.createElement('button');
      btn.type = 'button';
      btn.className = 'card-tag ibx-pill';
      btn.hidden = true;
      // Static markup from icons.js only; the count goes in as text below.
      btn.innerHTML = ICONS.inbox;
      const count = el.ownerDocument.createElement('span');
      count.className = 'ibx-pill-count';
      btn.appendChild(count);
      btn.addEventListener('click', (e) => {
        // The pill sits on a card, whose own click selects the card.
        e.stopPropagation();
        e.preventDefault();
        if (btn.dataset.itemId) onOpen(btn.dataset.itemId);
      });
      el.appendChild(btn);
    },
    update(el, session, graph) {
      onGraph(graph);
      const btn = el.querySelector('.ibx-pill');
      if (!btn) return;
      const queue = sessionQueue(graph, session?.sessionId);
      if (!queue.length) {
        btn.hidden = true;
        delete btn.dataset.itemId;
        return;
      }
      btn.hidden = false;
      btn.dataset.itemId = queue[0].id;
      setText(btn.querySelector('.ibx-pill-count'), String(queue.length));
      setAttr(btn, 'title', queue[0].title);
      setAttr(btn, 'aria-label', `Needs you: ${queue.length} waiting. ${queue[0].title}`);
    },
  };
}
