import { buildProcurementPlanningDecisionRows } from "./planning.decision_rows.ts";
import type {
  PlanningGroupConfig,
  PlanningWorkspaceRow,
} from "./planning.handlers.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function row(
  overrides: Partial<PlanningWorkspaceRow> = {},
): PlanningWorkspaceRow {
  return {
    id: "line-1",
    material_id: "material-1",
    material_code: "MAT-1",
    material_name: "Alpha",
    material_external_code: "EXT-1",
    material_type: "RM",
    base_uom_code: "KG",
    source_sloc_group_id: "sloc-1",
    source_sloc_group_name: "Raw Material Store",
    planning_item_group_id: null,
    planning_item_group_name: null,
    excluded_from_dashboard: false,
    monthly_requirement_qty: 300,
    safety_days: 3,
    processing_time_days: 2,
    lead_time_days: 5,
    replenishment_days: 7,
    fixed_safety_stock_qty: null,
    fixed_replenishment_stock_qty: null,
    available_stock_qty: 500,
    trn_stock_qty: 10,
    ge_stock_qty: 20,
    qa_stock_qty: 30,
    total_stock_qty: 500,
    derived_safety_stock_qty: 30,
    derived_replenishment_stock_qty: 100,
    effective_safety_stock_qty: 30,
    effective_replenishment_stock_qty: 100,
    status_tone: "NORMAL",
    display_order: 1,
    ...overrides,
  };
}

function groupRow(
  suffix: string,
  overrides: Partial<PlanningWorkspaceRow> = {},
): PlanningWorkspaceRow {
  return row({
    id: `line-${suffix}`,
    material_id: `material-${suffix}`,
    material_code: `MAT-${suffix}`,
    material_name: `Material ${suffix}`,
    planning_item_group_id: "group-1",
    planning_item_group_name: "Alternate Materials",
    ...overrides,
  });
}

function groupConfig(
  overrides: Partial<PlanningGroupConfig> = {},
): PlanningGroupConfig {
  return {
    planning_item_group_id: "group-1",
    planning_item_group_name: "Alternate Materials",
    sloc_group_id: "sloc-1",
    sloc_group_name: "Raw Material Store",
    monthly_requirement_qty: 0,
    safety_days: 0,
    processing_time_days: 0,
    lead_time_days: 0,
    fixed_safety_stock_qty: null,
    fixed_replenishment_stock_qty: null,
    ...overrides,
  };
}

function decisions(
  rows: readonly PlanningWorkspaceRow[],
  groupConfigs: readonly PlanningGroupConfig[] = [],
) {
  return buildProcurementPlanningDecisionRows({
    rows,
    group_configs: groupConfigs,
    plan_month: "2026-09-01",
  });
}

function decisionForGroup(
  rows: readonly PlanningWorkspaceRow[],
  configs: readonly PlanningGroupConfig[] = [],
) {
  const result = decisions(rows, configs).find((entry) =>
    entry.decision_type === "ITEM_GROUP"
  );
  assert(result, "expected an item-group decision row");
  return result;
}

Deno.test("PO11 decision builder emits one standalone material row", () => {
  const result = decisions([row()]);
  assert(result.length === 1, "one standalone should emit one row");
  assert(
    result[0].decision_type === "STANDALONE_MATERIAL",
    "wrong decision type",
  );
});

Deno.test("PO11 decision builder omits excluded materials", () => {
  assert(
    decisions([row({ excluded_from_dashboard: true })]).length === 0,
    "excluded row must not emit",
  );
});

Deno.test("PO11 standalone decision key is stable across plan-line IDs", () => {
  const first = decisions([row({ id: "old-line" })])[0].decision_key;
  const second = decisions([row({ id: "new-line" })])[0].decision_key;
  assert(
    first === second && first === "material:material-1::sloc_group:sloc-1",
    "key must use material + scope",
  );
});

Deno.test("PO11 group emits one decision row and never emits members separately", () => {
  const result = decisions([groupRow("a"), groupRow("b")]);
  assert(result.length === 1, "members should collapse into one decision");
  assert(
    result[0].decision_type === "ITEM_GROUP" && result[0].member_count === 2,
    "wrong group output",
  );
});

Deno.test("PO11 group member requirement sum wins over direct group requirement", () => {
  const decision = decisionForGroup(
    [
      groupRow("a", { monthly_requirement_qty: 100 }),
      groupRow("b", { monthly_requirement_qty: 200 }),
    ],
    [groupConfig({ monthly_requirement_qty: 999 })],
  );
  assert(decision.monthly_requirement_qty === 300, "member total must win");
});

Deno.test("PO11 group uses direct requirement only when member total is zero", () => {
  const decision = decisionForGroup(
    [
      groupRow("a", { monthly_requirement_qty: 0 }),
      groupRow("b", { monthly_requirement_qty: 0 }),
    ],
    [groupConfig({ monthly_requirement_qty: 450 })],
  );
  assert(
    decision.monthly_requirement_qty === 450,
    "direct group requirement must apply only at zero member total",
  );
});

Deno.test("PO11 group averages safety, processing, and lead days", () => {
  const decision = decisionForGroup([
    groupRow("a", {
      safety_days: 2,
      processing_time_days: 4,
      lead_time_days: 6,
    }),
    groupRow("b", {
      safety_days: 4,
      processing_time_days: 6,
      lead_time_days: 8,
    }),
  ]);
  assert(
    decision.safety_days === 3 && decision.processing_time_days === 5 &&
      decision.lead_time_days === 7,
    "group days must average",
  );
});

Deno.test("PO11 group sums fixed safety and replenishment overrides", () => {
  const decision = decisionForGroup([
    groupRow("a", {
      fixed_safety_stock_qty: 10,
      fixed_replenishment_stock_qty: 30,
    }),
    groupRow("b", {
      fixed_safety_stock_qty: 20,
      fixed_replenishment_stock_qty: 40,
    }),
  ]);
  assert(
    decision.fixed_safety_stock_qty === 30 &&
      decision.fixed_replenishment_stock_qty === 70,
    "fixed overrides must sum",
  );
});

Deno.test("PO11 group sums available, TRN, Gate Entry, and QA", () => {
  const decision = decisionForGroup([
    groupRow("a", {
      available_stock_qty: 10,
      trn_stock_qty: 20,
      ge_stock_qty: 30,
      qa_stock_qty: 40,
    }),
    groupRow("b", {
      available_stock_qty: 1,
      trn_stock_qty: 2,
      ge_stock_qty: 3,
      qa_stock_qty: 4,
    }),
  ]);
  assert(
    decision.available_stock_qty === 11 && decision.trn_stock_qty === 22 &&
      decision.ge_stock_qty === 33 && decision.qa_stock_qty === 44,
    "pipeline quantities must sum",
  );
});

Deno.test("PO11 group threshold status uses Available only, not TRN, Gate Entry, or QA", () => {
  const decision = decisionForGroup([
    groupRow("a", {
      monthly_requirement_qty: 300,
      safety_days: 3,
      processing_time_days: 0,
      lead_time_days: 0,
      available_stock_qty: 20,
      trn_stock_qty: 1_000,
      ge_stock_qty: 1_000,
      qa_stock_qty: 1_000,
    }),
  ]);
  assert(
    decision.effective_safety_stock_qty === 30,
    "fixture safety threshold must be 30",
  );
  assert(
    decision.status_tone === "CRITICAL",
    "pipeline stock must not hide shortage",
  );
});

Deno.test("PO11 group retains NORMAL status when thresholds are unconfigured", () => {
  const decision = decisionForGroup([
    groupRow("a", {
      monthly_requirement_qty: 0,
      safety_days: 0,
      processing_time_days: 0,
      lead_time_days: 0,
      available_stock_qty: 0,
    }),
  ]);
  assert(
    decision.status_tone === "NORMAL",
    "zero thresholds are unconfigured, not critical",
  );
});

Deno.test("PO11 item-group decision key is the stable planning item-group ID", () => {
  const decision = decisionForGroup([groupRow("a")]);
  assert(decision.decision_key === "group-1", "group key must be the group ID");
});

Deno.test("PO11 group display fields do not impersonate a member and represent heterogeneous values safely", () => {
  const decision = decisionForGroup([
    groupRow("a", { material_type: "RM", base_uom_code: "KG" }),
    groupRow("b", { material_type: "PM", base_uom_code: "NOS" }),
  ]);
  assert(
    decision.material_code === "" && decision.material_name === "" &&
      decision.material_type === "MIXED" && decision.base_uom_code === "MIXED",
    "group display fields must not silently select a member",
  );
});
