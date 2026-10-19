/* Pure serialization contract for immutable Phase 3B input snapshots. */
import type { OptimizerPersistentInputSnapshot } from "./mts_optimizer_phase3b.types.ts";

export type OptimizerSnapshotInsertRow = Readonly<{
  company_id: string; as_of_date: string; captured_at: string;
  source_contract_version: string; source_fingerprint: string;
  sha256_supply_fingerprint: string; sha256_business_fingerprint: string;
  input_json: unknown; selection_window_json: unknown; provenance_json: unknown;
  blocker_count: number; created_by: string | null;
}>;

export function toOptimizerSnapshotInsertRow(snapshot: OptimizerPersistentInputSnapshot, actorId: string | null): OptimizerSnapshotInsertRow {
  if (!snapshot.normalized.company_id || !snapshot.normalized.as_of || !snapshot.provenance.captured_at) {
    throw new Error("MTS_OPTIMIZER_SNAPSHOT_INVALID");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(snapshot.sha256_supply_fingerprint)
    || !/^sha256:[0-9a-f]{64}$/.test(snapshot.sha256_business_fingerprint)) {
    throw new Error("MTS_OPTIMIZER_SNAPSHOT_FINGERPRINT_INVALID");
  }
  return Object.freeze({
    company_id: snapshot.normalized.company_id, as_of_date: snapshot.normalized.as_of,
    captured_at: snapshot.provenance.captured_at, source_contract_version: snapshot.provenance.source_contract_version,
    source_fingerprint: snapshot.normalized.source_fingerprint, input_json: snapshot.normalized,
    selection_window_json: snapshot.selection_window, provenance_json: snapshot.provenance,
    sha256_supply_fingerprint: snapshot.sha256_supply_fingerprint, sha256_business_fingerprint: snapshot.sha256_business_fingerprint,
    blocker_count: snapshot.normalized.planning_blockers.length, created_by: actorId,
  });
}
