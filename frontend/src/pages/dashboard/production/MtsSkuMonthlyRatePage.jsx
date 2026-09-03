import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import {
  approveMtsSkuRate,
  listMtsSkuRates,
  listPendingMtsSkuRateDrafts,
  saveMtsSkuRateDraft,
} from "./prodApi.js";

const TABS = [
  { key: "entry", label: "Rate Entry" },
  { key: "approve", label: "Approve" },
];

const ERROR_MESSAGES = {
  PROD_MTS_RATE_COMPANY_REQUIRED: "Company is required.",
  PROD_MTS_RATE_MONTH_INVALID: "Month must be valid.",
  PROD_MTS_RATE_DRAFT_INVALID: "Company, month, and at least one valid line are required.",
  PROD_MTS_RATE_MONTH_APPROVED: "This month is already approved and cannot be changed.",
  PROD_MTS_RATE_APPROVE_INCOMPLETE: "Every MTS SKU must have rate and dispatch UOM before approval.",
  PROD_MTS_RATE_SCOPE_EMPTY: "No MTS SKU is ready for this company yet.",
  PROD_MTS_RATE_DISPATCH_UOM_INVALID: "Selected dispatch UOM cannot resolve to per-KG rate.",
};

function friendlyError(error) {
  if (!error) return "";
  return ERROR_MESSAGES[error.code] ?? error.message ?? "Request failed.";
}

function currentFiscalMonthValue() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function fiscalMonthOptions(anchorMonth) {
  const [yearPart, monthPart] = String(anchorMonth || currentFiscalMonthValue()).split("-");
  const anchorYear = Number(yearPart);
  const anchorMonthNumber = Number(monthPart);
  const fiscalStartYear = Number.isFinite(anchorYear) && Number.isFinite(anchorMonthNumber) && anchorMonthNumber >= 4
    ? anchorYear
    : anchorYear - 1;
  const options = [];
  for (let offset = -1; offset <= 1; offset += 1) {
    const startYear = fiscalStartYear + offset;
    for (let month = 4; month <= 15; month += 1) {
      const calendarMonth = month > 12 ? month - 12 : month;
      const calendarYear = month > 12 ? startYear + 1 : startYear;
      const value = `${calendarYear}-${String(calendarMonth).padStart(2, "0")}`;
      const labelDate = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1));
      const label = labelDate.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
      options.push({ value, label, fy: `FY ${startYear}-${String(startYear + 1).slice(-2)}` });
    }
  }
  return options;
}

// Business owner ask (2026-09-03) — same pattern as every other report grid
// this sweep touched.
function getColumnFilterText(column, row) {
  if (typeof column.copyValue === "function") return String(column.copyValue(row) ?? "");
  const raw = row?.[column.key];
  return raw == null ? "" : String(raw);
}

function pageSlice(rows, page, pageSize) {
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  return {
    page: safePage,
    totalItems,
    totalPages,
    startIndex: totalItems === 0 ? 0 : start + 1,
    endIndex: Math.min(end, totalItems),
    rows: rows.slice(start, end),
  };
}

function MonthSelect({ value, onChange, inputRef, disabled = false }) {
  const options = fiscalMonthOptions(value);
  const currentFy = options.find((option) => option.value === value)?.fy;
  return (
    <label className="grid gap-1 text-xs font-semibold text-slate-700">
      Month
      <select
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} ({option.fy})
          </option>
        ))}
      </select>
      <span className="text-[11px] font-normal text-slate-500">{currentFy ?? "Fiscal months start from April."}</span>
    </label>
  );
}

export default function MtsSkuMonthlyRatePage() {
  const { runtimeContext } = useMenu();
  const qc = useQueryClient();
  const monthInputRef = useRef(null);
  const [tab, setTab] = useState("entry");
  const [companyId, setCompanyId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(currentFiscalMonthValue());
  const [approvalMonth, setApprovalMonth] = useState("");
  const [draftRows, setDraftRows] = useState({});
  const [page, setPage] = useState(1);
  const [draftPage, setDraftPage] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!companyId) {
      const defaultCompany = String(runtimeContext?.selectedCompanyId ?? "").trim();
      if (defaultCompany) setCompanyId(defaultCompany);
    }
  }, [companyId, runtimeContext]);

  useEffect(() => {
    setPage(1);
  }, [companyId, selectedMonth, tab]);

  function toast(msg, tone = "success") {
    pushToast({ message: msg, tone });
  }

  const activeMonth = tab === "approve" && approvalMonth ? approvalMonth : selectedMonth;

  const entryQuery = useQuery({
    queryKey: ["mts-sku-rates", companyId, activeMonth],
    queryFn: () => listMtsSkuRates({ company_id: companyId, rate_month: `${activeMonth}-01` }),
    enabled: Boolean(companyId && activeMonth),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const pendingDraftsQuery = useQuery({
    queryKey: ["mts-sku-rate-pending-drafts", companyId],
    queryFn: () => listPendingMtsSkuRateDrafts({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  useEffect(() => {
    const rows = entryQuery.data ?? [];
    if (rows.length === 0) return;
    setDraftRows((current) => {
      const next = { ...current };
      let changed = false;
      for (const row of rows) {
        if (next[row.material_id]) continue;
        next[row.material_id] = {
          rate: row.rate ?? "",
          dispatch_uom_code: row.dispatch_uom_code ?? row.dispatch_uom_options?.[0]?.uom_code ?? "",
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [entryQuery.data]);

  const mergedRows = useMemo(() => (
    (entryQuery.data ?? []).map((row) => {
      const draft = draftRows[row.material_id] ?? {};
      const selectedUom = String(draft.dispatch_uom_code ?? row.dispatch_uom_code ?? row.dispatch_uom_options?.[0]?.uom_code ?? "");
      const option = (row.dispatch_uom_options ?? []).find((entry) => entry.uom_code === selectedUom) ?? null;
      const enteredRate = draft.rate ?? row.rate ?? "";
      const numericRate = enteredRate === "" ? null : Number(enteredRate);
      const ratePerKg = option && numericRate !== null && Number.isFinite(numericRate) && option.factor_to_kg > 0
        ? Number((numericRate / Number(option.factor_to_kg)).toFixed(6))
        : row.rate_per_kg ?? null;
      return {
        ...row,
        display_label: `${row.pace_code} - ${row.material_name}`,
        draft_rate: enteredRate,
        draft_dispatch_uom_code: selectedUom,
        draft_rate_per_kg: ratePerKg,
      };
    })
  ), [draftRows, entryQuery.data]);

  const pendingDraftPageData = pageSlice(pendingDraftsQuery.data ?? [], draftPage, 10);

  function updateDraft(materialId, patch) {
    setDraftRows((current) => ({
      ...current,
      [materialId]: {
        ...(current[materialId] ?? {}),
        ...patch,
      },
    }));
  }

  async function handleSave() {
    if (!companyId) {
      toast("Select company first.", "error");
      return;
    }
    const lines = mergedRows
      .map((row) => ({
        material_id: row.material_id,
        dispatch_uom_code: row.draft_dispatch_uom_code,
        rate: row.draft_rate === "" ? null : Number(row.draft_rate),
      }))
      .filter((row) => row.dispatch_uom_code && row.rate != null && Number.isFinite(row.rate) && row.rate >= 0);
    if (lines.length === 0) {
      toast("Enter at least one valid rate with dispatch UOM.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const result = await saveMtsSkuRateDraft({
        company_id: companyId,
        rate_month: `${selectedMonth}-01`,
        lines,
      });
      toast(result?.status === "APPROVED" ? "Rates saved and activated." : "Draft saved. Approval is still required.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["mts-sku-rates"] }),
        qc.invalidateQueries({ queryKey: ["mts-sku-rate-pending-drafts"] }),
      ]);
    } catch (error) {
      toast(friendlyError(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove() {
    const targetMonth = approvalMonth || selectedMonth;
    if (!companyId || !targetMonth) {
      toast("Select company and month first.", "error");
      return;
    }
    setSubmitting(true);
    try {
      await approveMtsSkuRate({
        company_id: companyId,
        rate_month: `${targetMonth}-01`,
      });
      toast("Monthly rate chart approved.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["mts-sku-rates"] }),
        qc.invalidateQueries({ queryKey: ["mts-sku-rate-pending-drafts"] }),
      ]);
    } catch (error) {
      toast(friendlyError(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  function openDraftMonth(row) {
    const monthValue = String(row.rate_month ?? "").slice(0, 7);
    setApprovalMonth(monthValue);
    setSelectedMonth(monthValue);
    setTab("approve");
  }

  useErpScreenHotkeys({
    refresh: {
      disabled: !companyId,
      perform: () => {
        void qc.invalidateQueries({ queryKey: ["mts-sku-rates"] });
        void qc.invalidateQueries({ queryKey: ["mts-sku-rate-pending-drafts"] });
      },
    },
    save: {
      disabled: tab !== "entry" || submitting || !companyId,
      perform: () => { void handleSave(); },
    },
    focusPrimary: {
      disabled: false,
      perform: () => monthInputRef.current?.focus?.(),
    },
  });

  const entryColumns = [
    { key: "pace_code", label: "SKU", width: "120px" },
    { key: "material_name", label: "Description", width: "260px" },
    { key: "base_uom_code", label: "Base UOM", width: "90px" },
    {
      key: "dispatch_uom_code",
      label: "Dispatch UOM",
      width: "140px",
      render: (row) => (
        <select
          value={row.draft_dispatch_uom_code}
          onChange={(event) => updateDraft(row.material_id, { dispatch_uom_code: event.target.value })}
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
        >
          <option value="">Select</option>
          {(row.dispatch_uom_options ?? []).map((option) => (
            <option key={`${row.material_id}-${option.uom_code}`} value={option.uom_code}>
              {option.label}
            </option>
          ))}
        </select>
      ),
      copyValue: (row) => row.draft_dispatch_uom_code,
    },
    {
      key: "rate",
      label: "Rate / Dispatch UOM",
      width: "150px",
      align: "right",
      render: (row) => (
        <input
          type="number"
          min="0"
          step="0.0001"
          value={row.draft_rate}
          onChange={(event) => updateDraft(row.material_id, { rate: event.target.value })}
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-right text-xs text-slate-900 outline-none focus:border-sky-500"
        />
      ),
      copyValue: (row) => row.draft_rate,
    },
    {
      key: "rate_per_kg",
      label: "Resolved / KG",
      width: "130px",
      align: "right",
      render: (row) => row.draft_rate_per_kg == null ? <span className="text-slate-400">-</span> : Number(row.draft_rate_per_kg).toFixed(4),
    },
    {
      key: "status",
      label: "Status",
      width: "120px",
      render: (row) => row.status ? (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.status === "APPROVED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {row.status}
        </span>
      ) : <span className="text-slate-400">New</span>,
      copyValue: (row) => row.status || "New",
    },
  ];

  const [entrySearch, setEntrySearch] = useState("");
  const entrySearchOptions = useMemo(() => {
    const values = new Set();
    outer: for (const row of mergedRows) {
      for (const column of entryColumns) {
        const text = getColumnFilterText(column, row);
        if (text) values.add(text);
        if (values.size >= 500) break outer;
      }
    }
    return [...values].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedRows]);
  const hasActiveEntrySearch = entrySearch.trim().length > 0;
  const filteredMergedRows = useMemo(() => {
    const needle = entrySearch.trim().toLowerCase();
    if (!needle) return mergedRows;
    return mergedRows.filter((row) => entryColumns.some((column) => getColumnFilterText(column, row).toLowerCase().includes(needle)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedRows, entrySearch]);
  const entryPageData = pageSlice(filteredMergedRows, page, 14);

  const draftColumns = [
    { key: "rate_month", label: "Month", width: "160px" },
    {
      key: "filled",
      label: "Filled",
      width: "110px",
      render: (row) => `${row.filled_count}/${row.line_count}`,
    },
    {
      key: "open",
      label: "Open",
      width: "110px",
      render: (row) => (
        <button
          type="button"
          onClick={() => openDraftMonth(row)}
          className="border border-sky-300 bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-900"
        >
          Review
        </button>
      ),
    },
  ];

  return (
    <ErpScreenScaffold
      title="MTS SKU Monthly Rate Master"
      subtitle="AC05 - company-wise monthly rate chart with April-start fiscal month selection, dispatch UOM, and per-KG resolution."
      actions={[
        {
          label: submitting ? "Working..." : tab === "entry" ? "Save" : "Approve Month",
          tone: "primary",
          disabled: submitting || !companyId,
          onClick: () => { void (tab === "entry" ? handleSave() : handleApprove()); },
        },
      ]}
    >
      <ErpSectionCard>
        <div className="mb-4 flex gap-2 border-b border-slate-200">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === entry.key ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,320px)_220px]">
          <TransactionCompanySelector
            runtimeContext={runtimeContext}
            value={companyId}
            onChange={setCompanyId}
            label="Company"
          />
          <MonthSelect
            value={tab === "approve" && approvalMonth ? approvalMonth : selectedMonth}
            onChange={(value) => {
              if (tab === "approve") setApprovalMonth(value);
              setSelectedMonth(value);
            }}
            inputRef={monthInputRef}
          />
        </div>

        {tab === "entry" ? (
          <div className="grid gap-4">
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Only MTS SKU items for the selected company appear here. Rate is entered in Dispatch UOM and the system resolves the per-KG value before save.
            </div>
            <div className="flex items-center gap-2">
              <input
                list="mts-rate-search-options"
                value={entrySearch}
                onChange={(event) => { setEntrySearch(event.target.value); setPage(1); }}
                placeholder="Search across every column..."
                className="h-8 w-full max-w-md rounded border border-slate-300 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-sky-500"
              />
              <datalist id="mts-rate-search-options">
                {entrySearchOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
              {hasActiveEntrySearch ? (
                <>
                  <button type="button" onClick={() => setEntrySearch("")} className="h-8 rounded border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                    Clear
                  </button>
                  <span className="text-xs text-slate-500">{filteredMergedRows.length} of {mergedRows.length} SKUs</span>
                </>
              ) : null}
            </div>
            <ErpPaginationStrip
              page={entryPageData.page}
              setPage={setPage}
              totalPages={entryPageData.totalPages}
              startIndex={entryPageData.startIndex}
              endIndex={entryPageData.endIndex}
              totalItems={entryPageData.totalItems}
            />
            <ErpDenseGrid
              columns={entryColumns}
              rows={entryPageData.rows}
              rowKey={(row) => row.material_id}
              maxHeight="520px"
              emptyMessage={entryQuery.isLoading ? "Loading MTS SKU list..." : hasActiveEntrySearch ? "No rows match this search." : "No MTS SKU is configured for this company."}
            />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <div className="grid gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Pending Draft Months</div>
              <ErpPaginationStrip
                page={pendingDraftPageData.page}
                setPage={setDraftPage}
                totalPages={pendingDraftPageData.totalPages}
                startIndex={pendingDraftPageData.startIndex}
                endIndex={pendingDraftPageData.endIndex}
                totalItems={pendingDraftPageData.totalItems}
              />
              <ErpDenseGrid
                columns={draftColumns}
                rows={pendingDraftPageData.rows}
                rowKey={(row) => row.rate_month}
                onRowActivate={openDraftMonth}
                maxHeight="300px"
                emptyMessage={pendingDraftsQuery.isLoading ? "Loading draft months..." : "No approval is pending."}
              />
            </div>
            <div className="grid gap-3">
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                Approval month: <span className="font-semibold">{approvalMonth || selectedMonth || "-"}</span>
              </div>
              <ErpDenseGrid
                columns={entryColumns}
                rows={mergedRows}
                rowKey={(row) => `${row.material_id}-approve`}
                maxHeight="520px"
                emptyMessage={entryQuery.isLoading ? "Loading month details..." : "Choose a draft month to review."}
              />
            </div>
          </div>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
