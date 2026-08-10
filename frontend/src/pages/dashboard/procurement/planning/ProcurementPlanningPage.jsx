import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
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

const EMPTY_WORKSPACE = {
  plan: null,
  rows: [],
  sloc_groups: [],
  item_groups: [],
  group_configs: [],
  can_maintain: false,
};

const EMPTY_HISTORY = {
  archive: null,
  rows: [],
  group_configs: [],
};

function normalizeWorkspaceData(payload) {
  return {
    plan: payload?.plan ?? null,
    rows: Array.isArray(payload?.rows) ? payload.rows : [],
    sloc_groups: Array.isArray(payload?.sloc_groups) ? payload.sloc_groups : [],
    item_groups: Array.isArray(payload?.item_groups) ? payload.item_groups : [],
    group_configs: Array.isArray(payload?.group_configs) ? payload.group_configs : [],
    // Backend-decided (PROC_PLANNING_VIEW:EDIT via the real ACL snapshot, see
    // canMaintainPlanning() in planning.handlers.ts) -- never re-derived here
    // from role code or work-context name.
    can_maintain: Boolean(payload?.can_maintain),
  };
}

function normalizeHistoryData(payload) {
  return {
    archive: payload?.archive ?? null,
    rows: Array.isArray(payload?.rows) ? payload.rows : [],
    group_configs: Array.isArray(payload?.group_configs) ? payload.group_configs : [],
  };
}

function normalizeStorageLocationPayload(payload) {
  return Array.isArray(payload) ? payload : payload?.data ?? [];
}

function normalizeCollectionPayload(payload) {
  return extractCollectionItems(payload);
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

// Members carry their own real Requirement/Days/Fixed values now (feasibility
// §35.12 rewrite, 2026-08-11) -- a grouped member is no longer a "via group
// total" placeholder, it displays its own entered figure exactly like a
// standalone row. Group Total rows are the derived ones (see
// computeDashboardBlocks): Requirement=SUM (or the direct group-level value
// when no member has one yet), Days=AVERAGE, Fixed Safety/Replenishment=SUM.
function renderPlanningCell(_entry, value, emptyLabel = "-") {
  if (value == null) return emptyLabel;
  return formatQty(value);
}

function renderOptionalPlanningCell(_entry, value) {
  return value == null ? "-" : formatQty(value);
}

function getInitialDraft(row) {
  return {
    id: row.id,
    material_id: row.material_id,
    source_sloc_group_id: row.source_sloc_group_id || "",
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
  return [
    row.material_code,
    row.material_name,
    row.material_external_code,
    row.source_sloc_group_name,
    row.planning_item_group_name,
  ]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(needle));
}

// Item Group Setup's Available Item Pool / Current Members / Standalone
// Materials tables had no search at all (user had to Ctrl+F in the browser,
// which misses anything the table doesn't render). Same substring match as
// Monthly Plan Input's search, scoped to just the material identity fields
// relevant on this tab.
function matchesItemTabSearch(row, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return [row.material_code, row.material_name, row.material_external_code]
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
    const groupKey = String(row.planning_item_group_id || row.planning_item_group_name || "");
    if (groupKey) {
      const bucket = grouped.get(groupKey) || [];
      bucket.push(row);
      grouped.set(groupKey, bucket);
    } else {
      standalone.push({ type: "item", row });
    }
  }

  const blocks = [];
  [...grouped.values()]
    .sort((left, right) =>
      String(left[0]?.planning_item_group_name || "").localeCompare(
        String(right[0]?.planning_item_group_name || "")
      )
    )
    .forEach((items) => {
      const sortedItems = [...items].sort((left, right) => {
        const leftCode = String(left.material_code || "");
        const rightCode = String(right.material_code || "");
        return leftCode.localeCompare(rightCode);
      });
      const groupName = sortedItems[0]?.planning_item_group_name || "";
      sortedItems.forEach((row) => blocks.push({ type: "item", row, groupName }));
      const count = sortedItems.length || 1;
      const matchingConfig =
        groupConfigById.get(String(sortedItems[0]?.planning_item_group_id || "")) ||
        groupConfigByName.get(groupName) ||
        null;
      // Requirement is the one dual-entry-mode field (feasibility §35.12,
      // locked 2026-08-11): if any member has been given its own requirement,
      // that per-item breakdown is the real data and wins (summed). Only when
      // no member carries a value yet does the group-level direct entry
      // (procurement_monthly_plan_group_config, editable at the Group Total
      // row) take over -- a quick-entry mode for groups nobody has broken
      // down by item yet.
      const memberRequirementTotal = sortedItems.reduce(
        (sum, row) => sum + Number(row.monthly_requirement_qty || 0),
        0
      );
      const totalRequirement =
        memberRequirementTotal > 0
          ? memberRequirementTotal
          : Number(matchingConfig?.monthly_requirement_qty || 0);
      // Safety/Proc/Lead Days are always item-wise -- Group Total is always
      // the derived average, never a direct group-level entry.
      const avgSafetyDays = sortedItems.reduce((sum, row) => sum + Number(row.safety_days || 0), 0) / count;
      const avgProcessingDays =
        sortedItems.reduce((sum, row) => sum + Number(row.processing_time_days || 0), 0) / count;
      const avgLeadDays = sortedItems.reduce((sum, row) => sum + Number(row.lead_time_days || 0), 0) / count;
      const avgReplenishmentDays = avgProcessingDays + avgLeadDays;
      const daysInMonth = getDaysInMonth(monthValue);
      const dailyRequirement = daysInMonth > 0 ? totalRequirement / daysInMonth : 0;
      const derivedSafety = dailyRequirement * avgSafetyDays;
      const derivedReplenishment = derivedSafety + dailyRequirement * avgReplenishmentDays;
      // Fixed Safety/Replenishment are always item-wise -- Group Total is
      // always the derived sum of whichever members carry an override, never
      // a direct group-level entry.
      const membersWithFixedSafety = sortedItems.filter((row) => row.fixed_safety_stock_qty != null);
      const fixedSafetyTotal =
        membersWithFixedSafety.length === 0
          ? null
          : membersWithFixedSafety.reduce((sum, row) => sum + Number(row.fixed_safety_stock_qty || 0), 0);
      const membersWithFixedReplenishment = sortedItems.filter(
        (row) => row.fixed_replenishment_stock_qty != null
      );
      const fixedReplenishmentTotal =
        membersWithFixedReplenishment.length === 0
          ? null
          : membersWithFixedReplenishment.reduce(
              (sum, row) => sum + Number(row.fixed_replenishment_stock_qty || 0),
              0
            );
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
        // True once any member has its own requirement entered -- the Group
        // Total's Requirement cell switches from a direct-entry input to a
        // read-only derived sum at that point (see MonthlyInputTable).
        requirementIsDerivedFromMembers: memberRequirementTotal > 0,
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
    id:
      row.id ||
      `${row.material_id || ""}::${row.source_sloc_group_id_snapshot || row.source_sloc_group_name_snapshot || ""}`,
    material_id: row.material_id,
    source_sloc_group_id: row.source_sloc_group_id_snapshot || null,
    material_code: row.material_code_snapshot,
    material_name: row.material_name_snapshot,
    material_external_code: row.material_external_code_snapshot,
    base_uom_code: row.base_uom_code_snapshot,
    planning_item_group_id: row.planning_item_group_id_snapshot || null,
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
              <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Group</th>
              <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Source SLOC Group</th>
              <th className="border px-2 py-2 text-left">Item</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Requirement</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Safety Days</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Proc Days</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Lead Days</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Safety Stock</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Replenishment</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Fixed Safety</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Fixed Replenishment</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Available</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">TRN</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">GE</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">In QA</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Total</th>
              <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Status</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((entry, index) => {
              const isGroupTotal = entry.type === "group-total";
              const row = entry.row;
              return (
                <tr
                  key={`${entry.type}-${entry.groupName || row.id || index}`}
                  className={`${getStatusToneClass(row.status_tone)} ${isGroupTotal ? "font-semibold" : ""}`}
                >
                  <td className="border px-2 py-2 whitespace-nowrap">
                    {entry.groupName || row.planning_item_group_name || "Standalone"}
                  </td>
                  <td className="border px-2 py-2 whitespace-nowrap">
                    {row.source_sloc_group_name || (isGroupTotal ? "Mixed scope" : "Not assigned")}
                  </td>
                  <td className="border px-2 py-2">
                    {isGroupTotal ? (
                      <span>Group Total</span>
                    ) : (
                      <div className="grid gap-[2px]">
                        <span className="font-semibold text-slate-900">
                          {row.material_name} {row.base_uom_code ? `(${row.base_uom_code})` : ""}
                        </span>
                        <span className="text-[11px] text-slate-600">{row.material_external_code || "-"}</span>
                      </div>
                    )}
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
  readOnly = false,
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
              <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Group</th>
              <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Source SLOC Group</th>
              <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Row</th>
              <th className="border px-2 py-2 text-left">Material</th>
              <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Type</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Live Total Stock</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Requirement</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Safety Days</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Proc Days</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Lead Days</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Fixed Safety</th>
              <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Fixed Replenishment</th>
              <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Item Group</th>
              <th className="border px-2 py-2 text-center w-px whitespace-nowrap">Exclude</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((entry, index) => {
              const row = entry.row;
              const isGroupTotal = entry.type === "group-total";
              const draft = !isGroupTotal ? drafts[row.id] || getInitialDraft(row) : null;
              const groupConfigDraft = isGroupTotal
                ? groupConfigDrafts[row.planning_item_group_id] || null
                : null;
              const scopedItemGroups =
                itemGroupsBySloc.get(row.source_sloc_group_id || "__UNSCOPED__") || [];
              return (
                <tr
                  key={`${entry.type}-${entry.groupName || row.id || index}`}
                  className={`${isGroupTotal ? `font-semibold ${getStatusToneClass(row.status_tone)}` : ""}`}
                >
                  <td className="border px-2 py-2 whitespace-nowrap">
                    {entry.groupName || row.planning_item_group_name || "Standalone"}
                  </td>
                  <td className="border px-2 py-2 whitespace-nowrap">
                    {row.source_sloc_group_name || "No SLOC group"}
                  </td>
                  <td className="border px-2 py-2 whitespace-nowrap">
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
                        <span className="font-semibold text-slate-900">
                          {row.material_name} {row.base_uom_code ? `(${row.base_uom_code})` : ""}
                        </span>
                        <span className="text-[11px] text-slate-600">{row.material_external_code || "-"}</span>
                        <span className="text-[11px] text-slate-500">
                          Current status: {getStatusLabel(row.status_tone)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="border px-2 py-2 whitespace-nowrap">{isGroupTotal ? "-" : row.material_type}</td>
                  <td className="border px-2 py-2 text-right">{formatQty(row.total_stock_qty)}</td>
                  {[
                    // Requirement is the one dual-mode field: direct group entry
                    // stays available only while no member has its own value yet
                    // (aggregate: "sum"); the other five are always item-wise,
                    // Group Total is always a derived read-only figure
                    // (aggregate: "avg" for the day fields, "sum" for Fixed).
                    { field: "monthly_requirement_qty", aggregate: "sum", groupDirectEntryAllowed: true },
                    { field: "safety_days", aggregate: "avg", groupDirectEntryAllowed: false },
                    { field: "processing_time_days", aggregate: "avg", groupDirectEntryAllowed: false },
                    { field: "lead_time_days", aggregate: "avg", groupDirectEntryAllowed: false },
                    { field: "fixed_safety_stock_qty", aggregate: "sum", groupDirectEntryAllowed: false },
                    { field: "fixed_replenishment_stock_qty", aggregate: "sum", groupDirectEntryAllowed: false },
                  ].map(({ field, groupDirectEntryAllowed }) => (
                    <td className="border px-2 py-2" key={field}>
                      {isGroupTotal && groupDirectEntryAllowed && !entry.requirementIsDerivedFromMembers ? (
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={groupConfigDraft?.[field] ?? ""}
                          onChange={(event) =>
                            onGroupConfigChange(row.planning_item_group_id, field, event.target.value)
                          }
                          disabled={readOnly}
                          className="w-full border border-slate-300 px-2 py-1 text-right outline-none focus:border-sky-500"
                        />
                      ) : isGroupTotal ? (
                        <div className="grid gap-[1px] text-right">
                          <span className="font-semibold text-slate-900">{formatQty(row[field])}</span>
                          <span className="text-[10px] text-slate-500">
                            {field === "monthly_requirement_qty" ? "sum of items" : "avg/sum of items"}
                          </span>
                        </div>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={draft[field]}
                          onChange={(event) => onChange(row.id, field, event.target.value)}
                          disabled={readOnly}
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
                          onChange(row.id, "planning_item_group_id", event.target.value)
                        }
                        disabled={readOnly}
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
                          onChange(row.id, "excluded_from_dashboard", event.target.checked)
                        }
                        disabled={readOnly}
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

export default function ProcurementPlanningPage() {
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  // Report display is driven by local state, not location.pathname. It used to be
  // `navigate()`-driven to a separate /report route, but that fought this app's
  // screen-stack sync (NavigationStackBridge.jsx) -- the report would render for one
  // frame then get torn down as the stack corrected the URL back to the base screen's
  // registered route, showing as a flicker. Seed from the URL once (so a direct deep
  // link to /report, e.g. via Shift+F8 in a new window, still opens straight into the
  // report), then let the Execute/Back actions flip this in-place -- no navigation
  // involved, so nothing can fight it.
  const isReportRoute = location.pathname.endsWith("/report");
  const [showFullReport, setShowFullReport] = useState(isReportRoute);
  const [companyId, setCompanyId] = useState("");
  const [planMonth, setPlanMonth] = useState(getMonthValue(""));
  const [activeTab, setActiveTab] = useState("dashboard");
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
  // Only filters which rows are VISIBLE in the Available Item Pool below --
  // staged Add/Remove decisions live in lineDrafts (see assignItemGroup/
  // unassignItemGroup), which this filter never touches, so switching between
  // RM and PM here never loses anything already staged for the other type.
  // One "Save Item Group Mapping" click still commits all of it together.
  const [itemPoolMaterialTypeFilter, setItemPoolMaterialTypeFilter] = useState("ALL");
  // Filters Available Item Pool / Current Members / Standalone Materials
  // together on the Item Group Setup tab -- previously no search existed
  // here at all.
  const [itemTabSearch, setItemTabSearch] = useState("");
  // SLOC Group Setup's own Include/Exclude member management (feasibility
  // §35.11.1 addendum, 2026-08-11): which group's material list is currently
  // being reviewed. New items auto-include into a SLOC group's eligible pool;
  // this lets the user manually exclude specific materials from planning
  // scope (and re-include later) without leaving this tab -- previously the
  // only way to toggle this was a checkbox buried in the 75-row Monthly Plan
  // Input grid.
  const [materialManagerSlocGroupId, setMaterialManagerSlocGroupId] = useState("");
  const [slocMaterialSearch, setSlocMaterialSearch] = useState("");
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const effectiveCompanyId = companyId || defaultCompanyId;
  const planMonthValue = getMonthValue(planMonth);
  const workspaceQueryKey = ["po11", "workspace", effectiveCompanyId || "", planMonthValue];
  const historyQueryKey = ["po11", "history", effectiveCompanyId || "", planMonthValue];
  const storageLocationsQueryKey = ["po11", "storage-locations", effectiveCompanyId || ""];
  const slocGroupsQueryKey = ["po11", "sloc-groups", effectiveCompanyId || ""];
  const itemGroupsQueryKey = ["po11", "item-groups", effectiveCompanyId || ""];

  function fetchWorkspace() {
    return getProcurementPlanning({
      company_id: effectiveCompanyId,
      plan_month: `${planMonthValue}-01`,
    });
  }

  function fetchPlanningHistory() {
    return getProcurementPlanningHistory({
      company_id: effectiveCompanyId,
      plan_month: `${planMonthValue}-01`,
    });
  }

  function fetchStorageLocations() {
    return listStorageLocations({
      company_id: effectiveCompanyId,
      is_active: true,
    });
  }

  function fetchSlocGroups() {
    return listProcurementPlanningSlocGroups({
      company_id: effectiveCompanyId,
    });
  }

  function fetchItemGroups() {
    return listProcurementPlanningItemGroups({
      company_id: effectiveCompanyId,
    });
  }

  const workspaceQuery = useQuery({
    queryKey: workspaceQueryKey,
    queryFn: fetchWorkspace,
    enabled: Boolean(effectiveCompanyId),
    select: normalizeWorkspaceData,
  });

  const storageLocationsQuery = useQuery({
    queryKey: storageLocationsQueryKey,
    queryFn: fetchStorageLocations,
    enabled: Boolean(effectiveCompanyId),
    select: normalizeStorageLocationPayload,
  });

  const slocGroupsQuery = useQuery({
    queryKey: slocGroupsQueryKey,
    queryFn: fetchSlocGroups,
    enabled: Boolean(effectiveCompanyId),
    select: normalizeCollectionPayload,
  });

  const itemGroupsQuery = useQuery({
    queryKey: itemGroupsQueryKey,
    queryFn: fetchItemGroups,
    enabled: Boolean(effectiveCompanyId),
    select: normalizeCollectionPayload,
  });

  const historyQuery = useQuery({
    queryKey: historyQueryKey,
    queryFn: fetchPlanningHistory,
    enabled: Boolean(effectiveCompanyId) && activeTab === "history",
    select: normalizeHistoryData,
  });

  const workspace = workspaceQuery.data ?? EMPTY_WORKSPACE;
  const storageLocations = storageLocationsQuery.data ?? [];
  // workspace.sloc_groups/item_groups (embedded in the same getProcurementPlanning()
  // response used for everything else on this page) is the authoritative source -- the
  // standalone slocGroupsQuery/itemGroupsQuery below exist only to prime the parent-SLOC
  // picker before the workspace call resolves. Both selects always return an array
  // (never undefined, see normalizeCollectionPayload), so workspace was previously dead
  // once the standalone query settled -- if that separate fetch ever returned stale/empty
  // data for any reason (timing, a transient error swallowed into []), it silently
  // overrode a workspace response that had the real groups. Precedence flipped so a
  // populated workspace always wins.
  const slocGroups = workspace.sloc_groups?.length ? workspace.sloc_groups : slocGroupsQuery.data ?? [];
  const itemGroups = workspace.item_groups?.length ? workspace.item_groups : itemGroupsQuery.data ?? [];
  // Backend-decided (PROC_PLANNING_VIEW:EDIT via the real ACL snapshot) --
  // never guessed here from role code or work-context name. Defaults to
  // false until the workspace call resolves, which is the safe direction:
  // maintenance controls stay hidden rather than flashing on for a user who
  // turns out not to have EDIT.
  const canMaintainWorkspace = Boolean(workspace.can_maintain);
  const historyData = historyQuery.data ?? EMPTY_HISTORY;
  const historyRows = historyData.rows;
  const historyGroupConfigs = historyData.group_configs;
  const historyMeta = historyData.archive;
  const queryError =
    (workspaceQuery.error instanceof Error ? workspaceQuery.error.message : "") ||
    (storageLocationsQuery.error instanceof Error ? storageLocationsQuery.error.message : "") ||
    (slocGroupsQuery.error instanceof Error ? slocGroupsQuery.error.message : "") ||
    (itemGroupsQuery.error instanceof Error ? itemGroupsQuery.error.message : "") ||
    (activeTab === "history" && historyQuery.error instanceof Error ? historyQuery.error.message : "");
  const activeError = error || queryError;
  const refreshing =
    workspaceQuery.isFetching ||
    storageLocationsQuery.isFetching ||
    slocGroupsQuery.isFetching ||
    itemGroupsQuery.isFetching ||
    (activeTab === "history" && historyQuery.isFetching);
  useEffect(() => {
    if (!companyId) {
      const routeCompanyId = String(searchParams.get("company_id") || "").trim();
      if (routeCompanyId) {
        setCompanyId(routeCompanyId);
        return;
      }
      const selectedCompany = String(runtimeContext?.selectedCompanyId ?? "").trim();
      if (selectedCompany) {
        setCompanyId(selectedCompany);
        return;
      }
      if (defaultCompanyId) {
        setCompanyId(defaultCompanyId);
      }
    }
  }, [companyId, defaultCompanyId, runtimeContext, searchParams]);

  useEffect(() => {
    const routeMonth = getMonthValue(searchParams.get("plan_month") || "");
    if (routeMonth && routeMonth !== planMonth) {
      setPlanMonth(routeMonth);
    }
  }, [planMonth, searchParams]);

  useEffect(() => {
    if (!showFullReport) return;
    setActiveTab("dashboard");
    setDashboardFilters((current) => ({
      ...current,
      slocGroupId: String(searchParams.get("sloc_group_id") || ""),
      materialType: String(searchParams.get("material_type") || "ALL"),
    }));
  }, [showFullReport, searchParams]);

  useEffect(() => {
    setSlocGroupForm({ id: "", group_name: "", storage_location_ids: [] });
    setItemGroupForm({ id: "", group_name: "", sloc_group_id: "" });
    setSelectedItemGroupId("");
    setItemManagerSlocGroupId("");
    setItemTabSearch("");
    setMaterialManagerSlocGroupId("");
    setSlocMaterialSearch("");
    setDashboardFilters((current) => ({
      ...current,
      slocGroupId: "",
      slocGroups: [],
    }));
    setInputFilters({
      query: "",
      slocGroupId: "",
      itemGroupId: "",
      materialType: "ALL",
      showUngroupedOnly: false,
      showExcludedOnly: false,
    });
  }, [companyId]);

  useEffect(() => {
    const nextDrafts = {};
    (workspace.rows || []).forEach((row) => {
      nextDrafts[row.id] = getInitialDraft(row);
    });
    setLineDrafts(nextDrafts);
  }, [workspace.rows]);

  useEffect(() => {
    const nextGroupConfigDrafts = {};
    itemGroups.forEach((group) => {
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
  }, [itemGroups, workspace.group_configs]);

  useEffect(() => {
    setDashboardFilters((current) => ({
      ...current,
      slocGroups,
    }));
  }, [slocGroups]);

  useEffect(() => {
    if (!slocGroups.length) {
      setItemManagerSlocGroupId("");
      return;
    }
    setItemManagerSlocGroupId((current) => {
      if (current && slocGroups.some((group) => group.id === current)) return current;
      return slocGroups[0]?.id || "";
    });
  }, [slocGroups]);

  async function refreshWorkspaceView() {
    if (!effectiveCompanyId) return;
    await Promise.all([
      workspaceQuery.refetch(),
      storageLocationsQuery.refetch(),
      slocGroupsQuery.refetch(),
      itemGroupsQuery.refetch(),
      activeTab === "history" ? historyQuery.refetch() : Promise.resolve(),
    ]);
  }

  function handleDraftChange(lineId, field, value) {
    setLineDrafts((current) => ({
      ...current,
      [lineId]: {
        ...(current[lineId] || {}),
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
      queryClient.setQueryData(workspaceQueryKey, (current) => {
        const base = normalizeWorkspaceData(current);
        return {
          ...base,
          rows: Array.isArray(result?.rows) ? result.rows : base.rows,
          group_configs: Array.isArray(result?.group_configs)
            ? result.group_configs
            : base.group_configs,
        };
      });
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKey });
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
      setActiveTab("history");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceQueryKey }),
        queryClient.invalidateQueries({ queryKey: historyQueryKey }),
      ]);
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
        queryClient.setQueryData(slocGroupsQueryKey, savedGroups);
        queryClient.setQueryData(workspaceQueryKey, (current) => ({
          ...normalizeWorkspaceData(current),
          sloc_groups: savedGroups,
        }));
      }
      setSlocGroupForm({ id: "", group_name: "", storage_location_ids: [] });
      setMessage("Planning SLOC group saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceQueryKey }),
        queryClient.invalidateQueries({ queryKey: slocGroupsQueryKey }),
      ]);
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
      if (savedGroups.length > 0 || slocGroups.length > 0) {
        queryClient.setQueryData(slocGroupsQueryKey, savedGroups);
        queryClient.setQueryData(workspaceQueryKey, (current) => ({
          ...normalizeWorkspaceData(current),
          sloc_groups: savedGroups,
        }));
      }
      setSlocGroupForm({ id: "", group_name: "", storage_location_ids: [] });
      setMessage("Planning SLOC group deleted.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceQueryKey }),
        queryClient.invalidateQueries({ queryKey: slocGroupsQueryKey }),
        queryClient.invalidateQueries({ queryKey: itemGroupsQueryKey }),
      ]);
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
      let savedItemGroups = [];
      if (itemGroupForm.id) {
        savedItemGroups = extractCollectionItems(await updateProcurementPlanningItemGroup(itemGroupForm.id, {
          sloc_group_id: itemGroupForm.sloc_group_id,
          group_name: itemGroupForm.group_name,
        }));
      } else {
        savedItemGroups = extractCollectionItems(await createProcurementPlanningItemGroup({
          company_id: effectiveCompanyId,
          sloc_group_id: itemGroupForm.sloc_group_id,
          group_name: itemGroupForm.group_name,
        }));
      }
      if (savedItemGroups.length > 0) {
        queryClient.setQueryData(itemGroupsQueryKey, savedItemGroups);
        queryClient.setQueryData(workspaceQueryKey, (current) => ({
          ...normalizeWorkspaceData(current),
          item_groups: savedItemGroups,
        }));
      }
      setItemGroupForm({ id: "", group_name: "", sloc_group_id: "" });
      setMessage("Planning item group saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceQueryKey }),
        queryClient.invalidateQueries({ queryKey: itemGroupsQueryKey }),
      ]);
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
      const savedItemGroups = extractCollectionItems(await deleteProcurementPlanningItemGroup(id));
      if (savedItemGroups.length > 0 || itemGroups.length > 0) {
        queryClient.setQueryData(itemGroupsQueryKey, savedItemGroups);
        queryClient.setQueryData(workspaceQueryKey, (current) => ({
          ...normalizeWorkspaceData(current),
          item_groups: savedItemGroups,
        }));
      }
      setItemGroupForm({ id: "", group_name: "", sloc_group_id: "" });
      if (selectedItemGroupId === id) setSelectedItemGroupId("");
      setMessage("Planning item group deleted.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceQueryKey }),
        queryClient.invalidateQueries({ queryKey: itemGroupsQueryKey }),
      ]);
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

  function jumpToItemGroupManage(slocGroupId) {
    setItemManagerSlocGroupId(slocGroupId || "");
    setSelectedItemGroupId("");
    setActiveTab("item");
  }

  function handleDashboardFilterChange(field, value) {
    setDashboardFilters((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function openPlanningReport() {
    if (!effectiveCompanyId) {
      setError("Select company first.");
      return;
    }
    // Flip local state first -- this is what actually drives the render. The
    // navigate() call below only updates the address bar (for bookmarking /
    // Shift+F8-into-a-new-window) and runs with replace so it never becomes a
    // back-button trap; it does not gate anything here.
    setShowFullReport(true);
    const params = new URLSearchParams();
    params.set("company_id", effectiveCompanyId);
    params.set("plan_month", planMonthValue);
    if (dashboardFilters.slocGroupId) params.set("sloc_group_id", dashboardFilters.slocGroupId);
    if (dashboardFilters.materialType && dashboardFilters.materialType !== "ALL") {
      params.set("material_type", dashboardFilters.materialType);
    }
    navigate(`/dashboard/procurement/planning/report?${params.toString()}`, { replace: true });
  }

  function handleBackToPlanningFilters() {
    setShowFullReport(false);
    const params = new URLSearchParams();
    if (effectiveCompanyId) params.set("company_id", effectiveCompanyId);
    params.set("plan_month", planMonthValue);
    if (dashboardFilters.slocGroupId) params.set("sloc_group_id", dashboardFilters.slocGroupId);
    if (dashboardFilters.materialType && dashboardFilters.materialType !== "ALL") {
      params.set("material_type", dashboardFilters.materialType);
    }
    navigate(`/dashboard/procurement/planning?${params.toString()}`, { replace: true });
  }

  function assignItemGroup(lineId, groupId) {
    handleDraftChange(lineId, "planning_item_group_id", groupId);
  }

  function unassignItemGroup(lineId) {
    handleDraftChange(lineId, "planning_item_group_id", "");
  }

  const tabs = useMemo(
    () => (showFullReport
      ? [{ id: "dashboard", label: "Planning Dashboard Report" }]
      : [
      { id: "dashboard", label: "Planning Dashboard" },
      { id: "input", label: "Monthly Plan Input" },
      ...(canMaintainWorkspace ? [{ id: "sloc", label: "SLOC Group Setup" }] : []),
      ...(canMaintainWorkspace ? [{ id: "item", label: "Item Group Setup" }] : []),
      { id: "history", label: "History / Archive" },
    ]),
    [canMaintainWorkspace, showFullReport]
  );

  const itemGroupsById = useMemo(() => {
    return new Map(itemGroups.map((group) => [group.id, group]));
  }, [itemGroups]);

  const effectiveRows = useMemo(() => {
    return (workspace.rows || []).map((row) =>
      applyDraftToRow(row, lineDrafts[row.id], itemGroupsById)
    );
  }, [itemGroupsById, lineDrafts, workspace.rows]);

  const planningSummary = useMemo(() => {
    const rows = effectiveRows || [];
    return {
      totalRows: rows.length,
      slocGroups: slocGroups.length,
      itemGroups: itemGroups.length,
      groupedRows: rows.filter((row) => row.planning_item_group_id).length,
      standaloneRows: rows.filter((row) => !row.planning_item_group_id).length,
      excludedRows: rows.filter((row) => row.excluded_from_dashboard).length,
      criticalRows: rows.filter((row) => row.status_tone === "CRITICAL").length,
      warningRows: rows.filter((row) => row.status_tone === "WARNING").length,
    };
  }, [effectiveRows, itemGroups.length, slocGroups.length]);
  const slocGroupInsights = useMemo(() => {
    return slocGroups.map((group) => {
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
  }, [effectiveRows, slocGroups]);

  const itemGroupInsights = useMemo(() => {
    return itemGroups.map((group) => {
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
  }, [effectiveRows, itemGroups]);

  const selectedItemGroup = useMemo(() => {
    return itemGroups.find((group) => group.id === selectedItemGroupId) || null;
  }, [selectedItemGroupId, itemGroups]);

  useEffect(() => {
    if (selectedItemGroup?.sloc_group_id) {
      setItemManagerSlocGroupId(selectedItemGroup.sloc_group_id);
    }
  }, [selectedItemGroup]);

  const selectedSlocGroupIdForItems = itemManagerSlocGroupId || slocGroups[0]?.id || "";

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
  const filteredAvailableItemPool = useMemo(() => {
    const typeMatched =
      itemPoolMaterialTypeFilter === "ALL"
        ? availableItemPool
        : availableItemPool.filter((row) => row.material_type === itemPoolMaterialTypeFilter);
    return typeMatched.filter((row) => matchesItemTabSearch(row, itemTabSearch));
  }, [availableItemPool, itemPoolMaterialTypeFilter, itemTabSearch]);
  const filteredSelectedItemGroupMembers = useMemo(() => {
    return selectedItemGroupMembers.filter((row) => matchesItemTabSearch(row, itemTabSearch));
  }, [selectedItemGroupMembers, itemTabSearch]);
  const scopedStandaloneRows = useMemo(() => {
    return [...availableItemPool].sort((left, right) =>
      String(left.material_code).localeCompare(String(right.material_code))
    );
  }, [availableItemPool]);
  const filteredScopedStandaloneRows = useMemo(() => {
    return scopedStandaloneRows.filter((row) => matchesItemTabSearch(row, itemTabSearch));
  }, [scopedStandaloneRows, itemTabSearch]);
  const scopedItemGroups = useMemo(() => {
    return itemGroups.filter((group) => group.sloc_group_id === selectedSlocGroupIdForItems);
  }, [itemGroups, selectedSlocGroupIdForItems]);

  // SLOC Group Setup's Include/Exclude work area -- all materials whose
  // eligibility flows from the selected SLOC group, split by their current
  // excluded_from_dashboard flag. Unlike the Item Group tab this ignores
  // planning_item_group_id entirely -- exclude/include applies regardless of
  // whether the material is grouped or standalone.
  const slocMaterialRows = useMemo(() => {
    if (!materialManagerSlocGroupId) return [];
    return effectiveRows
      .filter((row) => row.source_sloc_group_id === materialManagerSlocGroupId)
      .filter((row) => matchesItemTabSearch(row, slocMaterialSearch))
      .sort((left, right) => String(left.material_code).localeCompare(String(right.material_code)));
  }, [effectiveRows, materialManagerSlocGroupId, slocMaterialSearch]);
  const includedSlocMaterialRows = useMemo(
    () => slocMaterialRows.filter((row) => !row.excluded_from_dashboard),
    [slocMaterialRows]
  );
  const excludedSlocMaterialRows = useMemo(
    () => slocMaterialRows.filter((row) => row.excluded_from_dashboard),
    [slocMaterialRows]
  );

  const historyBlocks = useMemo(() => {
    return computeDashboardBlocks(
      normalizeHistoryRows(historyRows),
      planMonthValue,
      normalizeHistoryGroupConfigs(historyGroupConfigs)
    );
  }, [historyGroupConfigs, historyRows, planMonthValue]);
  const historySummary = useMemo(() => summarizeDecisionBlocks(historyBlocks), [historyBlocks]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("dashboard");
    }
  }, [activeTab, tabs]);

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Procurement Planning Workspace"
      actions={[
        ...(showFullReport
          ? [
              {
                key: "back-to-filters",
                label: "Back to Filters",
                tone: "neutral",
                onClick: handleBackToPlanningFilters,
              },
            ]
          : []),
        {
          key: "refresh",
          label: refreshing ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void refreshWorkspaceView(),
        },
        ...(activeTab === "dashboard" && !showFullReport
          ? [
              {
                key: "execute-report",
                label: "Execute Full Report",
                tone: "primary",
                onClick: openPlanningReport,
              },
            ]
          : []),
        ...(activeTab === "input" && canMaintainWorkspace
          ? [
              {
                key: "save-lines",
                label: saving ? "Saving..." : "Save Monthly Plan",
                tone: "primary",
                onClick: () => void handleSaveLines(),
              },
            ]
          : []),
        ...(activeTab === "item" && canMaintainWorkspace
          ? [
              {
                key: "save-item-membership",
                label: saving ? "Saving..." : "Save Item Group Mapping",
                tone: "primary",
                onClick: () => void handleSaveLines(),
              },
            ]
          : []),
        ...(activeTab === "sloc" && canMaintainWorkspace
          ? [
              {
                key: "save-material-inclusion",
                label: saving ? "Saving..." : "Save Material Inclusion",
                tone: "primary",
                onClick: () => void handleSaveLines(),
              },
            ]
          : []),
        ...(activeTab !== "history" && canMaintainWorkspace
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
        ...(activeError ? [{ key: "planning-error", tone: "error", message: activeError }] : []),
        ...(message ? [{ key: "planning-message", tone: "success", message }] : []),
      ]}
      filterSection={{
        eyebrow: showFullReport ? "Report Controls" : "Controls",
        title: showFullReport ? "Company / Month" : "Company / Month / Workspace",
        children: showFullReport ? (
          // Genuine report chrome (matches the IN02/IN03 RESULTS-state pattern) --
          // no workspace tab row (there's only one tab here, "Planning Dashboard
          // Report", so a button for it is pointless), no editing-workspace chip
          // row (Status/Access/Rows/SLOC Groups/Item Groups -- none of that is
          // report-relevant). Company and Month stay directly editable right here,
          // and DashboardTable's own SLOC Group/Material Type filters plus its own
          // summary chips (Visible Decisions/Grouped Pools/Critical/Replenish) live
          // in listSection below -- nothing duplicated.
          <div className="grid gap-3 lg:grid-cols-[220px_200px]">
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
          </div>
        ) : (
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
                {
                  label: "Access",
                  value: canMaintainWorkspace ? "Maintenance" : "View Only",
                },
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
            {activeTab === "dashboard" && showFullReport ? (
              <DashboardTable
                rows={effectiveRows}
                monthValue={planMonthValue}
                filters={dashboardFilters}
                onFilterChange={handleDashboardFilterChange}
                groupConfigs={Object.values(groupConfigDrafts)}
              />
            ) : null}

            {activeTab === "dashboard" && !showFullReport ? (
              <div className="grid gap-4">
                <div className="rounded border border-slate-200 bg-white p-4">
                  <div className="grid gap-3 lg:grid-cols-[220px_220px_auto]">
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-medium text-slate-800">SLOC Group</span>
                      <select
                        value={dashboardFilters.slocGroupId}
                        onChange={(event) => handleDashboardFilterChange("slocGroupId", event.target.value)}
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
                      <span className="font-medium text-slate-800">Material Type</span>
                      <select
                        value={dashboardFilters.materialType}
                        onChange={(event) => handleDashboardFilterChange("materialType", event.target.value)}
                        className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                      >
                        <option value="ALL">All</option>
                        <option value="RM">RM</option>
                        <option value="PM">PM</option>
                      </select>
                    </label>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={openPlanningReport}
                        className="h-10 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950"
                      >
                        Execute Full Report
                      </button>
                    </div>
                  </div>
                </div>
                <div className="rounded border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                  Choose company, month, SLOC group, and RM/PM scope, then execute the full-page report. The report opens on its own route so the current report view can also be opened in a new ERP window with <span className="font-semibold text-slate-700">Shift+F8</span>.
                </div>
              </div>
            ) : null}

            {activeTab === "input" ? (
              <MonthlyInputTable
                rows={effectiveRows}
                itemGroups={itemGroups}
                slocGroups={slocGroups}
                drafts={lineDrafts}
                groupConfigDrafts={groupConfigDrafts}
                filters={{ ...inputFilters, monthValue: planMonthValue }}
                onChange={handleDraftChange}
                onGroupConfigChange={handleGroupConfigChange}
                onFilterChange={handleInputFilterChange}
                onClearFilters={clearInputFilters}
                readOnly={!canMaintainWorkspace}
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
                    <div key={group.id} className="grid gap-1 border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="grid gap-1">
                          <h3 className="text-sm font-semibold text-slate-900">{group.group_name}</h3>
                          <p className="text-xs text-slate-500">
                            {group.member_count} storage location{group.member_count === 1 ? "" : "s"} selected
                            {" | "}
                            {group.linkedMaterialCount} eligible material{group.linkedMaterialCount === 1 ? "" : "s"}
                            {" ("}
                            {group.groupedMaterialCount} grouped, {group.excludedMaterialCount} excluded
                            {")"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => jumpToItemGroupManage(group.id)}
                            className="border border-sky-700 bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-950"
                          >
                            Manage
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMaterialManagerSlocGroupId(group.id);
                              setSlocMaterialSearch("");
                            }}
                            className="border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                          >
                            Manage Materials
                          </button>
                          <button
                            type="button"
                            onClick={() => jumpToMonthlyInput({ slocGroupId: group.id })}
                            className="border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                          >
                            Open in Monthly Plan
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSlocGroupForm({
                                id: group.id,
                                group_name: group.group_name,
                                storage_location_ids: group.storage_locations.map((location) => location.id),
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
                    </div>
                  ))}
                  {slocGroupInsights.length === 0 ? (
                    <div className="rounded border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                      No planning SLOC group exists yet. Create one first, then open Monthly Plan Input to review the auto-included RM/PM list.
                    </div>
                  ) : null}

                  {materialManagerSlocGroupId ? (
                    <div className="grid gap-3 border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="grid gap-1">
                          <h3 className="text-sm font-semibold text-slate-900">
                            Manage Materials --{" "}
                            {slocGroups.find((group) => group.id === materialManagerSlocGroupId)?.group_name ||
                              "Selected SLOC Group"}
                          </h3>
                          <p className="text-xs text-slate-500">
                            New materials that land in this group's storage locations auto-include here. Exclude a
                            material to drop it from this month's planning (Monthly Plan Input/Planning Dashboard) --
                            it can be included again anytime. Grouped or standalone doesn't matter here.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setMaterialManagerSlocGroupId("")}
                          className="border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                        >
                          Close
                        </button>
                      </div>
                      <label className="grid gap-1 text-sm text-slate-700">
                        <span className="font-medium text-slate-800">Search Material</span>
                        <input
                          value={slocMaterialSearch}
                          onChange={(event) => setSlocMaterialSearch(event.target.value)}
                          placeholder="Type material code, name, or external code..."
                          className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                        />
                      </label>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h4 className="text-sm font-semibold text-slate-900">Included</h4>
                            <span className="text-xs text-slate-500">{includedSlocMaterialRows.length} item(s)</span>
                          </div>
                          <div className="overflow-auto border border-slate-200 bg-white">
                            <table className="min-w-full text-xs">
                              <thead className="bg-slate-100 text-slate-700">
                                <tr>
                                  <th className="border px-2 py-1.5 text-left">Material</th>
                                  <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap">Type</th>
                                  <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {includedSlocMaterialRows.map((row) => (
                                  <tr key={row.id}>
                                    <td className="border px-2 py-1.5">
                                      <div className="grid gap-[1px]">
                                        <span className="font-semibold text-slate-900">{row.material_name}</span>
                                        <span className="text-[10px] text-slate-500">
                                          {row.material_external_code || "-"}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="border px-2 py-1.5 whitespace-nowrap">{row.material_type}</td>
                                    <td className="border px-2 py-1.5 whitespace-nowrap">
                                      <button
                                        type="button"
                                        onClick={() => handleDraftChange(row.id, "excluded_from_dashboard", true)}
                                        disabled={!canMaintainWorkspace}
                                        className="border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
                                      >
                                        Exclude
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                                {includedSlocMaterialRows.length === 0 ? (
                                  <tr>
                                    <td className="border px-2 py-3 text-slate-500" colSpan={3}>
                                      No included material matches the current search.
                                    </td>
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h4 className="text-sm font-semibold text-slate-900">Excluded</h4>
                            <span className="text-xs text-slate-500">{excludedSlocMaterialRows.length} item(s)</span>
                          </div>
                          <div className="overflow-auto border border-slate-200 bg-white">
                            <table className="min-w-full text-xs">
                              <thead className="bg-slate-100 text-slate-700">
                                <tr>
                                  <th className="border px-2 py-1.5 text-left">Material</th>
                                  <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap">Type</th>
                                  <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {excludedSlocMaterialRows.map((row) => (
                                  <tr key={row.id}>
                                    <td className="border px-2 py-1.5">
                                      <div className="grid gap-[1px]">
                                        <span className="font-semibold text-slate-900">{row.material_name}</span>
                                        <span className="text-[10px] text-slate-500">
                                          {row.material_external_code || "-"}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="border px-2 py-1.5 whitespace-nowrap">{row.material_type}</td>
                                    <td className="border px-2 py-1.5 whitespace-nowrap">
                                      <button
                                        type="button"
                                        onClick={() => handleDraftChange(row.id, "excluded_from_dashboard", false)}
                                        disabled={!canMaintainWorkspace}
                                        className="border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800"
                                      >
                                        Include
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                                {excludedSlocMaterialRows.length === 0 ? (
                                  <tr>
                                    <td className="border px-2 py-3 text-slate-500" colSpan={3}>
                                      No material is excluded from this SLOC group yet.
                                    </td>
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Changes above are staged like any other planning edit -- click "Save Material Inclusion" to
                        commit them for {planMonthValue}.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {activeTab === "item" ? (
              <div className="grid gap-4">
                <div className="grid gap-3 border border-slate-200 bg-white p-4">
                  <div className="grid gap-3 lg:grid-cols-[220px_220px_minmax(0,1fr)_auto]">
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
                        {slocGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.group_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-medium text-slate-800">Item Group Name</span>
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
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveItemGroup()}
                        className="h-10 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950"
                      >
                        {itemGroupForm.id ? "Update Item Group" : "Create Item Group"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setItemGroupForm({ id: "", group_name: "", sloc_group_id: "" })}
                        className="h-10 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Create or update the item group directly where the parent SLOC-group scope is selected, then manage member mapping below.
                  </p>
                </div>
                {/* Work area comes first -- this is what the user actually does on this
                    page. The existing-groups list is secondary and now sits below as a
                    compact table, not stacked full-width cards pushing the real work down. */}
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
                        {slocGroups.map((group) => (
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
                        {itemGroups
                          .filter((group) => group.sloc_group_id === selectedSlocGroupIdForItems)
                          .map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.group_name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-medium text-slate-800">Search Material</span>
                      <input
                        value={itemTabSearch}
                        onChange={(event) => setItemTabSearch(event.target.value)}
                        placeholder="Type material code, name, or external code..."
                        className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                      />
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
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-slate-900">Available Item Pool</h3>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-xs text-slate-600">
                              Material Type
                              <select
                                value={itemPoolMaterialTypeFilter}
                                onChange={(event) => setItemPoolMaterialTypeFilter(event.target.value)}
                                className="h-7 border border-slate-300 bg-white px-1.5 text-xs outline-none focus:border-sky-500"
                              >
                                <option value="ALL">All</option>
                                <option value="RM">RM</option>
                                <option value="PM">PM</option>
                              </select>
                            </label>
                            <span className="text-xs text-slate-500">{filteredAvailableItemPool.length} item(s)</span>
                          </div>
                        </div>
                        <div className="overflow-auto border border-slate-200 bg-white">
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-100 text-slate-700">
                              <tr>
                                <th className="border px-2 py-1.5 text-left">Material</th>
                                <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap">Type</th>
                                <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap">Status</th>
                                <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredAvailableItemPool.map((row) => (
                                <tr key={row.id}>
                                  <td className="border px-2 py-1.5">
                                    <div className="grid gap-[1px]">
                                      <span className="font-semibold text-slate-900">{row.material_name}</span>
                                      <span className="text-[10px] text-slate-500">
                                        {row.material_external_code || "-"}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="border px-2 py-1.5 whitespace-nowrap">{row.material_type}</td>
                                  <td className="border px-2 py-1.5 whitespace-nowrap">Standalone</td>
                                  <td className="border px-2 py-1.5 whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => assignItemGroup(row.id, selectedItemGroupId)}
                                      className="border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800"
                                    >
                                      Add
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              {filteredAvailableItemPool.length === 0 ? (
                                <tr>
                                  <td className="border px-2 py-3 text-slate-500" colSpan={4}>
                                    {availableItemPool.length === 0
                                      ? "No standalone item is available in this SLOC group scope."
                                      : "No item matches the current filter."}
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-slate-900">Current Members</h3>
                          <span className="text-xs text-slate-500">{selectedItemGroupMembers.length} item(s)</span>
                        </div>
                        <div className="overflow-auto border border-slate-200 bg-white">
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-100 text-slate-700">
                              <tr>
                                <th className="border px-2 py-1.5 text-left">Material</th>
                                <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap">Type</th>
                                <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap">Status</th>
                                <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredSelectedItemGroupMembers.map((row) => (
                                <tr key={row.id}>
                                  <td className="border px-2 py-1.5">
                                    <div className="grid gap-[1px]">
                                      <span className="font-semibold text-slate-900">{row.material_name}</span>
                                      <span className="text-[10px] text-slate-500">
                                        {row.material_external_code || "-"}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="border px-2 py-1.5 whitespace-nowrap">{row.material_type}</td>
                                  <td className="border px-2 py-1.5 whitespace-nowrap">Group Member</td>
                                  <td className="border px-2 py-1.5 whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => unassignItemGroup(row.id)}
                                      className="border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              {filteredSelectedItemGroupMembers.length === 0 ? (
                                <tr>
                                  <td className="border px-2 py-3 text-slate-500" colSpan={4}>
                                    {selectedItemGroupMembers.length === 0
                                      ? "No member is mapped to this item group yet."
                                      : "No member matches the current search."}
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
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
                      onClick={() =>
                        jumpToMonthlyInput({
                          slocGroupId: selectedSlocGroupIdForItems,
                          showUngroupedOnly: true,
                        })
                      }
                      className="border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                    >
                      Review Standalone
                    </button>
                  </div>
                  <div className="overflow-auto border border-slate-200 bg-white">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="border px-2 py-1.5 text-left">Material</th>
                          <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap">Type</th>
                          <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredScopedStandaloneRows.slice(0, 16).map((row) => (
                          <tr key={row.id}>
                            <td className="border px-2 py-1.5">
                              <div className="grid gap-[1px]">
                                <span className="font-semibold text-slate-900">{row.material_name}</span>
                                <span className="text-[10px] text-slate-500">{row.material_external_code || "-"}</span>
                              </div>
                            </td>
                            <td className="border px-2 py-1.5 whitespace-nowrap">{row.material_type}</td>
                            <td className="border px-2 py-1.5 whitespace-nowrap">Standalone</td>
                          </tr>
                        ))}
                        {filteredScopedStandaloneRows.length === 0 ? (
                          <tr>
                            <td className="border px-2 py-3 text-slate-500" colSpan={3}>
                              {scopedStandaloneRows.length === 0
                                ? "Every visible material in this SLOC scope is already assigned to a planning item group."
                                : "No standalone material matches the current search."}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                    {filteredScopedStandaloneRows.length > 16 ? (
                      <p className="border-t border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                        Showing 16 of {filteredScopedStandaloneRows.length}. Use "Review Standalone" to see the full list in Monthly Plan Input.
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Existing item groups -- compact list, secondary to the work area above. */}
                <div className="overflow-auto border border-slate-200 bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="border px-2 py-1.5 text-left">Item Group</th>
                        <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap">Source SLOC Group</th>
                        <th className="border px-2 py-1.5 text-right w-px whitespace-nowrap">Members</th>
                        <th className="border px-2 py-1.5 text-left w-px whitespace-nowrap"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemGroupInsights.map((group) => (
                        <tr key={group.id}>
                          <td className="border px-2 py-1.5 font-semibold text-slate-900">{group.group_name}</td>
                          <td className="border px-2 py-1.5 whitespace-nowrap">{group.sloc_group_name || "-"}</td>
                          <td className="border px-2 py-1.5 text-right">{group.memberCount}</td>
                          <td className="border px-2 py-1.5 whitespace-nowrap">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedItemGroupId(group.id);
                                  setItemManagerSlocGroupId(group.sloc_group_id || "");
                                }}
                                className="border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800"
                              >
                                Manage
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setItemGroupForm({
                                    id: group.id,
                                    group_name: group.group_name,
                                    sloc_group_id: group.sloc_group_id || "",
                                  })
                                }
                                className="border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteItemGroup(group.id)}
                                className="border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {itemGroupInsights.length === 0 ? (
                        <tr>
                          <td className="border px-2 py-3 text-slate-500" colSpan={4}>
                            No item group exists yet for this company.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
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
                        <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Group</th>
                        <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Source SLOC Group</th>
                        <th className="border px-2 py-2 text-left">Item</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Requirement</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Safety Days</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Proc Days</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Lead Days</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Safety Stock</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Replenishment</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Fixed Safety</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Fixed Replenishment</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Available</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">TRN</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">GE</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">In QA</th>
                        <th className="border px-2 py-2 text-right w-px whitespace-nowrap">Total</th>
                        <th className="border px-2 py-2 text-left w-px whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyBlocks.map((entry, index) => {
                        const isGroupTotal = entry.type === "group-total";
                        const row = entry.row;
                        return (
                          <tr
                            key={`${entry.type}-${entry.groupName || row.material_id || row.source_sloc_group_name || index}`}
                            className={`${getStatusToneClass(row.status_tone)} ${isGroupTotal ? "font-semibold" : ""}`}
                          >
                            <td className="border px-2 py-2 whitespace-nowrap">
                              {entry.groupName || row.planning_item_group_name || "Standalone"}
                            </td>
                            <td className="border px-2 py-2 whitespace-nowrap">
                              {row.source_sloc_group_name || (isGroupTotal ? "Mixed scope" : "Not assigned")}
                            </td>
                            <td className="border px-2 py-2">
                              {isGroupTotal ? (
                                <span>Group Total</span>
                              ) : (
                                <div className="grid gap-[2px]">
                                  <span className="font-semibold text-slate-900">
                                    {row.material_name}
                                  </span>
                                  <span className="text-[11px] text-slate-600">
                                    {row.material_external_code || "-"}
                                  </span>
                                </div>
                              )}
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
