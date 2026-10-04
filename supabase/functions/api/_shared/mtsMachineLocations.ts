import { fetchInChunks } from "./chunkedIn.ts";
import { serviceRoleClient } from "./serviceRoleClient.ts";

type JsonRecord = Record<string, unknown>;

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

// §138 — machine-respect stock exists only at storage locations mapped to an
// explicitly MTS-capable machine. A missing po-type map must not be treated as
// MTS: existing machines are deliberately left unmapped until SA configures
// them, per the locked manual-mapping rule in §138.1.
export async function getMtsMachineStorageLocationIds(companyId: string): Promise<Set<string>> {
  const { data: machines, error: machineError } = await serviceRoleClient
    .schema("erp_master")
    .from("machine_master")
    .select("id, storage_location_id")
    .eq("company_id", companyId)
    .eq("active", true)
    .not("storage_location_id", "is", null);
  if (machineError) throw new Error("MTS_MACHINE_LOCATION_LOOKUP_FAILED");

  const machineRows = (machines ?? []) as JsonRecord[];
  const machineIds = machineRows.map((row) => toTrimmedString(row.id)).filter(Boolean);
  if (machineIds.length === 0) return new Set();

  let mtsMachineRows: JsonRecord[];
  try {
    mtsMachineRows = await fetchInChunks<JsonRecord>(machineIds, (idChunk) =>
      serviceRoleClient
        .schema("erp_master")
        .from("machine_po_type_map")
        .select("machine_id")
        .eq("po_type", "MTS")
        .in("machine_id", idChunk));
  } catch {
    throw new Error("MTS_MACHINE_LOCATION_LOOKUP_FAILED");
  }

  const mtsMachineIds = new Set(mtsMachineRows.map((row) => toTrimmedString(row.machine_id)).filter(Boolean));
  return new Set(
    machineRows
      .filter((row) => mtsMachineIds.has(toTrimmedString(row.id)))
      .map((row) => toTrimmedString(row.storage_location_id))
      .filter(Boolean),
  );
}
