/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/mtsColumnLayout.js
 * Purpose: PO22 column picker (owner 2026-10-28) — which columns are visible. Pure helpers; the hook that stores named layouts is usePo22ColumnLayouts.js.
 *          A layout is a list of visible column keys. Identity columns are always shown; a column added later (not in an old layout) is shown, so a
 *          saved layout never hides something new by accident. What the grid shows is what the Excel gets.
 */

/** Keys the user may switch (everything except the always-visible ones). */
export function pickableColumns(columns, alwaysVisible = (c) => c.group === "identity" || c.pinned === true) {
  return columns.filter((c) => !alwaysVisible(c) && c.label);
}

/** Saved list -> keys to hide. A key that is not in the saved list but exists in `columns` was added after the layout was saved: shown. */
export function hiddenFromSaved(savedVisible, columns, knownAtSave = null) {
  if (!Array.isArray(savedVisible)) return new Set();
  const saved = new Set(savedVisible);
  const known = knownAtSave ? new Set(knownAtSave) : null;
  const hidden = new Set();
  for (const c of pickableColumns(columns)) if (!saved.has(c.key) && (!known || known.has(c.key))) hidden.add(c.key);
  return hidden;
}

export function visibleKeys(columns, hidden) {
  return pickableColumns(columns).map((c) => c.key).filter((key) => !hidden.has(key));
}

/** Columns the grid and the Excel show. */
export function applyHidden(columns, hidden) {
  const pickable = new Set(pickableColumns(columns).map((c) => c.key));
  return columns.filter((c) => !pickable.has(c.key) || !hidden.has(c.key));
}

export function toggleHidden(hidden, key) {
  const next = new Set(hidden);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}
