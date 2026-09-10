/*
 * File-Path: supabase/functions/api/_shared/chunkedIn.ts
 * Purpose: PostgREST sends .in("col", [...ids]) as a GET request with the id list encoded
 *          directly in the URL query string -- with no chunking, a report that bulk-resolves
 *          per-row IDs (stock_document_id, material_id, etc.) via .in() can build a URL long
 *          enough to be rejected before ever reaching Postgres or PostgREST (no server-side
 *          log trail either, since the request never gets that far). Found live 2026-08-19:
 *          IN02's stock-document/material bulk-resolve queries silently failed once a date
 *          range pulled in ~400 distinct stock_document_id values -- a ~15,000 character URL.
 *
 *          §135.6-H (2026-09-10): a SECOND, distinct silent-loss failure mode found the same
 *          way -- PostgREST/Supabase caps a single response at a default row limit (db-max-rows,
 *          commonly 1000), silently, with `error: null` and just a truncated `data` array. This
 *          function's own id-chunking protects the REQUEST url length, but a chunk of
 *          DEFAULT_CHUNK_SIZE parent ids can still produce far more CHILD rows than that when
 *          the join is high-multiplier (e.g. AC10's process_order_line_reco lookup: ~12-15 rows
 *          per process_order_id, so a 100-id chunk can return 1000-1500 rows). Found live via a
 *          real AC10 batch whose dosage%/stroke/standard-qty data silently vanished mid-month --
 *          not a per-row logic bug, the whole chunk's response got truncated with no error
 *          anywhere. Every chunk's own query is now paginated via .range() until a short page
 *          proves there's nothing left, so no caller of this function -- current or future,
 *          anywhere in the codebase -- can hit this class of silent truncation, regardless of
 *          how many child rows one parent id chunk produces. Callers need NO changes: the
 *          `.range()` call is cast loosely here (single localized spot) since this codebase's
 *          DbQueryBuilder type stub doesn't declare it -- the same known, already-accepted
 *          typing gap every other `.range()`/`.gte()`/`.or()` caller in this codebase already
 *          has (real Supabase-js query builders support it at runtime regardless).
 *          Caveat: pagination across multiple pages relies on the underlying table's row order
 *          being stable across the (very short) window between page requests -- true in practice
 *          absent concurrent writes to the exact same rows, but not literally guaranteed without
 *          an explicit ORDER BY on the caller's own query. Still a strict improvement over
 *          guaranteed truncation for anything over one page.
 * Authority: Backend
 */

const DEFAULT_CHUNK_SIZE = 100;
const PAGE_SIZE = 1000;

export function chunkArray<T>(items: T[], size = DEFAULT_CHUNK_SIZE): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function throwChunkedInError(error: unknown): never {
  // Found live 2026-08-21: this used to throw a bare "CHUNKED_IN_FETCH_
  // FAILED" with the real PostgREST/Postgres error swallowed -- neither
  // the browser console nor Render server logs showed anything past that
  // generic wrapper, turning every real failure into a guessing game.
  // console.error here so Render logs at least carry it even before the
  // response reaches the client; the thrown message also carries it
  // since this file's caller pattern is `code = error.message` (see
  // ac01.handlers.ts and friends), so the real reason now reaches the
  // browser console directly.
  const err = error as { message?: string; code?: string; details?: string; hint?: string } | null;
  const detail = err
    ? [err.code, err.message, err.details, err.hint].filter(Boolean).join(" | ")
    : String(error);
  console.error("CHUNKED_IN_FETCH_FAILED", detail);
  throw new Error(`CHUNKED_IN_FETCH_FAILED: ${detail}`);
}

// Re-issues `queryFn(chunk)` once per PAGE_SIZE page (instead of awaiting it
// once) -- see module header for why. `.range()` is invoked via a loose cast
// since the codebase's DbQueryBuilder type stub doesn't declare it.
async function fetchOneChunkPaginated<TRow>(
  chunk: string[],
  queryFn: (idChunk: string[]) => PromiseLike<{ data: TRow[] | null; error: unknown }>,
): Promise<TRow[]> {
  const rows: TRow[] = [];
  let from = 0;
  for (;;) {
    // deno-lint-ignore no-explicit-any
    const builder = queryFn(chunk) as any;
    const result = await builder.range(from, from + PAGE_SIZE - 1);
    if (result.error) throwChunkedInError(result.error);
    const page: TRow[] = result.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break; // short page -- nothing left for this chunk.
    from += PAGE_SIZE;
  }
  return rows;
}

// Runs `queryFn` once per chunk of `ids` (chunks in parallel), paginating
// each chunk's OWN result set so no chunk can silently truncate past
// PAGE_SIZE rows, and concatenates everything. Throws if any page's query
// errors. `ids` should already be deduplicated by the caller.
export async function fetchInChunks<TRow>(
  ids: string[],
  queryFn: (idChunk: string[]) => PromiseLike<{ data: TRow[] | null; error: unknown }>,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<TRow[]> {
  if (ids.length === 0) return [];
  const chunks = chunkArray(ids, chunkSize);
  const chunkRows = await Promise.all(chunks.map((chunk) => fetchOneChunkPaginated(chunk, queryFn)));
  return chunkRows.flat();
}
