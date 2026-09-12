import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { listCustomers } from "../om/omApi.js";

const MINIMUM_SEARCH_LENGTH = 2;
const DEFAULT_PARTY_LIMIT = 100;
const SEARCH_RESULT_LIMIT = 50;

function customerLabel(customer) {
  if (!customer) return undefined;
  return customer.display_code || [customer.customer_code, customer.customer_name].filter(Boolean).join(" - ");
}

function foCustomerTypeFilter(value) {
  // MTEST uses the same real customer relationship as other FO types.
  return value && value !== "MTEST" ? value : undefined;
}

/**
 * Server-searched Party picker for Plan Feed. Customers mapped to the
 * selected transaction company are ranked before the caller's other
 * accessible-company customers.
 *
 * A Customer master can grow indefinitely, so a fixed first-page dropdown
 * cannot be used to resolve or replace a saved FO party.
 */
export default function PlanFeedCustomerPicker({
  companyId,
  foCustomerType,
  value,
  selectedCustomer,
  onChange,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const pendingSearch = search.trim() !== debouncedSearch;
  const canSearch = debouncedSearch.length >= MINIMUM_SEARCH_LENGTH;
  const isDefaultList = debouncedSearch.length === 0;
  const needsMoreCharacters = search.trim().length < MINIMUM_SEARCH_LENGTH;
  const customerQuery = useQuery({
    queryKey: ["plan-feed-customer-search", companyId, foCustomerTypeFilter(foCustomerType), debouncedSearch],
    queryFn: () => listCustomers({
      priority_company_id: companyId,
      fo_customer_type: foCustomerTypeFilter(foCustomerType),
      status: "ACTIVE",
      search: canSearch ? debouncedSearch : undefined,
      // Opening the picker gives a useful, bounded, priority-sorted list.
      // Every broader lookup remains server-side and requires an explicit search.
      limit: canSearch ? SEARCH_RESULT_LIMIT : DEFAULT_PARTY_LIMIT,
    }),
    enabled: Boolean(open && companyId && !pendingSearch && (isDefaultList || canSearch)),
    select: (result) => result?.data ?? [],
    staleTime: 60_000,
  });
  const customers = useMemo(
    () => pendingSearch ? [] : (customerQuery.data ?? []),
    [customerQuery.data, pendingSearch],
  );
  const selectCustomer = useCallback((customerId) => {
    onChange?.(customerId, customers.find((customer) => customer.id === customerId) ?? null);
  }, [customers, onChange]);
  const statusLabel = customerQuery.isError
    ? "Party search failed. Please retry."
    : !isDefaultList && needsMoreCharacters
      ? `Type at least ${MINIMUM_SEARCH_LENGTH} characters to search parties.`
      : isDefaultList && !customerQuery.isFetching
        ? `This company's parties appear first. Type a name or code to search all accessible parties.`
      : undefined;

  return (
    <ErpComboboxField
      value={value}
      onChange={selectCustomer}
      options={customers.map((customer) => ({ value: customer.id, label: customerLabel(customer) }))}
      selectedOptionLabel={customerLabel(selectedCustomer)}
      placeholder="-- Select party --"
      blankLabel="Select party"
      disabled={disabled || !companyId}
      remoteSearch
      onSearchChange={setSearch}
      onOpenChange={setOpen}
      loading={pendingSearch || customerQuery.isFetching}
      statusLabel={statusLabel}
      inputProps={{ maxLength: 100 }}
    />
  );
}
