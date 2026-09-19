/* PO11 planning_alert adapter: maps canonical planning decisions to manifest keys. */

import {
  loadProcurementPlanningDecisionRows,
  type ProcurementPlanningDecisionReadOnlyContext,
} from "../../procurement/planning.handlers.ts";
import type { ProcurementPlanningDecisionRow } from "../../procurement/planning.decision_rows.ts";
import type { RegisteredReportDatasetAdapter } from "../report_adapter_registry.ts";

export type PO11PlanningAlertAdapterContext =
  ProcurementPlanningDecisionReadOnlyContext;

function assertAdapterContext(value: unknown): PO11PlanningAlertAdapterContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PO11_PLANNING_ALERT_CONTEXT_INVALID");
  }
  const context = value as Record<string, unknown>;
  const companyId = typeof context.company_id === "string"
    ? context.company_id.trim()
    : "";
  const planMonth = typeof context.plan_month === "string"
    ? context.plan_month.trim()
    : "";
  if (!companyId || !planMonth) {
    throw new Error("PO11_PLANNING_ALERT_CONTEXT_INVALID");
  }
  return { company_id: companyId, plan_month: planMonth };
}

function mapPlanningStatus(
  status: ProcurementPlanningDecisionRow["status_tone"],
): string {
  if (status === "CRITICAL") return "CRITICAL";
  if (status === "WARNING") return "REPLENISH";
  return "NORMAL";
}

function mapDecisionRow(
  row: ProcurementPlanningDecisionRow,
): Record<string, unknown> {
  return {
    planning_status: mapPlanningStatus(row.status_tone),
    decision_type: row.decision_type,
    decision_key: row.decision_key,
    material_type: row.material_type,
    material_code: row.material_code,
    material_name: row.material_name,
    group_name: row.group_name,
    source_sloc_group: row.source_sloc_group_name,
    monthly_requirement_qty: row.monthly_requirement_qty,
    available_stock_qty: row.available_stock_qty,
    safety_stock_qty: row.effective_safety_stock_qty,
    replenishment_stock_qty: row.effective_replenishment_stock_qty,
    trn_stock_qty: row.trn_stock_qty,
    gate_entry_stock_qty: row.ge_stock_qty,
    qa_stock_qty: row.qa_stock_qty,
    safety_days: row.safety_days,
    processing_days: row.processing_time_days,
    lead_time_days: row.lead_time_days,
    uom: row.base_uom_code,
  };
}

/**
 * Factory keeps the production adapter read-only while allowing deterministic
 * fixture sources to prove its mapping and no-write behavior in tests.
 */
export function createPO11PlanningAlertReportAdapter(
  loadDecisionRows: (
    context: PO11PlanningAlertAdapterContext,
  ) => Promise<readonly ProcurementPlanningDecisionRow[]> =
    loadProcurementPlanningDecisionRows,
): RegisteredReportDatasetAdapter {
  return {
    page: { tx_code: "PO11", resource_code: "PROC_PLANNING_VIEW" },
    dataset_key: "planning_alert",
    async loadRows(
      context: unknown,
    ): Promise<readonly Record<string, unknown>[]> {
      const rows = await loadDecisionRows(assertAdapterContext(context));
      return rows.map(mapDecisionRow);
    },
  };
}

export const PO11_PLANNING_ALERT_REPORT_ADAPTER =
  createPO11PlanningAlertReportAdapter();
