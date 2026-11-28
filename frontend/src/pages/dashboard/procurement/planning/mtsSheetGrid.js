/*
 * PO22 Item Plan: instant, sheet-style recalculation of the day table while the user types a
 * Quantity to Dispatch (owner 2026-11-28: it must react at once, like the Google sheet).
 * Display only: it never touches the engine. Same rules as the sheet:
 *   Opening(today) = Closing(yesterday); Closing = Opening + ETA + Qty to Dispatch − Pro-rata;
 *   MAX DAYS = Closing ÷ Pro-rata; MIN STK = Opening − Pro-rata; MIN DAYS = MIN STK ÷ Pro-rata (rounded down).
 */

function wholeDays(stock, use) {
  if (!(Number(use) > 1e-9)) return null;
  return Math.floor(Math.max(0, Number(stock)) / Number(use) + 1e-9);
}

/**
 * @param {Array} grid   engine day rows (opening, closing, min_stock, use, ...)
 * @param {Record<string, number>} deltaByDay  extra quantity (can be negative) landing on a day
 */
export function applySheetDeltas(grid, deltaByDay) {
  const days = Object.keys(deltaByDay ?? {}).filter((d) => Math.abs(Number(deltaByDay[d])) > 1e-9);
  if (!days.length) return grid;
  let carried = 0;
  return grid.map((row) => {
    const before = carried;
    carried += Number(deltaByDay[row.day] ?? 0);
    if (Math.abs(before) < 1e-9 && Math.abs(carried) < 1e-9) return row;
    const opening = Number(row.opening) + before;
    const closing = Number(row.closing) + carried;
    const minStock = Number(row.min_stock) + before;
    return {
      ...row, opening, closing, min_stock: minStock,
      prorata_max_days: wholeDays(closing, row.use),
      prorata_min_days: wholeDays(minStock, row.use),
    };
  });
}

/**
 * What the typed values add on top of the grid being shown.
 * No preview: the grid holds the saved lots, so the change is typed − saved.
 * Preview open: the engine already applied the positive typed lots, so only a below-zero part is left.
 */
export function typedToDeltas(typedByDay, savedByDay, previewOpen) {
  const out = {};
  for (const [day, typed] of Object.entries(typedByDay ?? {})) {
    const value = Number(typed);
    out[day] = previewOpen ? Math.min(value, 0) : value - Number(savedByDay?.[day] ?? 0);
  }
  return out;
}
