import { useEffect, useMemo, useState } from "react";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { listStorageLocations } from "../../om/omApi.js";
import {
  closeProcurementPlanningMonth,
  createProcurementPlanningItemGroup,
  createProcurementPlanningSlocGroup,
  deleteProcurementPlanningItemGroup,
  deleteProcurementPlanningSlocGroup,
  getProcurementPlanning,
  getProcurementPlanningHistory,
  saveProcurementPlanningLines,
  updateProcurementPlanningItemGroup,
  updateProcurementPlanningSlocGroup,
} from "../procurementApi.js";

function formatQty(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0.000";
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function getMonthValue(raw) {
  const value = String(raw || "").trim();
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7);
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getStatusToneClass(tone) {
  if (tone === "CRITICAL") return "bg-rose-50 text-rose-800";
  if (tone === "WARNING") return "bg-amber-50 text-amber-800";
  return "";
}

function getInitialDraft(row) {
  return {
    material_id: row.material_id,
    monthly_requirement_qty: String(row.monthly_requirement_qty ?? 0),
    safety_days: String(row.safety_days ?? 0),
    processing_time_days: String(row.processing_time_days ?? 0),
    lead_time_days: String(row.lead_time_days ?? 0),
    fixed_safety_stock_qty:
      row.fixed_safety_stock_qty == null ? "" : String(row.fixed_safety_stock_qty),
    fixed_replenishment_stock_qty:
      row.fixed_replenishment_stock_qty == null
        ? ""
        : String(row.fixed_replenishment_stock_qty),
    planning_item_group_id: row.planning_item_group_id || "",
    excluded_from_dashboard: Boolean(row.excluded_from_dashboard),
    display_order: row.display_order ?? 0,
  };
}

function getDaysInMonth(monthValue) {
  const [year, month] = String(monthValue || "").split("-").map(Number);
  if (!year || !month) return 30;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function computeDashboardBlocks(rows, monthValue) {
  const visibleRows = rows.filter((row) => !row.excluded_from_dashboard);
  const grouped = new Map();
  const standalone = [];
  for (const row of visibleRows) {
    if (row.planning_item_group_name) {
      const bucket = grouped.get(row.planning_item_group_name) || [];
      bucket.push(row);
      grouped.set(row.planning_item_group_name, bucket);
    } else {
      standalone.push({ type: "item", row });
    }
  }

  const blocks = [];
  [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .forEach(([groupName, items]) => {
      const sortedItems = [...items].sort((left, right) => {
        const leftCode = String(left.material_code || "");
        const rightCode = String(right.material_code || "");
        return leftCode.localeCompare(rightCode);
      });
      sortedItems.forEach((row) => blocks.push({ type: "item", row, groupName }));
      const count = sortedItems.length || 1;
      const totalRequirement = sortedItems.reduce(
        (sum, row) => sum + Number(row.monthly_requirement_qty || 0),
        0
      );
      const avgSafetyDays =
        sortedItems.reduce((sum, row) => sum + Number(row.safety_days || 0), 0) / count;
      const avgProcessingDays =
        sortedItems.reduce((sum, row) => sum + Number(row.processing_time_days || 0), 0) / count;
      const avgLeadDays =
        sortedItems.reduce((sum, row) => sum + Number(row.lead_time_days || 0), 0) / count;
      const avgReplenishmentDays = avgProcessingDays + avgLeadDays;
      const daysInMonth = getDaysInMonth(monthValue);
      const dailyRequirement = daysInMonth > 0 ? totalRequirement / daysInMonth : 0;
      const derivedSafety = dailyRequirement * avgSafetyDays;
      const derivedReplenishment = derivedSafety + dailyRequirement * avgReplenishmentDays;
      const totalAvailable = sortedItems.reduce(
        (sum, row) => sum + Number(row.available_stock_qty || 0),
        0
      );
      const totalTrn = sortedItems.reduce((sum, row) => sum + Number(row.trn_stock_qty || 0), 0);
      const totalGe = sortedItems.reduce((sum, row) => sum + Number(row.ge_stock_qty || 0), 0);
      const totalQa = sortedItems.reduce((sum, row) => sum + Number(row.qa_stock_qty || 0), 0);
      const totalStock = totalAvailable + totalTrn + totalGe + totalQa;
      let tone = "NORMAL";
      if (totalStock <= derivedSafety) {
        tone = "CRITICAL";
      } else if (totalStock <= derivedReplenishment) {
        tone = "WARNING";
      }
      blocks.push({
        type: "group-total",
        groupName,
        row: {
          monthly_requirement_qty: totalRequirement,
          safety_days: avgSafetyDays,
          processing_time_days: avgProcessingDays,
          lead_time_days: avgLeadDays,
          replenishment_days: avgReplenishmentDays,
          derived_safety_stock_qty: derivedSafety,
          derived_replenishment_stock_qty: derivedReplenishment,
          effective_safety_stock_qty: derivedSafety,
          effective_replenishment_stock_qty: derivedReplenishment,
          available_stock_qty: totalAvailable,
          trn_stock_qty: totalTrn,
          ge_stock_qty: totalGe,
          qa_stock_qty: totalQa,
          total_stock_qty: totalStock,
          status_tone: tone,
          base_uom_code: sortedItems[0]?.base_uom_code || "",
        },
      });
    });

  standalone
    .sort((left, right) =>
      String(left.row.material_code || "").localeCompare(String(right.row.material_code || ""))
    )
    .forEach((entry) => blocks.push(entry));

  return blocks;
}

function DashboardTable({ rows, monthValue }) {
  const blocks = useMemo(() => computeDashboardBlocks(rows, monthValue), [rows, monthValue]);

  return (
    <div className="overflow-x-auto border border-slate-200 bg-white">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-100 text-slate-700">
          <tr>
            <th className="border px-2 py-2 text-left">Group</th>
            <th className="border px-2 py-2 text-left">Item</th>
            <th className="border px-2 py-2 text-right">Requirement</th>
            <th className="border px-2 py-2 text-right">Safety Days</th>
            <th className="border px-2 py-2 text-right">Proc Days</th>
            <th className="border px-2 py-2 text-right">Lead Days</th>
            <th className="border px-2 py-2 text-right">Safety Stock</th>
            <th className="border px-2 py-2 text-right">Replenishment</th>
            <th className="border px-2 py-2 text-right">Available</th>
            <th className="border px-2 py-2 text-right">TRN</th>
            <th className="border px-2 py-2 text-right">GE</th>
            <th className="border px-2 py-2 text-right">In QA</th>
            <th className="border px-2 py-2 text-right">Total</th>
            <th className="border px-2 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((entry, index) => {
            const isGroupTotal = entry.type === "group-total";
            const row = entry.row;
            return (
              <tr
                key={`${entry.type}-${entry.groupName || row.material_id || index}`}
                className={`${getStatusToneClass(row.status_tone)} ${isGroupTotal ? "font-semibold" : ""}`}
              >
                <td className="border px-2 py-2">
                  {entry.groupName || row.planning_item_group_name || "Standalone"}
                </td>
                <td className="border px-2 py-2">
                  {isGroupTotal ? (
                    <span>Group Total</span>
                  ) : (
                    <div className="grid gap-[2px]">
                      <span className="font-semibold text-slate-900">{row.material_code}</span>
                      <span className="text-[11px] text-slate-600">{row.material_name}</span>
                    </div>
                  )}
                </td>
                <td className="border px-2 py-2 text-right">{formatQty(row.monthly_requirement_qty)}</td>
                <td className="border px-2 py-2 text-right">{formatQty(row.safety_days)}</td>
                <td className="border px-2 py-2 text-right">{formatQty(row.processing_time_days)}</td>
                <td className="border px-2 py-2 text-right">{formatQty(row.lead_time_days)}</td>
                <td className="border px-2 py-2 text-right">{formatQty(row.effective_safety_stock_qty)}</td>
                <td className="border px-2 py-2 text-right">{formatQty(row.effective_replenishment_stock_qty)}</td>
                <td className="border px-2 py-2 text-right">{formatQty(row.available_stock_qty)}</td>
                <td className="border px-2 py-2 text-right">{formatQty(row.trn_stock_qty)}</td>
                <td className="border px-2 py-2 text-right">{formatQty(row.ge_stock_qty)}</td>
                <td className="border px-2 py-2 text-right">{formatQty(row.qa_stock_qty)}</td>
                <td className="border px-2 py-2 text-right">{formatQty(row.total_stock_qty)}</td>
                <td className="border px-2 py-2">
                  {row.status_tone === "CRITICAL"
                    ? "Critical"
                    : row.status_tone === "WARNING"
                      ? "Replenish"
                      : "Normal"}
                </td>
              </tr>
            );
          })}
          {blocks.length === 0 ? (
            <tr>
              <td className="border px-2 py-6 text-center text-slate-500" colSpan={14}>
                No planning rows available for this company/month yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function MonthlyInputTable({
  rows,
  itemGroups,
  drafts,
  onChange,
}) {
  return (
    <div className="overflow-x-auto border border-slate-200 bg-white">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-100 text-slate-700">
          <tr>
            <th className="border px-2 py-2 text-left">Material</th>
            <th className="border px-2 py-2 text-right">Requirement</th>
            <th className="border px-2 py-2 text-right">Safety Days</th>
            <th className="border px-2 py-2 text-right">Proc Days</th>
            <th className="border px-2 py-2 text-right">Lead Days</th>
            <th className="border px-2 py-2 text-right">Fixed Safety</th>
            <th className="border px-2 py-2 text-right">Fixed Replenishment</th>
            <th className="border px-2 py-2 text-left">Item Group</th>
            <th className="border px-2 py-2 text-center">Exclude</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const draft = drafts[row.material_id] || getInitialDraft(row);
            return (
              <tr key={row.material_id}>
                <td className="border px-2 py-2">
                  <div className="grid gap-[2px]">
                    <span className="font-semibold text-slate-900">{row.material_code}</span>
                    <span className="text-[11px] text-slate-600">{row.material_name}</span>
                  </div>
                </td>
                {[
                  "monthly_requirement_qty",
                  "safety_days",
                  "processing_time_days",
                  "lead_time_days",
                  "fixed_safety_stock_qty",
                  "fixed_replenishment_stock_qty",
                ].map((field) => (
                  <td className="border px-2 py-2" key={field}>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={draft[field]}
                      onChange={(event) =>
                        onChange(row.material_id, field, event.target.value)
                      }
                      className="w-full border border-slate-300 px-2 py-1 text-right outline-none focus:border-sky-500"
                    />
                  </td>
                ))}
                <td className="border px-2 py-2">
                  <select
                    value={draft.planning_item_group_id}
                    onChange={(event) =>
                      onChange(row.material_id, "planning_item_group_id", event.target.value)
                    }
                    className="w-full border border-slate-300 px-2 py-1 outline-none focus:border-sky-500"
                  >
                    <option value="">Standalone</option>
                    {itemGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.group_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="border px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.excluded_from_dashboard)}
                    onChange={(event) =>
                      onChange(row.material_id, "excluded_from_dashboard", event.target.checked)
                    }
                    className="h-4 w-4"
                  />
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td className="border px-2 py-6 text-center text-slate-500" colSpan={9}>
                No monthly plan rows available.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default function ProcurementPlanningPage() {
  const { runtimeContext } = useMenu();
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const [companyId, setCompanyId] = useState("");
  const [planMonth, setPlanMonth] = useState(getMonthValue(""));
  const [activeTab, setActiveTab] = useState("dashboard");
  const [workspace, setWorkspace] = useState({
    plan: null,
    rows: [],
    sloc_groups: [],
    item_groups: [],
  });
  const [historyRows, setHistoryRows] = useState([]);
  const [historyMeta, setHistoryMeta] = useState(null);
  const [storageLocations, setStorageLocations] = useState([]);
  const [lineDrafts, setLineDrafts] = useState({});
  const [slocGroupForm, setSlocGroupForm] = useState({
    id: "",
    group_name: "",
    storage_location_ids: [],
  });
  const [itemGroupForm, setItemGroupForm] = useState({ id: "", group_name: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const effectiveCompanyId = companyId || defaultCompanyId;
  const planMonthValue = getMonthValue(planMonth);

  async function loadWorkspace() {
    if (!effectiveCompanyId) {
      setWorkspace({ plan: null, rows: [], sloc_groups: [], item_groups: [] });
      setStorageLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [workspaceResult, locationsResult] = await Promise.allSettled([
        getProcurementPlanning({
          company_id: effectiveCompanyId,
          plan_month: `${planMonthValue}-01`,
        }),
        listStorageLocations({
          company_id: effectiveCompanyId,
          is_active: true,
        }),
      ]);
      if (workspaceResult.status !== "fulfilled") {
        throw workspaceResult.reason;
      }

      const workspaceData = workspaceResult.value;
      setWorkspace({
        plan: workspaceData?.plan ?? null,
        rows: Array.isArray(workspaceData?.rows) ? workspaceData.rows : [],
        sloc_groups: Array.isArray(workspaceData?.sloc_groups)
          ? workspaceData.sloc_groups
          : [],
        item_groups: Array.isArray(workspaceData?.item_groups)
          ? workspaceData.item_groups
          : [],
      });

      if (locationsResult.status === "fulfilled") {
        const locations = locationsResult.value;
        setStorageLocations(Array.isArray(locations) ? locations : locations?.data ?? []);
      } else {
        setStorageLocations([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load PO11 workspace.");
      setWorkspace({ plan: null, rows: [], sloc_groups: [], item_groups: [] });
      setStorageLocations([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, [effectiveCompanyId, planMonthValue]);

  useEffect(() => {
    const nextDrafts = {};
    (workspace.rows || []).forEach((row) => {
      nextDrafts[row.material_id] = getInitialDraft(row);
    });
    setLineDrafts(nextDrafts);
  }, [workspace.rows]);

  async function loadHistory() {
    if (!effectiveCompanyId) return;
    setLoading(true);
    setError("");
    try {
      const history = await getProcurementPlanningHistory({
        company_id: effectiveCompanyId,
        plan_month: `${planMonthValue}-01`,
      });
      setHistoryRows(Array.isArray(history?.rows) ? history.rows : []);
      setHistoryMeta(history?.archive ?? null);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "Unable to load PO11 history.");
      setHistoryRows([]);
      setHistoryMeta(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "history") {
      void loadHistory();
    }
  }, [activeTab, effectiveCompanyId, planMonthValue]);

  function handleDraftChange(materialId, field, value) {
    setLineDrafts((current) => ({
      ...current,
      [materialId]: {
        ...(current[materialId] || {}),
        [field]: value,
      },
    }));
  }

  async function handleSaveLines() {
    if (!effectiveCompanyId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        company_id: effectiveCompanyId,
        plan_month: `${planMonthValue}-01`,
        lines: Object.values(lineDrafts),
      };
      const result = await saveProcurementPlanningLines(payload);
      setWorkspace((current) => ({
        ...current,
        rows: Array.isArray(result?.rows) ? result.rows : current.rows,
      }));
      setMessage("Monthly plan saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save monthly plan.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCloseMonth() {
    if (!effectiveCompanyId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await closeProcurementPlanningMonth({
        company_id: effectiveCompanyId,
        plan_month: `${planMonthValue}-01`,
      });
      setMessage(`Month ${planMonthValue} archived and closed.`);
      await loadWorkspace();
      setActiveTab("history");
      await loadHistory();
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "Unable to close month.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSlocGroup() {
    if (!effectiveCompanyId || !slocGroupForm.group_name || slocGroupForm.storage_location_ids.length === 0) {
      setError("Select company, group name, and at least one storage location.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (slocGroupForm.id) {
        await updateProcurementPlanningSlocGroup(slocGroupForm.id, {
          group_name: slocGroupForm.group_name,
          storage_location_ids: slocGroupForm.storage_location_ids,
        });
      } else {
        await createProcurementPlanningSlocGroup({
          company_id: effectiveCompanyId,
          group_name: slocGroupForm.group_name,
          storage_location_ids: slocGroupForm.storage_location_ids,
        });
      }
      setSlocGroupForm({ id: "", group_name: "", storage_location_ids: [] });
      setMessage("Planning SLOC group saved.");
      await loadWorkspace();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save SLOC group.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSlocGroup(id) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await deleteProcurementPlanningSlocGroup(id);
      setSlocGroupForm({ id: "", group_name: "", storage_location_ids: [] });
      setMessage("Planning SLOC group deleted.");
      await loadWorkspace();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete SLOC group.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveItemGroup() {
    if (!effectiveCompanyId || !itemGroupForm.group_name) {
      setError("Select company and group name.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (itemGroupForm.id) {
        await updateProcurementPlanningItemGroup(itemGroupForm.id, {
          group_name: itemGroupForm.group_name,
        });
      } else {
        await createProcurementPlanningItemGroup({
          company_id: effectiveCompanyId,
          group_name: itemGroupForm.group_name,
        });
      }
      setItemGroupForm({ id: "", group_name: "" });
      setMessage("Planning item group saved.");
      await loadWorkspace();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save item group.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteItemGroup(id) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await deleteProcurementPlanningItemGroup(id);
      setItemGroupForm({ id: "", group_name: "" });
      setMessage("Planning item group deleted.");
      await loadWorkspace();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete item group.");
    } finally {
      setSaving(false);
    }
  }

  const tabs = [
    { id: "dashboard", label: "Planning Dashboard" },
    { id: "input", label: "Monthly Plan Input" },
    { id: "sloc", label: "SLOC Group Setup" },
    { id: "item", label: "Item Group Setup" },
    { id: "history", label: "History / Archive" },
  ];

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Procurement Planning Workspace"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void loadWorkspace(),
        },
        ...(activeTab === "input"
          ? [
              {
                key: "save-lines",
                label: saving ? "Saving..." : "Save Monthly Plan",
                tone: "primary",
                onClick: () => void handleSaveLines(),
              },
            ]
          : []),
        ...(activeTab !== "history"
          ? [
              {
                key: "close-month",
                label: saving ? "Closing..." : "Close Month",
                tone: "danger",
                onClick: () => void handleCloseMonth(),
              },
            ]
          : []),
      ]}
      notices={[
        ...(error ? [{ key: "planning-error", tone: "error", message: error }] : []),
        ...(message ? [{ key: "planning-message", tone: "success", message }] : []),
      ]}
      filterSection={{
        eyebrow: "Controls",
        title: "Company / Month / Workspace",
        children: (
          <div className="grid gap-4">
            <div className="grid gap-3 lg:grid-cols-[220px_200px_minmax(0,1fr)]">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={setCompanyId}
                label="Company"
              />
              <label className="grid gap-1 text-sm text-slate-700">
                <span className="font-medium text-slate-800">Month</span>
                <input
                  type="month"
                  value={planMonthValue}
                  onChange={(event) => setPlanMonth(event.target.value)}
                  className="h-10 border border-slate-300 bg-white px-3 outline-none focus:border-sky-500"
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`border px-3 py-2 text-sm font-semibold ${
                      activeTab === tab.id
                        ? "border-sky-700 bg-sky-100 text-sky-950"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700">
                Plan Month: {planMonthValue}
              </span>
              <span className="rounded-full border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700">
                Status: {workspace.plan?.status || "OPEN"}
              </span>
              <span className="rounded-full border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700">
                Rows: {workspace.rows.length}
              </span>
            </div>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "PO11",
        title: tabs.find((tab) => tab.id === activeTab)?.label || "Workspace",
        children: (
          <div className="grid gap-4">
            {activeTab === "dashboard" ? (
              <DashboardTable rows={workspace.rows} monthValue={planMonthValue} />
            ) : null}

            {activeTab === "input" ? (
              <MonthlyInputTable
                rows={workspace.rows}
                itemGroups={workspace.item_groups}
                drafts={lineDrafts}
                onChange={handleDraftChange}
              />
            ) : null}

            {activeTab === "sloc" ? (
              <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                <div className="grid gap-3 border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {slocGroupForm.id ? "Edit SLOC Group" : "New SLOC Group"}
                  </h3>
                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">Group Name</span>
                    <input
                      value={slocGroupForm.group_name}
                      onChange={(event) =>
                        setSlocGroupForm((current) => ({
                          ...current,
                          group_name: event.target.value,
                        }))
                      }
                      className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">Storage Locations</span>
                    <select
                      multiple
                      value={slocGroupForm.storage_location_ids}
                      onChange={(event) =>
                        setSlocGroupForm((current) => ({
                          ...current,
                          storage_location_ids: Array.from(event.target.selectedOptions).map(
                            (option) => option.value
                          ),
                        }))
                      }
                      className="min-h-48 border border-slate-300 px-2 py-2 outline-none focus:border-sky-500"
                    >
                      {storageLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {(location.code || "—") + " — " + (location.name || "Unnamed")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveSlocGroup()}
                      className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950"
                    >
                      Save Group
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSlocGroupForm({ id: "", group_name: "", storage_location_ids: [] })
                      }
                      className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="grid gap-3">
                  {workspace.sloc_groups.map((group) => (
                    <div key={group.id} className="border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">
                            {group.group_name}
                          </h3>
                          <p className="text-xs text-slate-500">
                            {group.member_count} storage location
                            {group.member_count === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setSlocGroupForm({
                                id: group.id,
                                group_name: group.group_name,
                                storage_location_ids: group.storage_locations.map(
                                  (location) => location.id
                                ),
                              })
                            }
                            className="border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteSlocGroup(group.id)}
                            className="border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {group.storage_locations.map((location) => (
                          <span
                            key={location.id}
                            className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                          >
                            {location.code} — {location.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {activeTab === "item" ? (
              <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                <div className="grid gap-3 border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {itemGroupForm.id ? "Edit Item Group" : "New Item Group"}
                  </h3>
                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">Group Name</span>
                    <input
                      value={itemGroupForm.group_name}
                      onChange={(event) =>
                        setItemGroupForm((current) => ({
                          ...current,
                          group_name: event.target.value,
                        }))
                      }
                      className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveItemGroup()}
                      className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950"
                    >
                      Save Group
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemGroupForm({ id: "", group_name: "" })}
                      className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="grid gap-3">
                  {workspace.item_groups.map((group) => (
                    <div key={group.id} className="flex items-center justify-between border border-slate-200 bg-white p-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{group.group_name}</h3>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setItemGroupForm({ id: group.id, group_name: group.group_name })
                          }
                          className="border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteItemGroup(group.id)}
                          className="border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {activeTab === "history" ? (
              <div className="grid gap-3">
                <div className="rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                  {historyMeta ? (
                    <span>
                      Archived on {historyMeta.archived_at || "—"} for month {planMonthValue}
                    </span>
                  ) : (
                    <span>No archive exists yet for {planMonthValue}.</span>
                  )}
                </div>
                <div className="overflow-x-auto border border-slate-200 bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="border px-2 py-2 text-left">Group</th>
                        <th className="border px-2 py-2 text-left">Material</th>
                        <th className="border px-2 py-2 text-right">Requirement</th>
                        <th className="border px-2 py-2 text-right">Safety</th>
                        <th className="border px-2 py-2 text-right">Replenishment</th>
                        <th className="border px-2 py-2 text-right">Available</th>
                        <th className="border px-2 py-2 text-right">TRN</th>
                        <th className="border px-2 py-2 text-right">GE</th>
                        <th className="border px-2 py-2 text-right">QA</th>
                        <th className="border px-2 py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((row) => (
                        <tr key={`${row.id}-${row.material_id}`}>
                          <td className="border px-2 py-2">
                            {row.planning_item_group_name_snapshot || "Standalone"}
                          </td>
                          <td className="border px-2 py-2">
                            <div className="grid gap-[2px]">
                              <span className="font-semibold text-slate-900">
                                {row.material_code_snapshot}
                              </span>
                              <span className="text-[11px] text-slate-600">
                                {row.material_name_snapshot}
                              </span>
                            </div>
                          </td>
                          <td className="border px-2 py-2 text-right">
                            {formatQty(row.monthly_requirement_qty)}
                          </td>
                          <td className="border px-2 py-2 text-right">
                            {formatQty(row.effective_safety_stock_qty)}
                          </td>
                          <td className="border px-2 py-2 text-right">
                            {formatQty(row.effective_replenishment_stock_qty)}
                          </td>
                          <td className="border px-2 py-2 text-right">
                            {formatQty(row.available_stock_qty)}
                          </td>
                          <td className="border px-2 py-2 text-right">
                            {formatQty(row.trn_stock_qty)}
                          </td>
                          <td className="border px-2 py-2 text-right">
                            {formatQty(row.ge_stock_qty)}
                          </td>
                          <td className="border px-2 py-2 text-right">
                            {formatQty(row.qa_stock_qty)}
                          </td>
                          <td className="border px-2 py-2 text-right">
                            {formatQty(row.total_stock_qty)}
                          </td>
                        </tr>
                      ))}
                      {historyRows.length === 0 ? (
                        <tr>
                          <td className="border px-2 py-6 text-center text-slate-500" colSpan={10}>
                            No archived rows found.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ),
      }}
    />
  );
}
