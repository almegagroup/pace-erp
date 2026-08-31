/*
 * File-Path: supabase/functions/api/_shared/fetchAllRows.ts
 * Purpose: PostgREST caps a single request at 1000 rows by default -- a
 *          handler that reads raw stock_ledger (or any other append-only,
 *          ever-growing table) rows to derive a balance by summing them
 *          client-side silently gets only the first 1000 once a company's
 *          history for that filter grows past the cap, with no error and no
 *          server-side log trail. Found live 2026-08-31/09-01 across several
 *          Process PO / Packing PO / Location Transfer / PID / Partial
 *          Reversal availability checks -- some of those checks are
 *          batch-specific (no stock_snapshot equivalent exists, since
 *          stock_snapshot deliberately never splits by batch, see CLAUDE.md
 *          §83.15.1/PID note), so switching them to stock_snapshot the way
 *          process_order.handlers.ts's plain (non-batch) checks were fixed
 *          would silently change WHAT is being summed, not just how. This
 *          instead pages through with .range() until a page returns fewer
 *          rows than the page size, changing nothing about the computation
 *          -- every row is still summed, batch filter and all -- just never
 *          silently stopping at row 1000.
 * Authority: Backend
 */

const DEFAULT_PAGE_SIZE = 1000;

// Runs `queryFn(from, to)` repeatedly (sequential -- each page's `from` depends
// on the previous page's size, and Postgres range-paging over a query without
// a stable ORDER BY can otherwise skip/duplicate rows across concurrent
// writes) until a page comes back shorter than `pageSize`, concatenating all
// rows. Callers should still add `.order()` on a stable column when the table
// is being actively written to during the fetch, for the same reason.
export async function fetchAllRows<TRow>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: TRow[] | null; error: unknown }>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<TRow[]> {
  const rows: TRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryFn(from, from + pageSize - 1);
    if (error) {
      const err = error as { message?: string; code?: string; details?: string; hint?: string } | null;
      const detail = err
        ? [err.code, err.message, err.details, err.hint].filter(Boolean).join(" | ")
        : String(error);
      console.error("PAGED_FETCH_FAILED", detail);
      throw new Error(`PAGED_FETCH_FAILED: ${detail}`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}
