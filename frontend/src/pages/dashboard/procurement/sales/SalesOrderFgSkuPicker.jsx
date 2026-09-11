import { useCallback, useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import { listSalesOrderFgSkuOptions } from "../procurementApi.js";

const labelFor = (sku) => sku
  ? [sku.pace_code, sku.external_code, sku.document_name || sku.material_name].filter(Boolean).join(" | ")
  : undefined;

export default function SalesOrderFgSkuPicker({ companyId, fgType, value, selectedSku, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const pendingSearch = search.trim() !== debouncedSearch;
  const query = useInfiniteQuery({
    queryKey: ["so01-fg-sku-search", companyId, fgType, debouncedSearch],
    queryFn: ({ pageParam }) => listSalesOrderFgSkuOptions({
      company_id: companyId, fg_type: fgType, q: debouncedSearch, cursor: pageParam,
    }),
    initialPageParam: "own:0",
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: Boolean(open && companyId && fgType && !pendingSearch),
    staleTime: 60_000,
  });
  const { fetchNextPage, hasNextPage, isFetching, isError } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching && !isError && !pendingSearch) fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetching, isError, pendingSearch]);
  const skus = pendingSearch ? [] : [...new Map(
    (query.data?.pages ?? []).flatMap((page) => page.data).map((sku) => [sku.id, sku]),
  ).values()];
  return (
    <div>
      <ErpComboboxField value={value} selectedOptionLabel={labelFor(selectedSku)}
        onChange={(id) => onChange(id, skus.find((sku) => sku.id === id))}
        options={skus.map((sku) => ({ value: sku.id, label: labelFor(sku) }))}
        disabled={!companyId || !fgType} blankLabel={fgType ? "Select SKU" : "Select FG Type first"}
        inputProps={{ maxLength: 100 }}
        remoteSearch onSearchChange={setSearch} onOpenChange={setOpen}
        onLoadMore={loadMore} hasMore={Boolean(hasNextPage) && !isError}
        loading={pendingSearch || isFetching}
        statusLabel={isError ? "SKU search failed. Please retry." : undefined}
      />
      {open && isError && <button type="button" className="text-xs text-red-700 underline"
        onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={() => query.isFetchNextPageError ? fetchNextPage() : query.refetch()}>Retry SKU search</button>}
    </div>
  );
}
