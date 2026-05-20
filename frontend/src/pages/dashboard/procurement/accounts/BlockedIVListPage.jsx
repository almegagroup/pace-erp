/*
 * File-ID: 21.4
 * File-Path: frontend/src/pages/dashboard/procurement/accounts/BlockedIVListPage.jsx
 * Gate: 21
 * Phase: 21
 * Domain: PROCUREMENT
 * Purpose: Show blocked invoice verifications for review
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listVendors } from "../../om/omApi.js";
import { listBlockedIVs } from "../procurementApi.js";

const LIMIT = 50;

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function formatNumber(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "0.0000";
  }
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export default function BlockedIVListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const companyId = runtimeContext?.selectedCompanyId || "";

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [data, vendorData] = await Promise.all([
          listBlockedIVs({
            company_id: companyId || undefined,
            limit: 200,
          }),
          listVendors({ limit: 200, offset: 0 }),
        ]);
        if (!active) {
          return;
        }
        setRows(Array.isArray(data?.items) ? data.items : []);
        setVendors(Array.isArray(vendorData?.data) ? vendorData.data : []);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setRows([]);
        setVendors([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "PROCUREMENT_BLOCKED_IV_LIST_FAILED"
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [companyId, refreshToken]);

  useEffect(() => {
    setPage(1);
  }, [search]);

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
        row.iv_number,
        row.invoice_number,
        row.vendor_invoice_number,
        row.block_reason,
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

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_IV_DETAIL.screen_code);
    navigate(
      `/dashboard/procurement/accounts/invoice-verifications/${encodeURIComponent(
        row.id
      )}`
    );
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement Accounts"
      title="Blocked Invoice Verifications"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => setRefreshToken((value) => value + 1),
        },
      ]}
      notices={[
        ...(error
          ? [{ key: "blocked-iv-error", tone: "error", message: error }]
          : []),
        {
          key: "blocked-iv-badge",
          tone: "warning",
          message: "Showing BLOCKED invoice verification rows only.",
        },
      ]}
      filterSection={{
        eyebrow: "Search",
        title: "Blocked IV review queue",
        children: (
          <QuickFilterInput
            label="Search"
            value={search}
            onChange={setSearch}
            primaryFocus
            placeholder="Search IV number, invoice number, vendor or block reason"
          />
        ),
      }}
      listSection={{
        eyebrow: "Blocked IV Register",
        title: loading
          ? "Loading blocked invoice verifications"
          : `${total} blocked IV row${total === 1 ? "" : "s"}`,
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
                { key: "iv_number", label: "IV Number", width: "150px" },
                {
                  key: "invoice_number",
                  label: "Invoice No",
                  width: "160px",
                  render: (row) =>
                    row.invoice_number || row.vendor_invoice_number || "—",
                },
                { key: "invoice_date", label: "Invoice Date", width: "130px" },
                {
                  key: "vendor_name",
                  label: "Vendor",
                  render: (row) =>
                    vendorMap.get(row.vendor_id)?.vendor_name ||
                    vendorMap.get(row.vendor_id)?.vendor_code ||
                    row.vendor_id ||
                    "—",
                },
                {
                  key: "invoice_value",
                  label: "Invoice Value",
                  width: "140px",
                  align: "right",
                  render: (row) => formatNumber(row.invoice_value),
                },
                {
                  key: "matched_value",
                  label: "Matched Value",
                  width: "140px",
                  align: "right",
                  render: (row) => formatNumber(row.matched_value),
                },
                { key: "block_reason", label: "Block Reason", width: "220px" },
                { key: "created_at", label: "Created", width: "180px" },
              ]}
              rows={pageRows}
              rowKey={(row) => row.id}
              onRowClick={openDetail}
              emptyMessage={
                loading ? "Loading blocked invoice verifications..." : "No blocked invoice verifications found."
              }
            />
          </div>
        ),
      }}
    />
  );
}
