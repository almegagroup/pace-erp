import { useCallback, useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import { listSalesOrderSfgMaterialOptions } from "../procurementApi.js";

// §141 — company+vendor-code-aware SFG picker, mirrors SalesOrderFgSkuPicker.jsx.
// A plain client-side filter over the shared master materials list (the old
// materialOptionsFor("SFG") path) had no company scoping or vendor-code
// eligibility awareness at all -- this dedicated endpoint/picker replaces it.

const MINIMUM_SEARCH_LENGTH = 3;

const labelFor = (material) => material
  ? [material.pace_code, material.external_code, material.document_name || material.material_name].filter(Boolean).join(" | ")
  : undefined;

function rowsForPage(page) {
  if (Array.isArray(page)) return page;
  return Array.isArray(page?.data) ? page.data : [];
}

export default function SalesOrderSfgMaterialPicker({ companyId, vendorCodeId, value, selectedMaterial, onChange }) {
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
    queryKey: ["so01-sfg-material-search", companyId, vendorCodeId, debouncedSearch],
    queryFn: ({ pageParam }) => listSalesOrderSfgMaterialOptions({
      company_id: companyId, vendor_code_id: vendorCodeId || undefined, q: debouncedSearch, cursor: pageParam,
    }),
    initialPageParam: "own:0",
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: Boolean(open && companyId && canSearch && !pendingSearch),
    staleTime: 60_000,
  });
  const { fetchNextPage, hasNextPage, isFetching, isError } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching && !isError && canSearch && !pendingSearch) fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetching, isError, canSearch, pendingSearch]);
  const materials = pendingSearch ? [] : [...new Map(
    (query.data?.pages ?? []).flatMap(rowsForPage).map((material) => [material.id, material]),
  ).values()];
  const statusLabel = isError
    ? "SFG search failed. Please retry."
    : needsMoreCharacters
      ? `Type at least ${MINIMUM_SEARCH_LENGTH} characters to search SFG materials.`
      : undefined;
  return (
    <div>
      <ErpComboboxField value={value} selectedOptionLabel={labelFor(selectedMaterial)}
        onChange={(id) => onChange(id, materials.find((material) => material.id === id))}
        options={materials.map((material) => ({ value: material.id, label: labelFor(material) }))}
        disabled={!companyId} blankLabel="Select SFG"
        inputProps={{ maxLength: 100 }}
        remoteSearch onSearchChange={setSearch} onOpenChange={setOpen}
        onLoadMore={loadMore} hasMore={Boolean(hasNextPage) && canSearch && !isError}
        loading={canSearch && (pendingSearch || isFetching)}
        statusLabel={statusLabel}
      />
      {open && isError && <button type="button" className="text-xs text-red-700 underline"
        onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={() => query.isFetchNextPageError ? fetchNextPage() : query.refetch()}>Retry SFG search</button>}
    </div>
  );
}
