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
});

export function kindIcon(kind) {
  return Object.hasOwn(ICONS, kind) ? ICONS[kind] : ICONS.question;
}
