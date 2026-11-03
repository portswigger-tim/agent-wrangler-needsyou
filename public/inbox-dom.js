// Keyed, in-place list patching (the checklist builtin's rule): the ~4 s graph
// tick re-renders the queue, and rebuilding it from a string would reset the
// scroll and replace rows mid-click. Rows are reused by key, moved only when
// out of place, and only new keys allocate an element.
//
// A row whose key has gone is not removed at once: it gets `ibx-leaving` (a
// CSS fade) and goes after `leaveMs`, so an item resolving under the human's
// eyes visibly fades rather than vanishing. Leaving rows are ignored by later
// patches, and a key that comes back revives its row.

export function setText(el, text) {
  const value = text ?? '';
  if (el.textContent !== value) el.textContent = value;
}

export function setAttr(el, name, value) {
  if (value == null || value === false) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== String(value)) {
    el.setAttribute(name, String(value));
  }
}

export function setClass(el, className) {
  if (el.className !== className) el.className = className;
}

// patchList(list, entries, { key, create, update, leaveMs, schedule })
//   key(entry) -> string; create(entry) -> Element; update(row, entry) -> void
// Returns the rows in entry order.
export function patchList(list, entries, { key, create, update, leaveMs = 0, schedule = setTimeout }) {
  const existing = new Map();
  for (const row of [...list.children]) {
    if (row.dataset.ibxKey != null) existing.set(row.dataset.ibxKey, row);
  }
  const rows = [];
  let prev = null;
  for (const entry of entries) {
    const k = String(key(entry));
    let row = existing.get(k);
    if (row) {
      existing.delete(k);
      if (row.classList.contains('ibx-leaving')) row.classList.remove('ibx-leaving');
    } else {
      row = create(entry);
      row.dataset.ibxKey = k;
    }
    update(row, entry);
    const want = prev ? prev.nextSibling : list.firstChild;
    // insertBefore(row, row) would detach and re-attach the row, which is
    // enough to blur focus inside it, so move only when out of place.
    if (want !== row) list.insertBefore(row, want);
    prev = row;
    rows.push(row);
  }
  for (const row of existing.values()) {
    if (leaveMs <= 0) { row.remove(); continue; }
    if (row.classList.contains('ibx-leaving')) continue;
    row.classList.add('ibx-leaving');
    schedule(() => { if (row.classList.contains('ibx-leaving')) row.remove(); }, leaveMs);
  }
  return rows;
}
