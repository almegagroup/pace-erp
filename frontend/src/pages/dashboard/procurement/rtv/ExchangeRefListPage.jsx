/*
 * File-ID: 21.3
 * File-Path: frontend/src/pages/dashboard/procurement/rtv/ExchangeRefListPage.jsx
 * Gate: 21
 * Phase: 21
 * Domain: PROCUREMENT
 * Purpose: Track exchange references and link replacement GRNs
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { linkReplacementGRN, listExchangeRefs } from "../procurementApi.js";
import { useVendorOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";

const LIMIT = 50;

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "REPLACEMENT_RECEIVED":
      return "bg-emerald-100 text-emerald-800";
    case "RETURN_DISPATCHED":
    default:
      return "bg-sky-100 text-sky-800";
  }
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

export default function ExchangeRefListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [linkingRowId, setLinkingRowId] = useState("");
  const [replacementGrnId, setReplacementGrnId] = useState("");
  const companyId = runtimeContext?.selectedCompanyId || "";
  const vendorQuery = useVendorOptionsQuery({ limit: 200, offset: 0 });
  const exchangeRefParams = useMemo(
    () => ({
      company_id: companyId || undefined,
      status: status || undefined,
      limit: 200,
    }),
    [companyId, status]
  );
  const exchangeRefQuery = useQuery({
    queryKey: ["procurement", "exchange-refs", exchangeRefParams],
    queryFn: () => listExchangeRefs(exchangeRefParams),
  });
  const rows = Array.isArray(exchangeRefQuery.data?.items)
    ? exchangeRefQuery.data.items
    : [];
  const vendors = vendorQuery.vendors;
  const loading = exchangeRefQuery.isLoading || vendorQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void Promise.all([exchangeRefQuery.refetch(), vendorQuery.refetch()]),
    },
  });

  useEffect(() => {
    setPage(1);
  }, [search, status]);

  useEffect(() => {
    const nextError =
      exchangeRefQuery.error?.message ||
      vendorQuery.error?.message ||
      "";
    setError(nextError);
  }, [exchangeRefQuery.error, vendorQuery.error]);

  const vendorMap = useMemo(
    () => new Map(vendors.map((entry) => [entry.id, entry])),
    [vendors]
  );

  const filteredRows = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) {
      return rows;
    }
    return rows.filter((row) => {
      const vendor = vendorMap.get(row.vendor_id);
      const haystack = [
        row.exchange_ref_number,
        row.rtv_id,
        row.replacement_grn_id,
        vendor?.vendor_name,
        vendor?.vendor_code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, search, vendorMap]);

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice(
    (safePage - 1) * LIMIT,
    safePage * LIMIT
  );
  const startIndex = total === 0 ? 0 : (safePage - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(safePage * LIMIT, total);

  function openRtv(row) {
    if (!row?.rtv_id) {
      return;
    }
    openScreen(OPERATION_SCREENS.PROC_RTV_DETAIL.screen_code);
    navigate(`/dashboard/procurement/rtvs/${encodeURIComponent(row.rtv_id)}`);
  }

  async function handleLinkReplacement(row) {
    if (!replacementGrnId.trim()) {
      setError("Replacement GRN ID is required.");
      return;
    }
    setSavingId(row.id);
    setError("");
    setNotice("");
    try {
      await linkReplacementGRN(row.id, {
        replacement_grn_id: replacementGrnId.trim(),
      });
      setNotice("Replacement GRN linked successfully.");
      setLinkingRowId("");
      setReplacementGrnId("");
      await Promise.all([exchangeRefQuery.refetch(), vendorQuery.refetch()]);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "PROCUREMENT_EXCHANGE_REF_LINK_FAILED"
      );
    } finally {
      setSavingId("");
    }
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Exchange References"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () =>
            void Promise.all([exchangeRefQuery.refetch(), vendorQuery.refetch()]),
        },
      ]}
      notices={[
        ...(error
          ? [{ key: "exchange-ref-error", tone: "error", message: error }]
          : []),
        ...(notice
          ? [{ key: "exchange-ref-notice", tone: "success", message: notice }]
          : []),
      ]}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Replacement reference register",
        children: (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_220px]">
            <QuickFilterInput
              label="Search"
              value={search}
              onChange={setSearch}
              primaryFocus
              placeholder="Search exchange ref, RTV, replacement GRN or vendor"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {["RETURN_DISPATCHED", "REPLACEMENT_RECEIVED"].map((entry) => (
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
        eyebrow: "Exchange Register",
        title: loading
          ? "Loading exchange references"
          : `${total} exchange reference row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={safePage}
              setPage={setPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={total}
            />
            <ErpDenseGrid
              columns={[
                {
                  key: "exchange_ref_number",
                  label: "Ref Number",
                  width: "160px",
                },
                {
                  key: "vendor_name",
                  label: "Vendor",
                  render: (row) =>
                    vendorMap.get(row.vendor_id)?.vendor_name ||
                    vendorMap.get(row.vendor_id)?.vendor_code ||
                    row.vendor_id ||
                    "—",
                },
                { key: "rtv_id", label: "Linked RTV", width: "170px" },
                {
                  key: "replacement_grn_id",
                  label: "Replacement GRN",
                  width: "170px",
                  render: (row) => row.replacement_grn_id || "—",
                },
                {
                  key: "status",
                  label: "Status",
                  width: "180px",
                  render: (row) => (
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${statusTone(
                        row.status
                      )}`}
                    >
                      {row.status || "—"}
                    </span>
                  ),
                },
                { key: "created_at", label: "Created", width: "180px" },
                {
                  key: "action",
                  label: "Action",
                  width: "260px",
                  render: (row) =>
                    String(row.status || "").toUpperCase() === "RETURN_DISPATCHED" ? (
                      linkingRowId === row.id ? (
                        <div
                          className="flex items-center gap-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            value={replacementGrnId}
                            onChange={(event) =>
                              setReplacementGrnId(event.target.value)
                            }
                            placeholder="Replacement GRN ID"
                            className="h-8 min-w-0 flex-1 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                          <button
                            type="button"
                            onClick={() => void handleLinkReplacement(row)}
                            disabled={savingId === row.id}
                            className="border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-900 disabled:opacity-50"
                          >
                            {savingId === row.id ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setLinkingRowId("");
                              setReplacementGrnId("");
                            }}
                            className="border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setLinkingRowId(row.id);
                            setReplacementGrnId(row.replacement_grn_id || "");
                          }}
                          className="border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-900"
                        >
                          Link Replacement GRN
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-slate-500">Linked</span>
                    ),
                },
              ]}
              rows={pageRows}
              rowKey={(row) => row.id}
              onRowClick={openRtv}
              emptyMessage={
                loading ? "Loading exchange references..." : "No exchange references found."
              }
            />
          </div>
        ),
      }}
    />
  );
}
