import { toOptimizerSnapshotInsertRow } from "./mts_optimizer_phase3b.persistence.logic.ts";
import type { OptimizerPersistentInputSnapshot } from "./mts_optimizer_phase3b.types.ts";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const snapshot = (): OptimizerPersistentInputSnapshot => ({
  schema_version: 1,
  normalized: {
    schema_version: 1, company_id: "CMP003", as_of: "2026-10-19", captured_at: "2026-10-19T00:00:00.000Z",
    source_fingerprint: "fnv1a64:0000000000000000", demand: [], stock: [], reservations: [], inbound: [], missing_data: [], planning_blockers: [],
  },
  sha256_supply_fingerprint: `sha256:${"a".repeat(64)}`,
  sha256_business_fingerprint: `sha256:${"b".repeat(64)}`,
  selection_window: [],
  provenance: {
    source_contract_version: "phase-3b-1", captured_at: "2026-10-19T00:00:00.000Z", captured_by: "actor-1", adapter_versions: {}, source_tables: [], source_identity_manifest: {}, source_versions: {},
  },
});

Deno.test("snapshot persistence row retains immutable evidence and fingerprints", () => {
  const row = toOptimizerSnapshotInsertRow(snapshot(), "actor-1");
  assert(row.company_id === "CMP003" && row.blocker_count === 0, "snapshot row shape");
  assert(row.sha256_supply_fingerprint.endsWith("a".repeat(64)), "supply fingerprint retained");
  assert(row.provenance_json !== row.input_json, "provenance separated from business input");
});

Deno.test("snapshot persistence rejects a non-SHA-256 fingerprint", () => {
  const invalid = snapshot();
  (invalid as { sha256_supply_fingerprint: string }).sha256_supply_fingerprint = "fnv:bad";
  let failed = false;
  try { toOptimizerSnapshotInsertRow(invalid, null); } catch { failed = true; }
  assert(failed, "must reject invalid persistent digest");
});
