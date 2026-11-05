/*
 * File-Path: frontend/src/shared/columnLayouts/columnLayoutHelpers.js
 * Purpose: Common column picker helpers (was PO22-only): which columns are visible and in what order. Pure helpers; the hook that stores named layouts is useColumnLayouts.js.
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

/** Default order of the pickable columns (as the report defines them). */
export function defaultOrderKeys(columns) {
  return pickableColumns(columns).map((c) => c.key);
}

/**
 * Full pickable order for a saved layout: its saved keys first, in the saved order, then every other pickable
 * column (hidden by that layout, or added later) in the report's own order. Saved keys that no longer exist are dropped.
 */
export function orderFromSaved(savedVisible, columns) {
  const base = defaultOrderKeys(columns);
  if (!Array.isArray(savedVisible)) return base;
  const exists = new Set(base);
  const first = [];
  for (const key of savedVisible) if (exists.has(key) && !first.includes(key)) first.push(key);
  return [...first, ...base.filter((key) => !first.includes(key))];
}

/**
 * Re-order the pickable columns without disturbing the always-visible ones: the pickable columns fill the slots
 * the pickable columns originally occupied, in `orderKeys` order. A pickable column missing from `orderKeys` (added later) goes last.
 */
export function applyOrder(columns, orderKeys) {
  if (!Array.isArray(orderKeys) || orderKeys.length === 0) return columns;
  const pickableSet = new Set(pickableColumns(columns).map((c) => c.key));
  const byKey = new Map(columns.filter((c) => pickableSet.has(c.key)).map((c) => [c.key, c]));
  const sequence = [];
  for (const key of orderKeys) if (byKey.has(key)) sequence.push(byKey.get(key));
  for (const [key, column] of byKey) if (!orderKeys.includes(key)) sequence.push(column);
  let next = 0;
  return columns.map((c) => (pickableSet.has(c.key) ? sequence[next++] : c));
}

/** Move a VISIBLE column one visible step up (-1) or down (+1); hidden columns in between are skipped over. */
export function moveKey(orderKeys, hidden, key, delta) {
  const from = orderKeys.indexOf(key);
  if (from < 0) return orderKeys;
  let to = from + delta;
  while (to >= 0 && to < orderKeys.length && hidden.has(orderKeys[to])) to += delta;
  if (to < 0 || to >= orderKeys.length) return orderKeys;
  const next = orderKeys.filter((k) => k !== key);
  next.splice(to, 0, key);
  return next;
}

/** Keys hidden when the user has no layout (columns flagged `defaultHidden: true`). */
export function defaultHiddenKeys(columns) {
  return new Set(pickableColumns(columns).filter((c) => c.defaultHidden === true).map((c) => c.key));
}
