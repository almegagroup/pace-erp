import { useCallback, useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import { listSalesOrderFgSkuOptions } from "../procurementApi.js";

const MINIMUM_SEARCH_LENGTH = 3;

const labelFor = (sku) => sku
  ? [sku.pace_code, sku.external_code, sku.document_name || sku.material_name].filter(Boolean).join(" | ")
  : undefined;

// The paged endpoint returns { data, next_cursor }. During a rolling frontend /
// backend deployment an older API instance can still return the former bare
// array response, which must remain usable instead of making every valid SKU
// look unavailable in SO01.
function rowsForSkuPage(page) {
  if (Array.isArray(page)) return page;
  return Array.isArray(page?.data) ? page.data : [];
}

export default function SalesOrderFgSkuPicker({ companyId, fgType, value, selectedSku, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const pendingSearch = search.trim() !== debouncedSearch;
  const canSearch = debouncedSearch.length >= MINIMUM_SEARCH_LENGTH;
  const needsMoreCharacters = search.trim().length < MINIMUM_SEARCH_LENGTH;
  const query = useInfiniteQuery({
    queryKey: ["so01-fg-sku-search", companyId, fgType, debouncedSearch],
    queryFn: ({ pageParam }) => listSalesOrderFgSkuOptions({
      company_id: companyId, fg_type: fgType, q: debouncedSearch, cursor: pageParam,
    }),
    initialPageParam: "own:0",
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    // The SKU master can grow without limit. Searching only after enough
    // characters prevents opening an FG row from becoming a full-master scan.
    enabled: Boolean(open && companyId && fgType && canSearch && !pendingSearch),
    staleTime: 60_000,
  });
  const { fetchNextPage, hasNextPage, isFetching, isError } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching && !isError && canSearch && !pendingSearch) fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetching, isError, canSearch, pendingSearch]);
  const skus = pendingSearch ? [] : [...new Map(
    (query.data?.pages ?? []).flatMap(rowsForSkuPage).map((sku) => [sku.id, sku]),
  ).values()];
  const statusLabel = isError
    ? "SKU search failed. Please retry."
    : needsMoreCharacters
      ? `Type at least ${MINIMUM_SEARCH_LENGTH} characters to search SKUs.`
      : undefined;
  return (
    <div>
      <ErpComboboxField value={value} selectedOptionLabel={labelFor(selectedSku)}
        onChange={(id) => onChange(id, skus.find((sku) => sku.id === id))}
        options={skus.map((sku) => ({ value: sku.id, label: labelFor(sku) }))}
        disabled={!companyId || !fgType} blankLabel={fgType ? "Select SKU" : "Select FG Type first"}
        inputProps={{ maxLength: 100 }}
        remoteSearch onSearchChange={setSearch} onOpenChange={setOpen}
        onLoadMore={loadMore} hasMore={Boolean(hasNextPage) && canSearch && !isError}
        loading={canSearch && (pendingSearch || isFetching)}
        statusLabel={statusLabel}
      />
      {open && isError && <button type="button" className="text-xs text-red-700 underline"
        onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={() => query.isFetchNextPageError ? fetchNextPage() : query.refetch()}>Retry SKU search</button>}
    </div>
  );
}
