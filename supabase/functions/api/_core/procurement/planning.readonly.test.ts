import {
  loadProcurementPlanningDecisionRowsFromReadOnlySource,
  type PlanHeader,
  type ProcurementPlanningDecisionReadOnlySource,
  type ProcurementPlanningWorkspace,
} from "./planning.handlers.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function openPlan(status: string): PlanHeader {
  return {
    id: "plan-1",
    company_id: "company-1",
    plan_month: "2026-09-01",
    status,
  };
}

function emptyWorkspace(): ProcurementPlanningWorkspace {
  return { rows: [], slocGroups: [], itemGroups: [], groupConfigs: [] };
}

Deno.test("PO11 report read-only loader returns empty when no plan exists without loading or creating a plan", async () => {
  let workspaceLoads = 0;
  const source: ProcurementPlanningDecisionReadOnlySource = {
    async getPlanHeader() {
      return null;
    },
    async loadWorkspace() {
      workspaceLoads += 1;
      return emptyWorkspace();
    },
  };
  const rows = await loadProcurementPlanningDecisionRowsFromReadOnlySource(
    { company_id: "company-1", plan_month: "2026-09" },
    source,
  );
  assert(
    rows.length === 0 && workspaceLoads === 0,
    "missing plan must produce empty rows with no write-capable bootstrap",
  );
});

Deno.test("PO11 report read-only loader never recalculates a CLOSED plan", async () => {
  let workspaceLoads = 0;
  const source: ProcurementPlanningDecisionReadOnlySource = {
    async getPlanHeader() {
      return openPlan("CLOSED");
    },
    async loadWorkspace() {
      workspaceLoads += 1;
      return emptyWorkspace();
    },
  };
  const rows = await loadProcurementPlanningDecisionRowsFromReadOnlySource(
    { company_id: "company-1", plan_month: "2026-09-01" },
    source,
  );
  assert(
    rows.length === 0 && workspaceLoads === 0,
    "closed plans must not load current stock",
  );
});

Deno.test("PO11 report read-only loader uses only the injected read source for an OPEN plan", async () => {
  let planReads = 0;
  let workspaceReads = 0;
  const source: ProcurementPlanningDecisionReadOnlySource = {
    async getPlanHeader() {
      planReads += 1;
      return openPlan("OPEN");
    },
    async loadWorkspace() {
      workspaceReads += 1;
      return emptyWorkspace();
    },
  };
  const rows = await loadProcurementPlanningDecisionRowsFromReadOnlySource(
    { company_id: "company-1", plan_month: "2026-09" },
    source,
  );
  assert(
    rows.length === 0 && planReads === 1 && workspaceReads === 1,
    "open reads must not require plan creation or auto-inclusion",
  );
});
