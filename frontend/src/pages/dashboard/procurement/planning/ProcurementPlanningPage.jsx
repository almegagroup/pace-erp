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
  listProcurementPlanningItemGroups,
  listProcurementPlanningSlocGroups,
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

function extractCollectionItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function getStatusLabel(tone) {
  if (tone === "CRITICAL") return "Critical";
  if (tone === "WARNING") return "Replenish";
  return "Normal";
}

function summarizeDecisionBlocks(blocks) {
  return blocks
    .filter((entry) => !isGroupedMemberEntry(entry))
    .reduce(
      (acc, entry) => {
        const row = entry.row;
        acc.total += 1;
        if (entry.type === "group-total") acc.grouped += 1;
        else acc.standalone += 1;
        if (row.status_tone === "CRITICAL") acc.critical += 1;
        else if (row.status_tone === "WARNING") acc.warning += 1;
        else acc.normal += 1;
        return acc;
      },
      { total: 0, grouped: 0, standalone: 0, critical: 0, warning: 0, normal: 0 }
    );
}

function isGroupedMemberEntry(entry) {
  return entry?.type === "item" && Boolean(entry?.groupName);
}

function renderPlanningCell(entry, value, emptyLabel = "-") {
  if (isGroupedMemberEntry(entry)) {
    return <span className="text-[11px] text-slate-500">Via group total</span>;
  }
  if (value == null) return emptyLabel;
  return formatQty(value);
}

function renderOptionalPlanningCell(entry, value) {
  if (isGroupedMemberEntry(entry)) {
    return <span className="text-[11px] text-slate-500">Via group total</span>;
  }
  return value == null ? "-" : formatQty(value);
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

function toNumberOrZero(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function applyDraftToRow(row, draft, itemGroupsById) {
  if (!draft) return row;
  const nextItemGroupId = String(draft.planning_item_group_id || "");
  const nextItemGroup = nextItemGroupId ? itemGroupsById.get(nextItemGroupId) : null;
  return {
    ...row,
    monthly_requirement_qty: toNumberOrZero(draft.monthly_requirement_qty),
    safety_days: toNumberOrZero(draft.safety_days),
    processing_time_days: toNumberOrZero(draft.processing_time_days),
    lead_time_days: toNumberOrZero(draft.lead_time_days),
    fixed_safety_stock_qty:
      draft.fixed_safety_stock_qty === "" ? null : toNumberOrZero(draft.fixed_safety_stock_qty),
    fixed_replenishment_stock_qty:
      draft.fixed_replenishment_stock_qty === ""
        ? null
        : toNumberOrZero(draft.fixed_replenishment_stock_qty),
    planning_item_group_id: nextItemGroupId || null,
    planning_item_group_name: nextItemGroup?.group_name || null,
    excluded_from_dashboard: Boolean(draft.excluded_from_dashboard),
    display_order: toNumberOrZero(draft.display_order),
  };
}

function getDaysInMonth(monthValue) {
  const [year, month] = String(monthValue || "").split("-").map(Number);
  if (!year || !month) return 30;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function matchesSearch(row, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return [row.material_code, row.material_name, row.source_sloc_group_name, row.planning_item_group_name]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(needle));
}

function computeDashboardBlocks(rows, monthValue, groupConfigs = []) {
  const visibleRows = rows.filter((row) => !row.excluded_from_dashboard);
  const grouped = new Map();
  const standalone = [];
  const groupConfigById = new Map(
    groupConfigs.map((config) => [String(config.planning_item_group_id || ""), config])
  );
  const groupConfigByName = new Map(
    groupConfigs.map((config) => [String(config.planning_item_group_name || ""), config])
  );
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
      const matchingConfig =
        groupConfigById.get(String(sortedItems[0]?.planning_item_group_id || "")) ||
        groupConfigByName.get(groupName) ||
        null;
      const totalRequirement = matchingConfig
        ? Number(matchingConfig.monthly_requirement_qty || 0)
        : sortedItems.reduce((sum, row) => sum + Number(row.monthly_requirement_qty || 0), 0);
      const avgSafetyDays = matchingConfig
        ? Number(matchingConfig.safety_days || 0)
        : sortedItems.reduce((sum, row) => sum + Number(row.safety_days || 0), 0) / count;
      const avgProcessingDays = matchingConfig
        ? Number(matchingConfig.processing_time_days || 0)
        : sortedItems.reduce((sum, row) => sum + Number(row.processing_time_days || 0), 0) / count;
      const avgLeadDays = matchingConfig
        ? Number(matchingConfig.lead_time_days || 0)
        : sortedItems.reduce((sum, row) => sum + Number(row.lead_time_days || 0), 0) / count;
      const avgReplenishmentDays = avgProcessingDays + avgLeadDays;
      const daysInMonth = getDaysInMonth(monthValue);
      const dailyRequirement = daysInMonth > 0 ? totalRequirement / daysInMonth : 0;
      const derivedSafety = dailyRequirement * avgSafetyDays;
      const derivedReplenishment = derivedSafety + dailyRequirement * avgReplenishmentDays;
      const fixedSafetyTotal =
        matchingConfig?.fixed_safety_stock_qty == null
          ? null
          : Number(matchingConfig.fixed_safety_stock_qty || 0);
      const fixedReplenishmentTotal =
        matchingConfig?.fixed_replenishment_stock_qty == null
          ? null
          : Number(matchingConfig.fixed_replenishment_stock_qty || 0);
      const effectiveSafety = fixedSafetyTotal == null ? derivedSafety : fixedSafetyTotal;
      const effectiveReplenishment =
        fixedReplenishmentTotal == null ? derivedReplenishment : fixedReplenishmentTotal;
      const totalAvailable = sortedItems.reduce(
        (sum, row) => sum + Number(row.available_stock_qty || 0),
        0
      );
      const totalTrn = sortedItems.reduce((sum, row) => sum + Number(row.trn_stock_qty || 0), 0);
      const totalGe = sortedItems.reduce((sum, row) => sum + Number(row.ge_stock_qty || 0), 0);
      const totalQa = sortedItems.reduce((sum, row) => sum + Number(row.qa_stock_qty || 0), 0);
      const totalStock = totalAvailable + totalTrn + totalGe + totalQa;
      let tone = "NORMAL";
      if (totalStock <= effectiveSafety) {
        tone = "CRITICAL";
      } else if (totalStock <= effectiveReplenishment) {
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
          planning_item_group_id: sortedItems[0]?.planning_item_group_id || null,
          fixed_safety_stock_qty: fixedSafetyTotal,
          fixed_replenishment_stock_qty: fixedReplenishmentTotal,
          derived_safety_stock_qty: derivedSafety,
          derived_replenishment_stock_qty: derivedReplenishment,
          effective_safety_stock_qty: effectiveSafety,
          effective_replenishment_stock_qty: effectiveReplenishment,
          available_stock_qty: totalAvailable,
          trn_stock_qty: totalTrn,
          ge_stock_qty: totalGe,
          qa_stock_qty: totalQa,
          total_stock_qty: totalStock,
          status_tone: tone,
          base_uom_code: sortedItems[0]?.base_uom_code || "",
          source_sloc_group_name:
            [...new Set(sortedItems.map((item) => item.source_sloc_group_name).filter(Boolean))]
              .sort()
              .join(", ") || "Mixed scope",
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

function normalizeHistoryRows(rows) {
  return rows.map((row) => ({
    material_id: row.material_id,
    material_code: row.material_code_snapshot,
    material_name: row.material_name_snapshot,
    base_uom_code: row.base_uom_code_snapshot,
    source_sloc_group_name: row.source_sloc_group_name_snapshot,
    planning_item_group_name: row.planning_item_group_name_snapshot,
    excluded_from_dashboard: Boolean(row.excluded_from_dashboard),
    monthly_requirement_qty: Number(row.monthly_requirement_qty || 0),
    safety_days: Number(row.safety_days || 0),
    processing_time_days: Number(row.processing_time_days || 0),
    lead_time_days: Number(row.lead_time_days || 0),
    replenishment_days:
      Number(row.processing_time_days || 0) + Number(row.lead_time_days || 0),
    fixed_safety_stock_qty:
      row.fixed_safety_stock_qty == null ? null : Number(row.fixed_safety_stock_qty || 0),
    fixed_replenishment_stock_qty:
      row.fixed_replenishment_stock_qty == null
        ? null
        : Number(row.fixed_replenishment_stock_qty || 0),
    available_stock_qty: Number(row.available_stock_qty || 0),
    trn_stock_qty: Number(row.trn_stock_qty || 0),
    ge_stock_qty: Number(row.ge_stock_qty || 0),
    qa_stock_qty: Number(row.qa_stock_qty || 0),
    total_stock_qty: Number(row.total_stock_qty || 0),
    derived_safety_stock_qty: Number(row.derived_safety_stock_qty || 0),
    derived_replenishment_stock_qty: Number(row.derived_replenishment_stock_qty || 0),
    effective_safety_stock_qty: Number(row.effective_safety_stock_qty || 0),
    effective_replenishment_stock_qty: Number(row.effective_replenishment_stock_qty || 0),
    status_tone:
      Number(row.total_stock_qty || 0) <= Number(row.effective_safety_stock_qty || 0)
        ? "CRITICAL"
        : Number(row.total_stock_qty || 0) <= Number(row.effective_replenishment_stock_qty || 0)
          ? "WARNING"
          : "NORMAL",
  }));
}

function normalizeHistoryGroupConfigs(groupConfigs) {
  return groupConfigs.map((config) => ({
    planning_item_group_id: config.planning_item_group_id || null,
    planning_item_group_name: config.planning_item_group_name_snapshot,
    monthly_requirement_qty: Number(config.monthly_requirement_qty || 0),
    safety_days: Number(config.safety_days || 0),
    processing_time_days: Number(config.processing_time_days || 0),
    lead_time_days: Number(config.lead_time_days || 0),
    fixed_safety_stock_qty:
      config.fixed_safety_stock_qty == null ? null : Number(config.fixed_safety_stock_qty || 0),
    fixed_replenishment_stock_qty:
      config.fixed_replenishment_stock_qty == null
        ? null
        : Number(config.fixed_replenishment_stock_qty || 0),
  }));
}

function SummaryChips({ items }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {items.map((item) => (
        <span
          key={item.label}
          className={`rounded-full border px-3 py-1 font-semibold ${item.className || "border-slate-300 bg-white text-slate-700"}`}
        >
          {item.label}: {item.value}
        </span>
      ))}
    </div>
  );
}

function DashboardTable({ rows, monthValue, filters, onFilterChange, groupConfigs }) {
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (filters.slocGroupId && row.source_sloc_group_id !== filters.slocGroupId) return false;
      if (filters.materialType !== "ALL" && row.material_type !== filters.materialType) return false;
      return true;
    });
  }, [filters.materialType, filters.slocGroupId, rows]);
  const blocks = useMemo(
    () => computeDashboardBlocks(filteredRows, monthValue, groupConfigs),
    [filteredRows, monthValue, groupConfigs]
  );
  const summary = useMemo(() => summarizeDecisionBlocks(blocks), [blocks]);

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 rounded border border-slate-200 bg-white p-4 lg:grid-cols-[220px_220px_minmax(0,1fr)]">
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">SLOC Group</span>
          <select
            value={filters.slocGroupId}
            onChange={(event) => onFilterChange("slocGroupId", event.target.value)}
            className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
          >
            <option value="">All SLOC groups</option>
            {filters.slocGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.group_name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Material Type</span>
          <select
            value={filters.materialType}
            onChange={(event) => onFilterChange("materialType", event.target.value)}
            className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
          >
            <option value="ALL">All</option>
            <option value="RM">RM</option>
            <option value="PM">PM</option>
          </select>
        </label>
      </div>
      <SummaryChips
        items={[
          { label: "Visible Decisions", value: summary.total },
          { label: "Grouped Pools", value: summary.grouped },
          { label: "Standalone", value: summary.standalone },
          {
            label: "Critical",
            value: summary.critical,
            className: "border-rose-200 bg-rose-50 text-rose-800",
          },
          {
            label: "Replenish",
            value: summary.warning,
            className: "border-amber-200 bg-amber-50 text-amber-800",
          },
          { label: "Normal", value: summary.normal },
        ]}
      />
      <div className="overflow-x-auto border border-slate-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="border px-2 py-2 text-left">Group</th>
              <th className="border px-2 py-2 text-left">Item</th>
              <th className="border px-2 py-2 text-left">Source SLOC Group</th>
              <th className="border px-2 py-2 text-right">Requirement</th>
              <th className="border px-2 py-2 text-right">Safety Days</th>
              <th className="border px-2 py-2 text-right">Proc Days</th>
              <th className="border px-2 py-2 text-right">Lead Days</th>
              <th className="border px-2 py-2 text-right">Safety Stock</th>
              <th className="border px-2 py-2 text-right">Replenishment</th>
              <th className="border px-2 py-2 text-right">Fixed Safety</th>
              <th className="border px-2 py-2 text-right">Fixed Replenishment</th>
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
                        <span className="text-[11px] text-slate-600">
                          {row.material_name} {row.base_uom_code ? `(${row.base_uom_code})` : ""}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="border px-2 py-2">
                    {row.source_sloc_group_name || (isGroupTotal ? "Mixed scope" : "Not assigned")}
                  </td>
                  <td className="border px-2 py-2 text-right">
                    {renderPlanningCell(entry, row.monthly_requirement_qty)}
                  </td>
                  <td className="border px-2 py-2 text-right">
                    {renderPlanningCell(entry, row.safety_days)}
                  </td>
                  <td className="border px-2 py-2 text-right">
                    {renderPlanningCell(entry, row.processing_time_days)}
                  </td>
                  <td className="border px-2 py-2 text-right">
                    {renderPlanningCell(entry, row.lead_time_days)}
                  </td>
                  <td className="border px-2 py-2 text-right">
                    {renderPlanningCell(entry, row.effective_safety_stock_qty)}
                  </td>
                  <td className="border px-2 py-2 text-right">
                    {renderPlanningCell(entry, row.effective_replenishment_stock_qty)}
                  </td>
                  <td className="border px-2 py-2 text-right">
                    {renderOptionalPlanningCell(entry, row.fixed_safety_stock_qty)}
                  </td>
                  <td className="border px-2 py-2 text-right">
                    {renderOptionalPlanningCell(entry, row.fixed_replenishment_stock_qty)}
                  </td>
                  <td className="border px-2 py-2 text-right">{formatQty(row.available_stock_qty)}</td>
                  <td className="border px-2 py-2 text-right">{formatQty(row.trn_stock_qty)}</td>
                  <td className="border px-2 py-2 text-right">{formatQty(row.ge_stock_qty)}</td>
                  <td className="border px-2 py-2 text-right">{formatQty(row.qa_stock_qty)}</td>
                  <td className="border px-2 py-2 text-right">{formatQty(row.total_stock_qty)}</td>
                  <td className="border px-2 py-2">{getStatusLabel(row.status_tone)}</td>
                </tr>
              );
            })}
            {blocks.length === 0 ? (
              <tr>
                <td className="border px-2 py-6 text-center text-slate-500" colSpan={17}>
                  No planning rows available for this company/month yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthlyInputTable({
  rows,
  itemGroups,
  slocGroups,
  drafts,
  groupConfigDrafts,
  filters,
  onChange,
  onGroupConfigChange,
  onFilterChange,
  onClearFilters,
}) {
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!matchesSearch(row, filters.query)) return false;
      if (filters.slocGroupId && row.source_sloc_group_id !== filters.slocGroupId) return false;
      if (filters.itemGroupId && row.planning_item_group_id !== filters.itemGroupId) return false;
      if (filters.materialType !== "ALL" && row.material_type !== filters.materialType) return false;
      if (filters.showUngroupedOnly && row.planning_item_group_id) return false;
      if (filters.showExcludedOnly && !row.excluded_from_dashboard) return false;
      return true;
    });
  }, [filters, rows]);
  const groupConfigs = useMemo(() => Object.values(groupConfigDrafts || {}), [groupConfigDrafts]);
  const blocks = useMemo(
    () => computeDashboardBlocks(filteredRows, filters.monthValue, groupConfigs),
    [filteredRows, filters.monthValue, groupConfigs]
  );
  const itemGroupsBySloc = useMemo(() => {
    const map = new Map();
    itemGroups.forEach((group) => {
      const key = group.sloc_group_id || "__UNSCOPED__";
      const bucket = map.get(key) || [];
      bucket.push(group);
      map.set(key, bucket);
    });
    return map;
  }, [itemGroups]);
  const decisionBlocks = useMemo(
    () => blocks.filter((entry) => !isGroupedMemberEntry(entry)),
    [blocks]
  );
  const groupedDecisionCount = useMemo(
    () => decisionBlocks.filter((entry) => entry.type === "group-total").length,
    [decisionBlocks]
  );
  const standaloneDecisionCount = useMemo(
    () => decisionBlocks.filter((entry) => entry.type === "item").length,
    [decisionBlocks]
  );

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 rounded border border-slate-200 bg-white p-4 lg:grid-cols-[minmax(0,1.4fr)_220px_220px_160px_auto_auto_auto]">
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Search Material / Group</span>
          <input
            value={filters.query}
            onChange={(event) => onFilterChange("query", event.target.value)}
            placeholder="Type material code, material name, or group..."
            className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
          />
        </label>
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Source SLOC Group</span>
          <select
            value={filters.slocGroupId}
            onChange={(event) => onFilterChange("slocGroupId", event.target.value)}
            className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
          >
            <option value="">All SLOC groups</option>
            {slocGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.group_name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Assigned Item Group</span>
          <select
            value={filters.itemGroupId}
            onChange={(event) => onFilterChange("itemGroupId", event.target.value)}
            className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
          >
            <option value="">All item groups</option>
            {itemGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.group_name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Material Type</span>
          <select
            value={filters.materialType}
            onChange={(event) => onFilterChange("materialType", event.target.value)}
            className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
          >
            <option value="ALL">All</option>
            <option value="RM">RM</option>
            <option value="PM">PM</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={filters.showUngroupedOnly}
            onChange={(event) => onFilterChange("showUngroupedOnly", event.target.checked)}
            className="h-4 w-4"
          />
          <span>Only standalone</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={filters.showExcludedOnly}
            onChange={(event) => onFilterChange("showExcludedOnly", event.target.checked)}
            className="h-4 w-4"
          />
          <span>Only excluded</span>
        </label>
        <div className="flex items-end justify-end">
          <button
            type="button"
            onClick={onClearFilters}
            className="h-10 border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700"
          >
            Clear Filters
          </button>
        </div>
      </div>

      <SummaryChips
        items={[
          { label: "Visible Decisions", value: decisionBlocks.length },
          { label: "Grouped Pools", value: groupedDecisionCount },
          { label: "Standalone", value: standaloneDecisionCount },
          { label: "Member Rows", value: filteredRows.filter((row) => row.planning_item_group_id).length },
          { label: "Total Rows", value: rows.length },
          { label: "Excluded", value: rows.filter((row) => row.excluded_from_dashboard).length },
        ]}
      />

      <div className="overflow-x-auto border border-slate-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="border px-2 py-2 text-left">Group</th>
              <th className="border px-2 py-2 text-left">Row</th>
              <th className="border px-2 py-2 text-left">Material</th>
              <th className="border px-2 py-2 text-left">Type</th>
              <th className="border px-2 py-2 text-left">Source SLOC Group</th>
              <th className="border px-2 py-2 text-right">Live Total Stock</th>
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
            {blocks.map((entry, index) => {
              const row = entry.row;
              const isGroupTotal = entry.type === "group-total";
              const isGroupedMember = !isGroupTotal && Boolean(row.planning_item_group_id);
              const draft = !isGroupTotal ? drafts[row.material_id] || getInitialDraft(row) : null;
              const groupConfigDraft = isGroupTotal
                ? groupConfigDrafts[row.planning_item_group_id] || null
                : null;
              const scopedItemGroups =
                itemGroupsBySloc.get(row.source_sloc_group_id || "__UNSCOPED__") || [];
              return (
                <tr
                  key={`${entry.type}-${entry.groupName || row.material_id || index}`}
                  className={`${isGroupTotal ? `font-semibold ${getStatusToneClass(row.status_tone)}` : ""}`}
                >
                  <td className="border px-2 py-2">
                    {entry.groupName || row.planning_item_group_name || "Standalone"}
                  </td>
                  <td className="border px-2 py-2">
                    {isGroupTotal
                      ? "Group Total"
                      : row.planning_item_group_name
                        ? "Member"
                        : "Standalone"}
                  </td>
                  <td className="border px-2 py-2">
                    {isGroupTotal ? (
                      <span>Summary</span>
                    ) : (
                      <div className="grid gap-[2px]">
                        <span className="font-semibold text-slate-900">{row.material_code}</span>
                        <span className="text-[11px] text-slate-600">
                          {row.material_name} {row.base_uom_code ? `(${row.base_uom_code})` : ""}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Current status: {getStatusLabel(row.status_tone)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="border px-2 py-2">{isGroupTotal ? "-" : row.material_type}</td>
                  <td className="border px-2 py-2">
                    <div className="grid gap-[2px]">
                      <span className="font-medium text-slate-800">
                        {row.source_sloc_group_name || "No SLOC group"}
                      </span>
                      {!isGroupTotal ? (
                        <span className="text-[11px] text-slate-500">
                          {row.planning_item_group_name || "Standalone"}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="border px-2 py-2 text-right">{formatQty(row.total_stock_qty)}</td>
                  {[
                    "monthly_requirement_qty",
                    "safety_days",
                    "processing_time_days",
                    "lead_time_days",
                    "fixed_safety_stock_qty",
                    "fixed_replenishment_stock_qty",
                  ].map((field) => (
                    <td className="border px-2 py-2" key={field}>
                      {isGroupTotal ? (
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={groupConfigDraft?.[field] ?? ""}
                          onChange={(event) =>
                            onGroupConfigChange(row.planning_item_group_id, field, event.target.value)
                          }
                          className="w-full border border-slate-300 px-2 py-1 text-right outline-none focus:border-sky-500"
                        />
                      ) : isGroupedMember ? (
                        <span className="block text-right text-slate-500">Via group total</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={draft[field]}
                          onChange={(event) => onChange(row.material_id, field, event.target.value)}
                          className="w-full border border-slate-300 px-2 py-1 text-right outline-none focus:border-sky-500"
                        />
                      )}
                    </td>
                  ))}
                  <td className="border px-2 py-2">
                    {isGroupTotal ? (
                      <span>{entry.groupName || "-"}</span>
                    ) : (
                      <select
                        value={draft.planning_item_group_id}
                        onChange={(event) =>
                          onChange(row.material_id, "planning_item_group_id", event.target.value)
                        }
                        className="w-full border border-slate-300 px-2 py-1 outline-none focus:border-sky-500"
                      >
                        <option value="">Standalone</option>
                        {scopedItemGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.group_name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="border px-2 py-2 text-center">
                    {isGroupTotal ? (
                      <span>-</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={Boolean(draft.excluded_from_dashboard)}
                        onChange={(event) =>
                          onChange(row.material_id, "excluded_from_dashboard", event.target.checked)
                        }
                        className="h-4 w-4"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {blocks.length === 0 ? (
              <tr>
                <td className="border px-2 py-6 text-center text-slate-500" colSpan={14}>
                  No monthly plan rows match the current filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupCard({
  title,
  subtitle,
  badges,
  previewItems,
  emptyMessage,
  onPrimary,
  primaryLabel,
  onEdit,
  onDelete,
}) {
  return (
    <div className="grid gap-3 border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onPrimary ? (
            <button
              type="button"
              onClick={onPrimary}
              className="border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
            >
              {primaryLabel}
            </button>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
            >
              Edit
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {badges.map((badge) => (
          <span
            key={badge.label}
            className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 font-medium text-slate-700"
          >
            {badge.label}: {badge.value}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {previewItems.length > 0 ? (
          previewItems.map((item) => (
            <span
              key={item}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
            >
              {item}
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-500">{emptyMessage}</span>
        )}
      </div>
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
    group_configs: [],
  });
  const [historyRows, setHistoryRows] = useState([]);
  const [historyGroupConfigs, setHistoryGroupConfigs] = useState([]);
  const [historyMeta, setHistoryMeta] = useState(null);
  const [storageLocations, setStorageLocations] = useState([]);
  const [lineDrafts, setLineDrafts] = useState({});
  const [groupConfigDrafts, setGroupConfigDrafts] = useState({});
  const [slocGroupForm, setSlocGroupForm] = useState({
    id: "",
    group_name: "",
    storage_location_ids: [],
  });
  const [itemGroupForm, setItemGroupForm] = useState({ id: "", group_name: "", sloc_group_id: "" });
  const [selectedItemGroupId, setSelectedItemGroupId] = useState("");
  const [itemManagerSlocGroupId, setItemManagerSlocGroupId] = useState("");
  const [dashboardFilters, setDashboardFilters] = useState({
    slocGroupId: "",
    materialType: "ALL",
    slocGroups: [],
  });
  const [inputFilters, setInputFilters] = useState({
    query: "",
    slocGroupId: "",
    itemGroupId: "",
    materialType: "ALL",
    showUngroupedOnly: false,
    showExcludedOnly: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const effectiveCompanyId = companyId || defaultCompanyId;
  const planMonthValue = getMonthValue(planMonth);

  async function loadWorkspace() {
    if (!effectiveCompanyId) {
      setWorkspace({ plan: null, rows: [], sloc_groups: [], item_groups: [], group_configs: [] });
      setStorageLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [workspaceResult, locationsResult, slocGroupsResult, itemGroupsResult] = await Promise.allSettled([
        getProcurementPlanning({
          company_id: effectiveCompanyId,
          plan_month: `${planMonthValue}-01`,
        }),
        listStorageLocations({
          company_id: effectiveCompanyId,
          is_active: true,
        }),
        listProcurementPlanningSlocGroups({
          company_id: effectiveCompanyId,
        }),
        listProcurementPlanningItemGroups({
          company_id: effectiveCompanyId,
        }),
      ]);
      if (workspaceResult.status !== "fulfilled") {
        throw workspaceResult.reason;
      }

      const workspaceData = workspaceResult.value;
      const fallbackSlocGroups =
        slocGroupsResult.status === "fulfilled"
          ? extractCollectionItems(slocGroupsResult.value)
          : [];
      const fallbackItemGroups =
        itemGroupsResult.status === "fulfilled"
          ? extractCollectionItems(itemGroupsResult.value)
          : [];
      setWorkspace({
        plan: workspaceData?.plan ?? null,
        rows: Array.isArray(workspaceData?.rows) ? workspaceData.rows : [],
        sloc_groups:
          fallbackSlocGroups.length > 0
            ? fallbackSlocGroups
            : Array.isArray(workspaceData?.sloc_groups)
              ? workspaceData.sloc_groups
              : [],
        item_groups:
          fallbackItemGroups.length > 0
            ? fallbackItemGroups
            : Array.isArray(workspaceData?.item_groups)
              ? workspaceData.item_groups
              : [],
        group_configs: Array.isArray(workspaceData?.group_configs)
          ? workspaceData.group_configs
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
      setWorkspace({ plan: null, rows: [], sloc_groups: [], item_groups: [], group_configs: [] });
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

  useEffect(() => {
    const nextGroupConfigDrafts = {};
    (workspace.item_groups || []).forEach((group) => {
      const existing = (workspace.group_configs || []).find(
        (config) => config.planning_item_group_id === group.id
      );
      nextGroupConfigDrafts[group.id] = {
        planning_item_group_id: group.id,
        planning_item_group_name: group.group_name,
        sloc_group_id: group.sloc_group_id || "",
        monthly_requirement_qty: String(existing?.monthly_requirement_qty ?? 0),
        safety_days: String(existing?.safety_days ?? 0),
        processing_time_days: String(existing?.processing_time_days ?? 0),
        lead_time_days: String(existing?.lead_time_days ?? 0),
        fixed_safety_stock_qty:
          existing?.fixed_safety_stock_qty == null ? "" : String(existing.fixed_safety_stock_qty),
        fixed_replenishment_stock_qty:
          existing?.fixed_replenishment_stock_qty == null
            ? ""
            : String(existing.fixed_replenishment_stock_qty),
      };
    });
    setGroupConfigDrafts(nextGroupConfigDrafts);
  }, [workspace.group_configs, workspace.item_groups]);

  useEffect(() => {
    setDashboardFilters((current) => ({
      ...current,
      slocGroups: workspace.sloc_groups || [],
    }));
  }, [workspace.sloc_groups]);

  useEffect(() => {
    if (!workspace.sloc_groups.length) {
      setItemManagerSlocGroupId("");
      return;
    }
    setItemManagerSlocGroupId((current) => {
      if (current && workspace.sloc_groups.some((group) => group.id === current)) return current;
      return workspace.sloc_groups[0]?.id || "";
    });
  }, [workspace.sloc_groups]);

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
      setHistoryGroupConfigs(Array.isArray(history?.group_configs) ? history.group_configs : []);
      setHistoryMeta(history?.archive ?? null);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "Unable to load PO11 history.");
      setHistoryRows([]);
      setHistoryGroupConfigs([]);
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

  function handleGroupConfigChange(groupId, field, value) {
    setGroupConfigDrafts((current) => ({
      ...current,
      [groupId]: {
        ...(current[groupId] || {}),
        [field]: value,
      },
    }));
  }

  function handleInputFilterChange(field, value) {
    setInputFilters((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function clearInputFilters() {
    setInputFilters({
      query: "",
      slocGroupId: "",
      itemGroupId: "",
      materialType: "ALL",
      showUngroupedOnly: false,
      showExcludedOnly: false,
    });
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
        group_configs: Object.values(groupConfigDrafts),
      };
      const result = await saveProcurementPlanningLines(payload);
      setWorkspace((current) => ({
        ...current,
        rows: Array.isArray(result?.rows) ? result.rows : current.rows,
        group_configs: Array.isArray(result?.group_configs)
          ? result.group_configs
          : current.group_configs,
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
      let savedGroups = [];
      if (slocGroupForm.id) {
        savedGroups = extractCollectionItems(await updateProcurementPlanningSlocGroup(slocGroupForm.id, {
          group_name: slocGroupForm.group_name,
          storage_location_ids: slocGroupForm.storage_location_ids,
        }));
      } else {
        savedGroups = extractCollectionItems(await createProcurementPlanningSlocGroup({
          company_id: effectiveCompanyId,
          group_name: slocGroupForm.group_name,
          storage_location_ids: slocGroupForm.storage_location_ids,
        }));
      }
      if (savedGroups.length > 0) {
        setWorkspace((current) => ({
          ...current,
          sloc_groups: savedGroups,
        }));
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
      const savedGroups = extractCollectionItems(await deleteProcurementPlanningSlocGroup(id));
      if (savedGroups.length > 0 || workspace.sloc_groups.length > 0) {
        setWorkspace((current) => ({
          ...current,
          sloc_groups: savedGroups,
        }));
      }
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
    if (!effectiveCompanyId || !itemGroupForm.group_name || !itemGroupForm.sloc_group_id) {
      setError("Select company, SLOC group, and group name.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (itemGroupForm.id) {
        await updateProcurementPlanningItemGroup(itemGroupForm.id, {
          sloc_group_id: itemGroupForm.sloc_group_id,
          group_name: itemGroupForm.group_name,
        });
      } else {
        await createProcurementPlanningItemGroup({
          company_id: effectiveCompanyId,
          sloc_group_id: itemGroupForm.sloc_group_id,
          group_name: itemGroupForm.group_name,
        });
      }
      setItemGroupForm({ id: "", group_name: "", sloc_group_id: "" });
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
      setItemGroupForm({ id: "", group_name: "", sloc_group_id: "" });
      if (selectedItemGroupId === id) setSelectedItemGroupId("");
      setMessage("Planning item group deleted.");
      await loadWorkspace();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete item group.");
    } finally {
      setSaving(false);
    }
  }

  function jumpToMonthlyInput(filters) {
    setInputFilters({
      query: "",
      slocGroupId: filters.slocGroupId || "",
      itemGroupId: filters.itemGroupId || "",
      materialType: filters.materialType || "ALL",
      showUngroupedOnly: Boolean(filters.showUngroupedOnly),
      showExcludedOnly: Boolean(filters.showExcludedOnly),
    });
    setActiveTab("input");
  }

  function handleDashboardFilterChange(field, value) {
    setDashboardFilters((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function assignItemGroup(materialId, groupId) {
    handleDraftChange(materialId, "planning_item_group_id", groupId);
  }

  function unassignItemGroup(materialId) {
    handleDraftChange(materialId, "planning_item_group_id", "");
  }

  const tabs = [
    { id: "dashboard", label: "Planning Dashboard" },
    { id: "input", label: "Monthly Plan Input" },
    { id: "sloc", label: "SLOC Group Setup" },
    { id: "item", label: "Item Group Setup" },
    { id: "history", label: "History / Archive" },
  ];

  const itemGroupsById = useMemo(() => {
    return new Map((workspace.item_groups || []).map((group) => [group.id, group]));
  }, [workspace.item_groups]);

  const effectiveRows = useMemo(() => {
    return (workspace.rows || []).map((row) =>
      applyDraftToRow(row, lineDrafts[row.material_id], itemGroupsById)
    );
  }, [itemGroupsById, lineDrafts, workspace.rows]);

  const planningSummary = useMemo(() => {
    const rows = effectiveRows || [];
    return {
      totalRows: rows.length,
      slocGroups: workspace.sloc_groups.length,
      itemGroups: workspace.item_groups.length,
      groupedRows: rows.filter((row) => row.planning_item_group_id).length,
      standaloneRows: rows.filter((row) => !row.planning_item_group_id).length,
      excludedRows: rows.filter((row) => row.excluded_from_dashboard).length,
      criticalRows: rows.filter((row) => row.status_tone === "CRITICAL").length,
      warningRows: rows.filter((row) => row.status_tone === "WARNING").length,
    };
  }, [effectiveRows, workspace.item_groups.length, workspace.sloc_groups.length]);
  const workspaceDecisionBlocks = useMemo(
    () => computeDashboardBlocks(effectiveRows, planMonthValue, Object.values(groupConfigDrafts)),
    [effectiveRows, groupConfigDrafts, planMonthValue]
  );
  const workspaceDecisionSummary = useMemo(
    () => summarizeDecisionBlocks(workspaceDecisionBlocks),
    [workspaceDecisionBlocks]
  );

  const slocGroupInsights = useMemo(() => {
    return workspace.sloc_groups.map((group) => {
      const linkedRows = effectiveRows.filter((row) => row.source_sloc_group_id === group.id);
      return {
        ...group,
        linkedMaterialCount: linkedRows.length,
        groupedMaterialCount: linkedRows.filter((row) => row.planning_item_group_id).length,
        excludedMaterialCount: linkedRows.filter((row) => row.excluded_from_dashboard).length,
        previewMaterials: linkedRows
          .map((row) => row.material_code)
          .filter(Boolean)
          .sort((left, right) => String(left).localeCompare(String(right)))
          .slice(0, 10),
      };
    });
  }, [effectiveRows, workspace.sloc_groups]);

  const itemGroupInsights = useMemo(() => {
    return workspace.item_groups.map((group) => {
      const memberRows = effectiveRows.filter((row) => row.planning_item_group_id === group.id);
      return {
        ...group,
        memberCount: memberRows.length,
        sourceSlocCount: new Set(
          memberRows.map((row) => row.source_sloc_group_id).filter(Boolean)
        ).size,
        previewMaterials: memberRows
          .map((row) => row.material_code)
          .filter(Boolean)
          .sort((left, right) => String(left).localeCompare(String(right)))
          .slice(0, 10),
      };
    });
  }, [effectiveRows, workspace.item_groups]);

  const standaloneRows = useMemo(() => {
    return effectiveRows
      .filter((row) => !row.planning_item_group_id)
      .sort((left, right) => String(left.material_code).localeCompare(String(right.material_code)));
  }, [effectiveRows]);

  const selectedItemGroup = useMemo(() => {
    return workspace.item_groups.find((group) => group.id === selectedItemGroupId) || null;
  }, [selectedItemGroupId, workspace.item_groups]);

  useEffect(() => {
    if (selectedItemGroup?.sloc_group_id) {
      setItemManagerSlocGroupId(selectedItemGroup.sloc_group_id);
    }
  }, [selectedItemGroup]);

  const selectedSlocGroupIdForItems = itemManagerSlocGroupId || workspace.sloc_groups[0]?.id || "";

  const itemTabRows = useMemo(() => {
    return effectiveRows
      .filter((row) => !selectedSlocGroupIdForItems || row.source_sloc_group_id === selectedSlocGroupIdForItems)
      .sort((left, right) => String(left.material_code).localeCompare(String(right.material_code)));
  }, [effectiveRows, selectedSlocGroupIdForItems]);

  const selectedItemGroupMembers = useMemo(() => {
    if (!selectedItemGroupId) return [];
    return itemTabRows.filter((row) => row.planning_item_group_id === selectedItemGroupId);
  }, [itemTabRows, selectedItemGroupId]);

  const availableItemPool = useMemo(() => {
    return itemTabRows.filter((row) => !row.planning_item_group_id);
  }, [itemTabRows]);
  const scopedItemGroups = useMemo(() => {
    return workspace.item_groups.filter((group) => group.sloc_group_id === selectedSlocGroupIdForItems);
  }, [selectedSlocGroupIdForItems, workspace.item_groups]);

  const historyBlocks = useMemo(() => {
    return computeDashboardBlocks(
      normalizeHistoryRows(historyRows),
      planMonthValue,
      normalizeHistoryGroupConfigs(historyGroupConfigs)
    );
  }, [historyGroupConfigs, historyRows, planMonthValue]);
  const historySummary = useMemo(() => summarizeDecisionBlocks(historyBlocks), [historyBlocks]);

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
        ...(activeTab === "item"
          ? [
              {
                key: "save-item-membership",
                label: saving ? "Saving..." : "Save Item Group Mapping",
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

            <SummaryChips
              items={[
                { label: "Plan Month", value: planMonthValue },
                { label: "Status", value: workspace.plan?.status || "OPEN" },
                { label: "Rows", value: planningSummary.totalRows },
                { label: "SLOC Groups", value: planningSummary.slocGroups },
                { label: "Item Groups", value: planningSummary.itemGroups },
                { label: "Standalone", value: planningSummary.standaloneRows },
                {
                  label: "Critical",
                  value: planningSummary.criticalRows,
                  className: "border-rose-200 bg-rose-50 text-rose-800",
                },
                {
                  label: "Replenish",
                  value: planningSummary.warningRows,
                  className: "border-amber-200 bg-amber-50 text-amber-800",
                },
              ]}
            />
          </div>
        ),
      }}
      listSection={{
        eyebrow: "PO11",
        title: tabs.find((tab) => tab.id === activeTab)?.label || "Workspace",
        children: (
          <div className="grid gap-4">
            {activeTab === "dashboard" ? (
              <DashboardTable
                rows={effectiveRows}
                monthValue={planMonthValue}
                filters={dashboardFilters}
                onFilterChange={handleDashboardFilterChange}
                groupConfigs={Object.values(groupConfigDrafts)}
              />
            ) : null}

            {activeTab === "input" ? (
              <MonthlyInputTable
                rows={effectiveRows}
                itemGroups={workspace.item_groups}
                slocGroups={workspace.sloc_groups}
                drafts={lineDrafts}
                groupConfigDrafts={groupConfigDrafts}
                filters={{ ...inputFilters, monthValue: planMonthValue }}
                onChange={handleDraftChange}
                onGroupConfigChange={handleGroupConfigChange}
                onFilterChange={handleInputFilterChange}
                onClearFilters={clearInputFilters}
              />
            ) : null}

            {activeTab === "sloc" ? (
              <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                <div className="grid gap-3 border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {slocGroupForm.id ? "Edit SLOC Group" : "New SLOC Group"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Each SLOC group decides which RM/PM materials enter PO11 planning scope for the selected company.
                  </p>
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
                          {(location.code || "-") + " - " + (location.name || "Unnamed")}
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
                  {slocGroupInsights.map((group) => (
                    <GroupCard
                      key={group.id}
                      title={group.group_name}
                      subtitle={`${group.member_count} storage location${group.member_count === 1 ? "" : "s"} selected`}
                      badges={[
                        { label: "Eligible Materials", value: group.linkedMaterialCount },
                        { label: "Grouped", value: group.groupedMaterialCount },
                        { label: "Excluded", value: group.excludedMaterialCount },
                      ]}
                      previewItems={[
                        ...group.storage_locations.map((location) => `${location.code} - ${location.name}`),
                        ...group.previewMaterials,
                      ].slice(0, 10)}
                      emptyMessage="No RM/PM materials are currently flowing from this SLOC group into PO11."
                      onPrimary={() => jumpToMonthlyInput({ slocGroupId: group.id })}
                      primaryLabel="Open in Monthly Plan"
                      onEdit={() =>
                        setSlocGroupForm({
                          id: group.id,
                          group_name: group.group_name,
                          storage_location_ids: group.storage_locations.map((location) => location.id),
                        })
                      }
                      onDelete={() => void handleDeleteSlocGroup(group.id)}
                    />
                  ))}
                  {slocGroupInsights.length === 0 ? (
                    <div className="rounded border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                      No planning SLOC group exists yet. Create one first, then open Monthly Plan Input to review the auto-included RM/PM list.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {activeTab === "item" ? (
              <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                <div className="grid gap-3 border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {itemGroupForm.id ? "Edit Item Group" : "New Item Group"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Item groups define pooled / alternate materials inside one selected SLOC group scope.
                  </p>
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
                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">Parent SLOC Group</span>
                    <select
                      value={itemGroupForm.sloc_group_id}
                      onChange={(event) =>
                        setItemGroupForm((current) => ({
                          ...current,
                          sloc_group_id: event.target.value,
                        }))
                      }
                      className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                    >
                      <option value="">Select SLOC group</option>
                      {workspace.sloc_groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.group_name}
                        </option>
                      ))}
                    </select>
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
                      onClick={() => setItemGroupForm({ id: "", group_name: "", sloc_group_id: "" })}
                      className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="grid gap-3">
                  {itemGroupInsights.map((group) => (
                    <GroupCard
                      key={group.id}
                      title={group.group_name}
                      subtitle="Members are managed from this Item Group Setup screen."
                      badges={[
                        { label: "Members", value: group.memberCount },
                        { label: "Source SLOC Groups", value: group.sourceSlocCount },
                      ]}
                      previewItems={group.previewMaterials}
                      emptyMessage="No material has been assigned to this item group yet."
                      onPrimary={() => {
                        setSelectedItemGroupId(group.id);
                        setItemManagerSlocGroupId(group.sloc_group_id || "");
                      }}
                      primaryLabel="Manage Members"
                      onEdit={() =>
                        setItemGroupForm({
                          id: group.id,
                          group_name: group.group_name,
                          sloc_group_id: group.sloc_group_id || "",
                        })
                      }
                      onDelete={() => void handleDeleteItemGroup(group.id)}
                    />
                  ))}

                  <div className="grid gap-3 border border-slate-200 bg-white p-4">
                    <div className="grid gap-3 lg:grid-cols-[220px_220px_minmax(0,1fr)]">
                      <label className="grid gap-1 text-sm text-slate-700">
                        <span className="font-medium text-slate-800">SLOC Group Scope</span>
                        <select
                          value={selectedSlocGroupIdForItems}
                          onChange={(event) => {
                            setItemManagerSlocGroupId(event.target.value);
                            setSelectedItemGroupId("");
                          }}
                          className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                        >
                          <option value="">Select SLOC group</option>
                          {workspace.sloc_groups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.group_name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm text-slate-700">
                        <span className="font-medium text-slate-800">Item Group To Manage</span>
                        <select
                          value={selectedItemGroupId}
                          onChange={(event) => setSelectedItemGroupId(event.target.value)}
                          className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                        >
                          <option value="">Select item group</option>
                          {workspace.item_groups
                            .filter((group) => group.sloc_group_id === selectedSlocGroupIdForItems)
                            .map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.group_name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <SummaryChips
                      items={[
                        { label: "Scope Items", value: itemTabRows.length },
                        { label: "Scope Groups", value: scopedItemGroups.length },
                        { label: "Current Members", value: selectedItemGroupMembers.length },
                        { label: "Available Standalone", value: availableItemPool.length },
                      ]}
                    />
                    {selectedItemGroupId ? (
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold text-slate-900">Available Item Pool</h3>
                            <span className="text-xs text-slate-500">{availableItemPool.length} item(s)</span>
                          </div>
                          <div className="grid gap-2">
                            {availableItemPool.map((row) => (
                              <div key={row.material_id} className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-2">
                                <div className="grid gap-[2px]">
                                  <span className="text-sm font-semibold text-slate-900">{row.material_code}</span>
                                  <span className="text-xs text-slate-600">
                                    {row.material_name} | {row.material_type} | Standalone
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => assignItemGroup(row.material_id, selectedItemGroupId)}
                                  className="border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                                >
                                  Add
                                </button>
                              </div>
                            ))}
                            {availableItemPool.length === 0 ? (
                              <span className="text-xs text-slate-500">No standalone item is available in this SLOC group scope.</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold text-slate-900">Current Members</h3>
                            <span className="text-xs text-slate-500">{selectedItemGroupMembers.length} item(s)</span>
                          </div>
                          <div className="grid gap-2">
                            {selectedItemGroupMembers.map((row) => (
                              <div key={row.material_id} className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-2">
                                <div className="grid gap-[2px]">
                                  <span className="text-sm font-semibold text-slate-900">{row.material_code}</span>
                                  <span className="text-xs text-slate-600">
                                    {row.material_name} | {row.material_type}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => unassignItemGroup(row.material_id)}
                                  className="border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                            {selectedItemGroupMembers.length === 0 ? (
                              <span className="text-xs text-slate-500">No member is mapped to this item group yet.</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <h3 className="text-sm font-semibold text-slate-900">Standalone Materials</h3>
                        <p className="text-xs text-slate-500">
                          These materials are in PO11 but are not assigned to any planning item group.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => jumpToMonthlyInput({ showUngroupedOnly: true })}
                        className="border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                      >
                        Review Standalone
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {standaloneRows.length > 0 ? (
                        standaloneRows.slice(0, 16).map((row) => (
                          <span
                            key={row.material_id}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                          >
                            {row.material_code}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">
                          Every visible material is already assigned to a planning item group.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "history" ? (
              <div className="grid gap-3">
                <div className="rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                  {historyMeta ? (
                    <span>
                      Archived on {historyMeta.archived_at || "-"} for month {planMonthValue}. This view is frozen and does not recalculate against current stock.
                    </span>
                  ) : (
                    <span>No archive exists yet for {planMonthValue}.</span>
                  )}
                </div>
                <SummaryChips
                  items={[
                    { label: "Archived Decisions", value: historySummary.total },
                    { label: "Grouped Pools", value: historySummary.grouped },
                    { label: "Standalone", value: historySummary.standalone },
                    {
                      label: "Critical",
                      value: historySummary.critical,
                      className: "border-rose-200 bg-rose-50 text-rose-800",
                    },
                    {
                      label: "Replenish",
                      value: historySummary.warning,
                      className: "border-amber-200 bg-amber-50 text-amber-800",
                    },
                  ]}
                />
                <div className="overflow-x-auto border border-slate-200 bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="border px-2 py-2 text-left">Group</th>
                        <th className="border px-2 py-2 text-left">Item</th>
                        <th className="border px-2 py-2 text-left">Source SLOC Group</th>
                        <th className="border px-2 py-2 text-right">Requirement</th>
                        <th className="border px-2 py-2 text-right">Safety Days</th>
                        <th className="border px-2 py-2 text-right">Proc Days</th>
                        <th className="border px-2 py-2 text-right">Lead Days</th>
                        <th className="border px-2 py-2 text-right">Safety Stock</th>
                        <th className="border px-2 py-2 text-right">Replenishment</th>
                        <th className="border px-2 py-2 text-right">Fixed Safety</th>
                        <th className="border px-2 py-2 text-right">Fixed Replenishment</th>
                        <th className="border px-2 py-2 text-right">Available</th>
                        <th className="border px-2 py-2 text-right">TRN</th>
                        <th className="border px-2 py-2 text-right">GE</th>
                        <th className="border px-2 py-2 text-right">In QA</th>
                        <th className="border px-2 py-2 text-right">Total</th>
                        <th className="border px-2 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyBlocks.map((entry, index) => {
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
                                  <span className="font-semibold text-slate-900">
                                    {row.material_code}
                                  </span>
                                  <span className="text-[11px] text-slate-600">
                                    {row.material_name}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="border px-2 py-2">
                              {row.source_sloc_group_name || (isGroupTotal ? "Mixed scope" : "Not assigned")}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {renderPlanningCell(entry, row.monthly_requirement_qty)}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {renderPlanningCell(entry, row.safety_days)}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {renderPlanningCell(entry, row.processing_time_days)}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {renderPlanningCell(entry, row.lead_time_days)}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {renderPlanningCell(entry, row.effective_safety_stock_qty)}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {renderPlanningCell(entry, row.effective_replenishment_stock_qty)}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {renderOptionalPlanningCell(entry, row.fixed_safety_stock_qty)}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {renderOptionalPlanningCell(entry, row.fixed_replenishment_stock_qty)}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {formatQty(row.available_stock_qty)}
                            </td>
                            <td className="border px-2 py-2 text-right">{formatQty(row.trn_stock_qty)}</td>
                            <td className="border px-2 py-2 text-right">{formatQty(row.ge_stock_qty)}</td>
                            <td className="border px-2 py-2 text-right">{formatQty(row.qa_stock_qty)}</td>
                            <td className="border px-2 py-2 text-right">{formatQty(row.total_stock_qty)}</td>
                            <td className="border px-2 py-2">{getStatusLabel(row.status_tone)}</td>
                          </tr>
                        );
                      })}
                      {historyBlocks.length === 0 ? (
                        <tr>
                          <td className="border px-2 py-6 text-center text-slate-500" colSpan={17}>
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
