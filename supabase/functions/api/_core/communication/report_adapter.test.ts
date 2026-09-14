import {
  createReportAdapterRegistry,
  ReportAdapterRegistryError,
} from "./report_adapter_registry.ts";
import { ReportAdapterOutputValidationError } from "./report_adapter_validation.ts";
import { createReportManifestRegistry } from "./report_manifest/registry.ts";
import { PO11_PLANNING_ALERT_REPORT_DATASET } from "./report_manifest/po11_planning_alert.ts";
import { createPO11PlanningAlertReportAdapter } from "./adapters/po11_planning_alert.adapter.ts";
import type { RegisteredReportDatasetAdapter } from "./report_adapter_registry.ts";
import type { ProcurementPlanningDecisionRow } from "../procurement/planning.decision_rows.ts";

const PO11_PAGE = { tx_code: "PO11", resource_code: "PROC_PLANNING_VIEW" };
const MANIFEST_REGISTRY = createReportManifestRegistry([
  PO11_PLANNING_ALERT_REPORT_DATASET,
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validOutputRow(): Record<string, unknown> {
  return {
    planning_status: "NORMAL",
    decision_type: "STANDALONE_MATERIAL",
    decision_key: "material:mat-1::sloc_group:sloc-1",
    material_type: "RM",
    material_code: "MAT-1",
    material_name: "Material One",
    group_name: "",
    source_sloc_group: "Raw Material Store",
    monthly_requirement_qty: 300,
    available_stock_qty: 500,
    safety_stock_qty: 30,
    replenishment_stock_qty: 100,
    trn_stock_qty: 10,
    gate_entry_stock_qty: 20,
    qa_stock_qty: 5,
    safety_days: 3,
    processing_days: 2,
    lead_time_days: 5,
    uom: "KG",
  };
}

function adapterForRows(
  rows: readonly Record<string, unknown>[],
): RegisteredReportDatasetAdapter {
  return {
    page: PO11_PAGE,
    dataset_key: "planning_alert",
    async loadRows() {
      return rows;
    },
  };
}

async function assertAsyncErrorCode(
  action: () => Promise<unknown>,
  code: string,
  errorType:
    | typeof ReportAdapterRegistryError
    | typeof ReportAdapterOutputValidationError,
): Promise<void> {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown instanceof errorType,
    `Expected ${code} to throw ${errorType.name}`,
  );
  assert(thrown.code === code, `Expected ${code}, received ${thrown.code}`);
}

Deno.test("report adapter registry accepts a manifest-bound adapter", () => {
  const adapter = adapterForRows([validOutputRow()]);
  const registry = createReportAdapterRegistry(MANIFEST_REGISTRY, [adapter]);
  assert(
    registry.resolveAdapter(PO11_PAGE, "planning_alert") === adapter,
    "adapter should resolve",
  );
});

Deno.test("report adapter registry rejects duplicate registrations", () => {
  let thrown: unknown;
  try {
    createReportAdapterRegistry(MANIFEST_REGISTRY, [
      adapterForRows([validOutputRow()]),
      adapterForRows([validOutputRow()]),
    ]);
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof ReportAdapterRegistryError, "duplicate must reject");
  assert(
    thrown.code === "REPORT_ADAPTER_DUPLICATE_REGISTRATION",
    "wrong duplicate code",
  );
});

Deno.test("report adapter registry rejects an adapter without a manifest dataset", () => {
  let thrown: unknown;
  try {
    createReportAdapterRegistry(MANIFEST_REGISTRY, [{
      ...adapterForRows([validOutputRow()]),
      dataset_key: "not_in_manifest",
    }]);
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown instanceof ReportAdapterRegistryError,
    "missing manifest dataset must reject",
  );
  assert(
    thrown.code === "REPORT_ADAPTER_MANIFEST_DATASET_NOT_FOUND",
    "wrong missing-manifest code",
  );
});

Deno.test("report adapter registry rejects an unknown adapter resolution", () => {
  const registry = createReportAdapterRegistry(MANIFEST_REGISTRY, []);
  let thrown: unknown;
  try {
    registry.resolveAdapter(PO11_PAGE, "planning_alert");
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown instanceof ReportAdapterRegistryError,
    "unknown adapter must reject",
  );
  assert(
    thrown.code === "REPORT_ADAPTER_NOT_FOUND",
    "wrong unknown-adapter code",
  );
});

for (
  const [name, change, code] of [
    [
      "undeclared output field",
      (row: Record<string, unknown>) => ({ ...row, internal_id: "never" }),
      "REPORT_ADAPTER_OUTPUT_UNDECLARED_FIELD",
    ],
    [
      "missing identity",
      (row: Record<string, unknown>) => ({ ...row, decision_key: "" }),
      "REPORT_ADAPTER_OUTPUT_IDENTITY_MISSING",
    ],
    [
      "invalid enum",
      (row: Record<string, unknown>) => ({
        ...row,
        planning_status: "WARNING",
      }),
      "REPORT_ADAPTER_OUTPUT_ENUM_INVALID",
    ],
    [
      "invalid numeric",
      (row: Record<string, unknown>) => ({
        ...row,
        available_stock_qty: Number.NaN,
      }),
      "REPORT_ADAPTER_OUTPUT_INVALID_NUMBER",
    ],
  ] as const
) {
  Deno.test(`report adapter output rejects ${name}`, async () => {
    const registry = createReportAdapterRegistry(MANIFEST_REGISTRY, [
      adapterForRows([change(validOutputRow())]),
    ]);
    await assertAsyncErrorCode(
      () =>
        registry.loadRows(
          PO11_PAGE,
          "planning_dashboard",
          "planning_alert",
          {},
        ),
      code,
      ReportAdapterOutputValidationError,
    );
  });
}

Deno.test("report adapter output rejects duplicate decision identities", async () => {
  const row = validOutputRow();
  const registry = createReportAdapterRegistry(MANIFEST_REGISTRY, [
    adapterForRows([row, { ...row }]),
  ]);
  await assertAsyncErrorCode(
    () =>
      registry.loadRows(PO11_PAGE, "planning_dashboard", "planning_alert", {}),
    "REPORT_ADAPTER_OUTPUT_DUPLICATE_IDENTITY",
    ReportAdapterOutputValidationError,
  );
});

Deno.test("report adapter output accepts a complete valid row", async () => {
  const row = validOutputRow();
  const registry = createReportAdapterRegistry(MANIFEST_REGISTRY, [
    adapterForRows([row]),
  ]);
  const rows = await registry.loadRows(
    PO11_PAGE,
    "planning_dashboard",
    "planning_alert",
    {},
  );
  assert(
    rows.length === 1 && rows[0].decision_key === row.decision_key,
    "valid output should pass",
  );
});

Deno.test("PO11 adapter maps canonical WARNING to manifest REPLENISH without technical fields", async () => {
  const decision: ProcurementPlanningDecisionRow = {
    decision_type: "STANDALONE_MATERIAL",
    decision_key: "material:mat-1::sloc_group:sloc-1",
    member_count: 1,
    planning_item_group_id: null,
    material_id: "mat-1",
    material_type: "RM",
    material_code: "MAT-1",
    material_name: "Material One",
    group_name: "",
    source_sloc_group_id: "sloc-1",
    source_sloc_group_name: "Raw Material Store",
    monthly_requirement_qty: 300,
    safety_days: 3,
    processing_time_days: 2,
    lead_time_days: 5,
    fixed_safety_stock_qty: null,
    fixed_replenishment_stock_qty: null,
    derived_safety_stock_qty: 30,
    derived_replenishment_stock_qty: 100,
    effective_safety_stock_qty: 30,
    effective_replenishment_stock_qty: 100,
    available_stock_qty: 90,
    trn_stock_qty: 500,
    ge_stock_qty: 500,
    qa_stock_qty: 500,
    status_tone: "WARNING",
    base_uom_code: "KG",
  };
  const registry = createReportAdapterRegistry(MANIFEST_REGISTRY, [
    createPO11PlanningAlertReportAdapter(async () => [decision]),
  ]);
  const [row] = await registry.loadRows(
    PO11_PAGE,
    "planning_dashboard",
    "planning_alert",
    { company_id: "company-1", plan_month: "2026-09" },
  );
  assert(row.planning_status === "REPLENISH", "WARNING must map to REPLENISH");
  assert(
    !("member_count" in row) && !("material_id" in row),
    "technical fields must not leak",
  );
});
