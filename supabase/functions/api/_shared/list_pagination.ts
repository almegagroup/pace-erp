/*
 * Shared list-search contract for ERP registers.
 *
 * New callers use page/per_page/search. limit/offset remains accepted while
 * older screens are migrated, so an API rollout cannot break a live screen.
 */

export type ListSearchPage = {
  page: number;
  perPage: number;
  offset: number;
  search: string;
};

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseListSearchPage(url: URL, defaultPerPage = 50, maxPerPage = 200): ListSearchPage {
  const perPage = Math.min(
    maxPerPage,
    positiveInteger(url.searchParams.get("per_page") ?? url.searchParams.get("limit"), defaultPerPage),
  );
  const requestedPage = url.searchParams.get("page");
  const page = positiveInteger(requestedPage, 1);
  const suppliedOffset = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
  const offset = Number.isFinite(suppliedOffset) && suppliedOffset >= 0
    ? suppliedOffset
    : (page - 1) * perPage;
  // PostgREST ILIKE treats % and _ as wildcards. List search is literal text.
  const search = String(url.searchParams.get("search") ?? "").trim().replace(/[%_]/g, "");
  // Older callers send only limit/offset. Report their real page too, while
  // allowing new callers to make page the source of truth.
  const resolvedPage = requestedPage
    ? page
    : Math.floor(offset / perPage) + 1;
  return { page: resolvedPage, perPage, offset, search };
}

export function listPagination(page: number, perPage: number, total: number) {
  return {
    page,
    per_page: perPage,
    total,
    total_pages: total === 0 ? 0 : Math.ceil(total / perPage),
  };
}
