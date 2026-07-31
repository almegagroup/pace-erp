import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import {
  listMtsSkuRates,
  saveMtsSkuRateDraft,
  listPendingMtsSkuRateDrafts,
  approveMtsSkuRate,
} from "./prodApi.js";

const TABS = [
  { key: "entry", label: "Rate Chart Entry" },
  { key: "approve", label: "Approve" },
];

const ERROR_MESSAGES = {
  PROD_MTS_RATE_COMPANY_REQUIRED: "Company is required.",
  PROD_MTS_RATE_MONTH_INVALID: "Month must be valid.",
  PROD_MTS_RATE_DRAFT_INVALID: "Company, month, and at least one valid rate line are required.",
  PROD_MTS_RATE_MONTH_APPROVED: "This month is already approved and cannot be changed.",
  PROD_MTS_RATE_APPROVE_INCOMPLETE: "Every MTS SKU must have a rate greater than zero before approval.",
  PROD_MTS_RATE_SCOPE_EMPTY: "No MTS-scoped SKU is configured for this company yet.",
};

function friendlyError(error) {
  if (!error) return "";
  return ERROR_MESSAGES[error.code] ?? error.message ?? "Request failed.";
}

function monthInputValue(isoDate) {
  return String(isoDate ?? "").slice(0, 7);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
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

export default function MtsSkuMonthlyRatePage() {
  const { runtimeContext } = useMenu();
  const qc = useQueryClient();
  const [tab, setTab] = useState("entry");
  const [companyId, setCompanyId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [approvalMonth, setApprovalMonth] = useState("");
  const [draftRates, setDraftRates] = useState({});
  const [page, setPage] = useState(1);
  const [draftPage, setDraftPage] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const monthInputRef = useRef(null);

  useEffect(() => {
    if (!companyId) {
      const defaultCompany = String(runtimeContext?.selectedCompanyId ?? "").trim();
      if (defaultCompany) setCompanyId(defaultCompany);
    }
  }, [companyId, runtimeContext]);

  useEffect(() => {
    setDraftRates({});
    setPage(1);
  }, [companyId, selectedMonth, tab]);

  useEffect(() => {
    setDraftPage(1);
  }, [companyId]);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    window.setTimeout(() => setNotice({ msg: "", tone: "success" }), 4000);
  }

  const entryQuery = useQuery({
    queryKey: ["mts-sku-rates", companyId, selectedMonth, tab],
    queryFn: () => listMtsSkuRates({ company_id: companyId, rate_month: `${selectedMonth}-01` }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const pendingDraftsQuery = useQuery({
    queryKey: ["mts-sku-rate-pending-drafts", companyId],
    queryFn: () => listPendingMtsSkuRateDrafts({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const mergedEntryRows = useMemo(() => (
    (entryQuery.data ?? []).map((row) => {
      const cachedRate = draftRates[row.material_id];
      return {
        ...row,
        display_label: `${row.pace_code} - ${row.material_name}`,
        draft_rate: cachedRate ?? (row.rate ?? ""),
      };
    })
  ), [draftRates, entryQuery.data]);

  const entryPageData = pageSlice(mergedEntryRows, page, 15);
  const pendingDraftPageData = pageSlice(pendingDraftsQuery.data ?? [], draftPage, 12);

  function updateDraftRate(materialId, value) {
    setDraftRates((current) => ({ ...current, [materialId]: value }));
  }

  async function handleSave() {
    if (!companyId) {
      toast("Select a company first.", "error");
      return;
    }
    const lines = mergedEntryRows
      .map((row) => ({
        material_id: row.material_id,
        rate: row.draft_rate === "" ? null : Number(row.draft_rate),
      }))
      .filter((row) => row.rate != null && Number.isFinite(row.rate) && row.rate >= 0);
    if (lines.length === 0) {
      toast("Enter at least one rate before saving.", "error");
      return;
    }
    setSubmitting(true);
    try {
      await saveMtsSkuRateDraft({
        company_id: companyId,
        rate_month: `${selectedMonth}-01`,
        lines,
      });
      toast("Draft rates saved.");
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
    setTab("approve");
    setApprovalMonth(monthInputValue(row.rate_month));
    setSelectedMonth(monthInputValue(row.rate_month));
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
    { key: "material_name", label: "Material", width: "260px" },
    { key: "base_uom_code", label: "UOM", width: "90px" },
    {
      key: "rate",
      label: "Rate",
      width: "140px",
      align: "right",
      render: (row) => (
        <input
          type="number"
          min="0"
          step="0.0001"
          value={row.draft_rate}
          onChange={(event) => updateDraftRate(row.material_id, event.target.value)}
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-right text-xs text-slate-900 outline-none focus:border-sky-500"
        />
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "120px",
      render: (row) => row.status ? (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.status === "APPROVED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {row.status}
        </span>
      ) : <span className="text-slate-400">No rate</span>,
    },
  ];

  const draftColumns = [
    { key: "rate_month", label: "Rate Month", width: "160px" },
    {
      key: "filled",
      label: "Filled",
      width: "140px",
      render: (row) => `${row.filled_count}/${row.line_count}`,
    },
    {
      key: "open",
      label: "Open",
      width: "120px",
      render: (row) => (
        <button
          type="button"
          onClick={() => openDraftMonth(row)}
          className="border border-sky-300 bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-900"
        >
          Open
        </button>
      ),
    },
  ];

  return (
    <ErpScreenScaffold
      title="MTS SKU Monthly Rate Master"
      subtitle="AC05 — company-scoped MTS FG SKU monthly sale rate chart with separate Draft save and Approve."
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
      actions={[
        {
          label: submitting ? "Working..." : tab === "entry" ? "Save Draft" : "Approve Month",
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
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === entry.key ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,320px)_180px]">
          <TransactionCompanySelector
            runtimeContext={runtimeContext}
            value={companyId}
            onChange={setCompanyId}
            label="Company"
          />
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            {tab === "approve" ? "Selected Month" : "Rate Month"}
            <input
              ref={monthInputRef}
              type="month"
              value={tab === "approve" && approvalMonth ? approvalMonth : selectedMonth}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (tab === "approve") setApprovalMonth(nextValue);
                setSelectedMonth(nextValue);
              }}
              className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </label>
        </div>

        {tab === "entry" ? (
          <>
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
              maxHeight="480px"
              emptyMessage={entryQuery.isLoading ? "Loading MTS SKU list..." : "No MTS-scoped SKU found for this company."}
            />
          </>
        ) : (
          <div className="grid gap-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Pending Draft Months</div>
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
                maxHeight="280px"
                emptyMessage={pendingDraftsQuery.isLoading ? "Loading pending drafts..." : "No draft month is pending approval."}
              />
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Approval Grid — {approvalMonth || selectedMonth || "Select a month"}
              </div>
              <ErpDenseGrid
                columns={entryColumns}
                rows={entryPageData.rows}
                rowKey={(row) => `${row.material_id}-approve`}
                maxHeight="420px"
                emptyMessage={entryQuery.isLoading ? "Loading month details..." : "Open a draft month to review and approve."}
              />
            </div>
          </div>
        )}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
