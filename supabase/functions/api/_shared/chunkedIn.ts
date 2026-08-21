/*
 * File-Path: supabase/functions/api/_shared/chunkedIn.ts
 * Purpose: PostgREST sends .in("col", [...ids]) as a GET request with the id list encoded
 *          directly in the URL query string -- with no chunking, a report that bulk-resolves
 *          per-row IDs (stock_document_id, material_id, etc.) via .in() can build a URL long
 *          enough to be rejected before ever reaching Postgres or PostgREST (no server-side
 *          log trail either, since the request never gets that far). Found live 2026-08-19:
 *          IN02's stock-document/material bulk-resolve queries silently failed once a date
 *          range pulled in ~400 distinct stock_document_id values -- a ~15,000 character URL.
 * Authority: Backend
 */

const DEFAULT_CHUNK_SIZE = 100;

export function chunkArray<T>(items: T[], size = DEFAULT_CHUNK_SIZE): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Runs `queryFn` once per chunk of `ids` (in parallel) and concatenates the results.
// Throws if any chunk's query errors. `ids` should already be deduplicated by the caller.
export async function fetchInChunks<TRow>(
  ids: string[],
  queryFn: (idChunk: string[]) => PromiseLike<{ data: TRow[] | null; error: unknown }>,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<TRow[]> {
  if (ids.length === 0) return [];
  const chunks = chunkArray(ids, chunkSize);
  const results = await Promise.all(chunks.map((chunk) => queryFn(chunk)));
  const rows: TRow[] = [];
  for (const result of results) {
    if (result.error) {
      // Found live 2026-08-21: this used to throw a bare "CHUNKED_IN_FETCH_
      // FAILED" with the real PostgREST/Postgres error swallowed -- neither
      // the browser console nor Render server logs showed anything past that
      // generic wrapper, turning every real failure into a guessing game.
      // console.error here so Render logs at least carry it even before the
      // response reaches the client; the thrown message also carries it
      // since this file's caller pattern is `code = error.message` (see
      // ac01.handlers.ts and friends), so the real reason now reaches the
      // browser console directly.
      const err = result.error as { message?: string; code?: string; details?: string; hint?: string } | null;
      const detail = err
        ? [err.code, err.message, err.details, err.hint].filter(Boolean).join(" | ")
        : String(result.error);
      console.error("CHUNKED_IN_FETCH_FAILED", detail);
      throw new Error(`CHUNKED_IN_FETCH_FAILED: ${detail}`);
    }
    if (result.data) rows.push(...result.data);
  }
  return rows;
}
