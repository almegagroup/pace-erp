/* PO22 Phase 3B — immutable planning-evidence persistence only.
 *
 * This module has no source queries, allocation, Store instruction, purchase,
 * stock posting or transfer operation.  Its caller must first obtain an
 * authorized, company-scoped source snapshot.
 */
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import type { OptimizerPersistentInputSnapshot } from "./mts_optimizer_phase3b.types.ts";
import { toOptimizerSnapshotInsertRow } from "./mts_optimizer_phase3b.persistence.logic.ts";
export { toOptimizerSnapshotInsertRow } from "./mts_optimizer_phase3b.persistence.logic.ts";

/** Server-only write invoked by a future verified source-capture workflow. */
export async function persistOptimizerInputSnapshot(
  snapshot: OptimizerPersistentInputSnapshot,
  actorId: string | null,
): Promise<string> {
  const row = toOptimizerSnapshotInsertRow(snapshot, actorId);
  const { data, error } = await serviceRoleClient.schema("erp_planning")
    .from("mts_optimizer_input_snapshot")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    if (String(error.code) === "23505") throw new Error("MTS_OPTIMIZER_SNAPSHOT_DUPLICATE_EVIDENCE");
    throw new Error("MTS_OPTIMIZER_SNAPSHOT_PERSIST_FAILED");
  }
  const id = String(data?.id ?? "").trim();
  if (!id) throw new Error("MTS_OPTIMIZER_SNAPSHOT_PERSIST_FAILED");
  return id;
}
