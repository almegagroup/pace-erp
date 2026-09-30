/*
 * File-ID: 27.5-PRIORITIZE
 * File-Path: frontend/src/pages/dashboard/production/PlanFeedPrioritizePage.jsx
 * Purpose: Plan Feed "Prioritize" -- set dispatch Priority Date / Priority
 *          Number on MTO/HPS FOs that are not yet fully mapped to
 *          production. A (Priority Date, Priority Number) pair must be
 *          unique per company; Priority Date must fall within [today-5,
 *          today+5]. Once an FO becomes FULLY_MAPPED it drops off this
 *          page's list (its last-saved Priority Date/Number stay visible as
 *          history on the Total Table, only the priority row-coloring stops
 *          applying there).
 * Rendered as a tab on PlanFeedPage.jsx, NOT a separate route -- a route-only
 * companion here hits this app's screen-stack sync (NavigationStackBridge/
 * ProtectedBranchShell), which corrects the URL back to Plan Feed's own
 * registered route right after navigate(), bouncing the user back (same bug
 * class PO11/AC06's "Execute Full Report" hit first -- see
 * SlocCostingGroupPage.jsx's own comment on this). Same-page tab state is the
 * only mechanism proven to survive that sync in this codebase.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { pushToast } from "../../../store/uiToast.js";
import { listPlanFeedPrioritize, savePlanFeedPriority } from "./prodApi.js";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const errorMessage = (error) => error?.backendMessage || error?.message || "Request failed.";

export default function PlanFeedPrioritizeSection() {
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState({}); // { [foId]: { priority_date, priority_number } }
  const [saving, setSaving] = useState(false);

  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const minDate = todayIso() ? addDaysIso(todayIso(), -5) : "";
  const maxDate = addDaysIso(todayIso(), 5);

  const listQ = useQuery({
    queryKey: ["plan-feed-prioritize", effectiveCompanyId],
    queryFn: () => listPlanFeedPrioritize({ company_id: effectiveCompanyId }),
    select: (data) => (Array.isArray(data) ? data : []),
    enabled: Boolean(effectiveCompanyId),
  });

  const rows = useMemo(() => {
    const list = listQ.data ?? [];
    const term = search.trim().toLowerCase();
    const filtered = term
      ? list.filter((row) => [
          row.order_serial_number, row.fo_number, row.site_name, row.town, row.sku, row.description,
        ].some((v) => String(v ?? "").toLowerCase().includes(term)))
      : list;
    return filtered.map((row) => {
      const edit = edits[row.id];
      return edit ? { ...row, ...edit, __dirty: true } : { ...row, __dirty: false };
    });
  }, [listQ.data, search, edits]);

  function updateEdit(foId, patch) {
    setEdits((current) => {
      const base = current[foId] ?? {};
      const row = (listQ.data ?? []).find((r) => r.id === foId);
      return {
        ...current,
        [foId]: {
          priority_date: base.priority_date ?? row?.priority_date ?? null,
          priority_number: base.priority_number ?? row?.priority_number ?? null,
          ...patch,
        },
      };
    });
  }

  function handleCancel() {
    setEdits({});
  }

  async function handleSave() {
    const entries = Object.entries(edits).map(([id, value]) => ({
      id,
      priority_date: value.priority_date || null,
      priority_number: value.priority_number === "" || value.priority_number === null || value.priority_number === undefined
        ? null
        : Number(value.priority_number),
    }));
    if (entries.length === 0) {
      pushToast({ type: "info", message: "No changes to save." });
      return;
    }
    for (const entry of entries) {
      const hasDate = Boolean(entry.priority_date);
      const hasNumber = entry.priority_number !== null;
      if (hasDate !== hasNumber) {
        pushToast({ type: "error", message: "Set both Priority Date and Priority Number together, or clear both." });
        return;
      }
      if (hasDate && (entry.priority_date < minDate || entry.priority_date > maxDate)) {
        pushToast({ type: "error", message: `Priority Date must be between ${minDate} and ${maxDate}.` });
        return;
      }
    }
    const seen = new Map();
    for (const entry of entries) {
      if (!entry.priority_date || entry.priority_number === null) continue;
      const key = `${entry.priority_date}|${entry.priority_number}`;
      if (seen.has(key)) {
        pushToast({ type: "error", message: `Priority Number ${entry.priority_number} is used twice for ${entry.priority_date}.` });
        return;
      }
      seen.set(key, entry.id);
    }
    setSaving(true);
    try {
      await savePlanFeedPriority({ company_id: effectiveCompanyId, entries });
      pushToast({ type: "success", message: "Priority saved." });
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ["plan-feed-prioritize", effectiveCompanyId] });
      queryClient.invalidateQueries({ queryKey: ["plan-feed-summary"] });
    } catch (error) {
      pushToast({ type: "error", message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: "order_serial_number", label: "Order Sl#", width: "90px" },
    { key: "fo_number", label: "FO #", width: "110px" },
    { key: "site_name", label: "Site Name", width: "170px", render: (r) => r.site_name || "—" },
    { key: "town", label: "Town", width: "110px", render: (r) => r.town || "—" },
    { key: "sku", label: "SKU", width: "110px" },
    { key: "description", label: "Description", width: "180px" },
    { key: "pack_qty", label: "Order Qty (Pack)", width: "110px", render: (r) => r.pack_qty ?? "—" },
    { key: "ordered_qty_kg", label: "Order Qty (KG)", width: "110px", render: (r) => Number(r.ordered_qty_kg ?? 0).toFixed(2) },
    { key: "scheduled_delivery_date", label: "Sched. Delivery", width: "115px", render: (r) => r.scheduled_delivery_date || "—" },
    {
      key: "production_dates", label: "Production Date", width: "150px",
      render: (r) => (r.production_dates ?? []).length ? r.production_dates.join(", ") : "—",
    },
    {
      key: "priority_date", label: "Priority Date", width: "150px",
      render: (r) => (
        <input
          type="date"
          value={r.priority_date ?? ""}
          min={minDate}
          max={maxDate}
          onChange={(event) => updateEdit(r.id, { priority_date: event.target.value || null })}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
        />
      ),
    },
    {
      key: "priority_number", label: "Priority #", width: "100px",
      render: (r) => (
        <input
          type="number"
          min="1"
          step="1"
          value={r.priority_number ?? ""}
          onChange={(event) => updateEdit(r.id, { priority_number: event.target.value === "" ? null : Number(event.target.value) })}
          className="h-8 w-full border border-slate-300 bg-white px-2 font-mono text-xs text-slate-900 outline-none focus:border-sky-500"
        />
      ),
    },
    {
      key: "clear_priority", label: "", width: "70px",
      render: (r) => (
        (r.priority_date || r.priority_number) ? (
          <button
            type="button"
            onClick={() => updateEdit(r.id, { priority_date: null, priority_number: null })}
            className="h-8 w-full border border-slate-300 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-50"
          >
            Clear
          </button>
        ) : null
      ),
    },
  ];

  const dirtyCount = Object.keys(edits).length;

  return (
    <>
      <ErpSectionCard title="Filters">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" hint="" />
          <label className="text-xs text-slate-500">
            Search
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search FO #, Site, Town, SKU, Description..."
              className="mt-1 h-9 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Priority Date must be within {minDate} to {maxDate}.</p>
      </ErpSectionCard>
      <ErpSectionCard title={`FOs (${rows.length})`}>
        {!effectiveCompanyId ? (
          <p className="text-sm text-slate-400 py-4 text-center">Select a company to view FOs.</p>
        ) : listQ.isFetching ? (
          <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
        ) : (
          <ErpDenseGrid
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            cellNavigate
            fitColumnWidths
            stickyFirstColumn
            maxHeight="calc(100vh - 420px)"
            emptyMessage="No eligible FOs — everything is either fully mapped or MTS/MTEST."
          />
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-slate-400">{dirtyCount > 0 ? `${dirtyCount} row(s) changed` : ""}</span>
          <button type="button" disabled={saving || dirtyCount === 0} onClick={handleCancel} className="h-9 border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
          <button type="button" disabled={saving || dirtyCount === 0} onClick={handleSave} className="h-9 bg-sky-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </ErpSectionCard>
    </>
  );
}
