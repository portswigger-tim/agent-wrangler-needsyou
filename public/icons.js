// Inline SVGs. An extension cannot import the core's icons.js, so these are
// our own, drawn in currentColor so the board's theme colours them. Static
// markup only: nothing agent-written is ever interpolated into these strings.
const SVG = (inner, cls = 'ibx-icon') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONS = Object.freeze({
  // The rail button and the card pill: a person silhouette (the human). It also
  // carries core's `icon` class, because the rail sizes its icons by that class
  // (`#nav-rail .icon`, 19px). At our 14px the same stroke drew thinner than its
  // neighbours. On the card, core's `.card-tag svg` sizes it.
  inbox: SVG('<circle cx="12" cy="7" r="4"/><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>', 'icon ibx-icon'),
  blocked: SVG('<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><path d="M8 12h8"/>'),
  decision: SVG('<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="20" r="2"/><path d="M6 9v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9"/><path d="M12 12v6"/>'),
  approval: SVG('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  question: SVG('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  action: SVG('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  back: SVG('<path d="m15 18-6-6 6-6"/>'),
  close: SVG('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  // A status item's icon is its cause (contracts §2 `status.cause`).
  'cause-permission': SVG('<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>'),
  'cause-question': SVG('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  'cause-trust': SVG('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="m9 13 2 2 4-4"/>'),
  'cause-sign-in': SVG('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>'),
  'cause-update': SVG('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
  'cause-container': SVG('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
  'cause-api-error': SVG('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  'cause-other': SVG('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
});

// `key` is a kind (agent request) or `cause-<cause>` (status item).
export function kindIcon(key) {
  return Object.hasOwn(ICONS, key) ? ICONS[key] : ICONS.question;
}
