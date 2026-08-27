/*
 * File-ID: 15.11
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerListPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the customer master list with filters and pagination.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { useMenu } from "../../../../context/useMenu.js";
import { listCustomers } from "../omApi.js";
import CustomerEditForm from "./CustomerEditForm.jsx";

const LIMIT = 50;

export default function CustomerListPage() {
  const { runtimeContext } = useMenu();
  const companies = runtimeContext?.availableCompanies ?? [];
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  // §129.8 — cellNavigate + virtualize + Enter->center DrawerBase, matching
  // AC01Page.jsx's own pattern (feasibility doc Section 129.8).
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDrawer(row) {
    setSelectedCustomerId(row.id);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setSelectedCustomerId("");
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const customerParams = useMemo(
    () => ({
      company_id: companyId || undefined,
      customer_type: customerType || undefined,
      status: status || undefined,
      search: debouncedSearch || undefined,
      limit: LIMIT,
      offset: (page - 1) * LIMIT,
    }),
    [companyId, customerType, debouncedSearch, page, status]
  );
  const customerQuery = useQuery({
    queryKey: ["om", "customer-list", customerParams],
    queryFn: () => listCustomers(customerParams),
  });
  const rows = Array.isArray(customerQuery.data?.data) ? customerQuery.data.data : [];
  const total = Number(customerQuery.data?.total ?? 0);
  const loading = customerQuery.isLoading;

  useEffect(() => {
    setError(customerQuery.error?.message || "");
  }, [customerQuery.error]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / LIMIT)), [total]);
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);

  return (
    <>
    <ErpMasterListTemplate
      eyebrow="Operation Management"
      title="Customer Master"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void customerQuery.refetch(),
        },
        { key: "create", label: "Create Customer", tone: "primary", onClick: () => openScreen(OPERATION_SCREENS.OM_CUSTOMER_CREATE.screen_code) },
        {
          key: "vdc-master",
          label: "Parent Company / VDC",
          tone: "neutral",
          onClick: () => openScreen(OPERATION_SCREENS.OM_VDC_PARENT_COMPANY_MASTER.screen_code),
        },
        {
          key: "vdc-mapping",
          label: "Map Address → VDC",
          tone: "neutral",
          onClick: () => openScreen(OPERATION_SCREENS.OM_CUSTOMER_ADDRESS_VDC_MAPPING.screen_code),
        },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Customer lookup",
        children: (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_180px_180px_180px]">
            <QuickFilterInput
              label="Customer Search"
              value={search}
              onChange={setSearch}
              primaryFocus
              placeholder="Search customer code or customer name"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Company
              <select
                value={companyId}
                onChange={(event) => {
                  setCompanyId(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {companies.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.company_code}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Customer Type
              <select
                value={customerType}
                onChange={(event) => {
                  setCustomerType(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                <option value="DOMESTIC">DOMESTIC</option>
                <option value="EXPORT">EXPORT</option>
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "BLOCKED"].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "Customer Register",
        title: loading ? "Loading customers" : `${total} customer row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={page}
              setPage={setPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={total}
            />
            <ErpDenseGrid
              columns={[
                { key: "customer_code", label: "Customer Code", render: (row) => row.customer_code || "-" },
                // §132.7 list column spec — Party Name, Address, Category,
                // VDC/DC, Parent Company, GST Number, Created From (Company).
                // Blank data stays blank (no fake placeholder) — fills in
                // once that field is actually entered/mapped later.
                { key: "customer_name", label: "Party Name", render: (row) => row.customer_name || "-" },
                { key: "site_name", label: "Address", render: (row) => row.site_name || "" },
                {
                  key: "is_dependent",
                  label: "Category",
                  render: (row) => (row.is_dependent ? "Dependent" : "Independent"),
                },
                { key: "vdc_code", label: "VDC/DC", render: (row) => row.vdc_code || "" },
                { key: "vdc_parent_company_name", label: "Parent Company", render: (row) => row.vdc_parent_company_name || "" },
                { key: "gst_number", label: "GST Number", render: (row) => row.gst_number || "" },
                { key: "origin_company_code", label: "Created From", render: (row) => row.origin_company_code || "" },
                { key: "status", label: "Status" },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              onRowActivate={openDrawer}
              cellNavigate
              virtualize
              getRowProps={(row) => ({
                onDoubleClick: () => openDrawer(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading customers..." : "No customer matched the current filter."}
            />
          </div>
        ),
      }}
    />
      <DrawerBase
        visible={drawerOpen}
        title="Edit Customer"
        onClose={closeDrawer}
        side="center"
        width="min(720px, calc(100vw - 24px))"
      >
        {selectedCustomerId ? (
          <div className="grid gap-3">
            <CustomerEditForm
              customerId={selectedCustomerId}
              submitLabel="Save"
              onCancel={closeDrawer}
              onSaved={closeDrawer}
            />
            <button
              type="button"
              onClick={() => {
                const id = selectedCustomerId;
                closeDrawer();
                openScreen(OPERATION_SCREENS.OM_CUSTOMER_DETAIL.screen_code, { context: { id } });
              }}
              className="w-fit text-xs font-semibold text-sky-700 underline"
            >
              Open full detail (Lifecycle, Company Mapping) →
            </button>
          </div>
        ) : null}
      </DrawerBase>
    </>
  );
}
