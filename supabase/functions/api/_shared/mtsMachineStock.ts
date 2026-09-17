/*
 * File-Path: supabase/functions/api/_shared/mtsMachineStock.ts
 * Purpose: §138.12 (MTS Alternate-Group Auto-Derive Mechanism) — machine-bucket
 *          balance lookup + the pure allocation algorithm. Shared so both
 *          Process PO (Standard auto-derive, Verify consumption writer) and any
 *          future caller read/write `erp_production.machine_stock_log` the same
 *          way. Core stock engine (stock_ledger/stock_snapshot) is untouched —
 *          this is the machine-attribution side-table only (§138.6).
 * Authority: Backend
 */

import { serviceRoleClient } from "./serviceRoleClient.ts";

type JsonRecord = Record<string, unknown>;

// Balances for one bucket (a specific machine_id, or the Unassigned bucket
// when machineId is null) across several materials in one location, in one
// query — the auto-derive algorithm always needs the formulation item +
// every group member's balance together.
export async function getMachineBucketBalances(params: {
  companyId: string;
  storageLocationId: string;
  materialIds: string[];
  machineId: string | null;
}): Promise<Map<string, number>> {
  const { companyId, storageLocationId, machineId } = params;
  const balances = new Map<string, number>();
  const ids = [...new Set(params.materialIds.filter(Boolean))];
  if (ids.length === 0 || !companyId || !storageLocationId) return balances;

  let query = serviceRoleClient
    .schema("erp_production")
    .from("machine_stock_log")
    .select("material_id, qty, direction")
    .eq("company_id", companyId)
    .eq("storage_location_id", storageLocationId)
    .in("material_id", ids);
  query = machineId ? query.eq("machine_id", machineId) : query.is("machine_id", null);

  const { data, error } = await query;
  if (error) {
    console.error("[mtsMachineStock.getMachineBucketBalances] query failed:", JSON.stringify(error));
    throw new Error("PROD_MACHINE_STOCK_LOOKUP_FAILED");
  }
  for (const row of (data ?? []) as JsonRecord[]) {
    const materialId = String(row.material_id ?? "");
    if (!materialId) continue;
    const sign = String(row.direction ?? "").toUpperCase() === "OUT" ? -1 : 1;
    const qty = Number(row.qty ?? 0) * sign;
    balances.set(materialId, Number(((balances.get(materialId) ?? 0) + qty).toFixed(6)));
  }
  return balances;
}

export type MtsDeriveSplit = { materialId: string; qty: number };
export type MtsDeriveResult = {
  splits: MtsDeriveSplit[];
  insufficient: boolean;
  shortfall: number;
  totalAvailable: number;
};

// §138.12 — priority order: the formulation item's own bucket balance first
// (regardless of size), THEN the rest of the group, smallest-available-first
// (fully exhaust a small leftover before touching a bigger one). Never
// crosses the caller's own bucket boundary — `balances` must already be
// scoped to the correct bucket (a specific machine, or Unassigned for the
// §138.4 exception case); this function only allocates across what it's given.
export function computeMtsAutoDerive(params: {
  formulationMaterialId: string;
  neededQty: number;
  balances: Map<string, number>;
  groupMemberIds: string[];
}): MtsDeriveResult {
  const { formulationMaterialId, neededQty, balances, groupMemberIds } = params;
  const EPS = 1e-6;

  const others = [...new Set(groupMemberIds.filter((id) => id && id !== formulationMaterialId))]
    .map((materialId) => ({ materialId, balance: Math.max(0, balances.get(materialId) ?? 0) }))
    .sort((a, b) => a.balance - b.balance);
  const order = [
    { materialId: formulationMaterialId, balance: Math.max(0, balances.get(formulationMaterialId) ?? 0) },
    ...others,
  ];

  const splits: MtsDeriveSplit[] = [];
  let remaining = neededQty;
  let totalAvailable = 0;
  for (const candidate of order) {
    totalAvailable = Number((totalAvailable + candidate.balance).toFixed(6));
    if (remaining <= EPS || candidate.balance <= EPS) continue;
    const draw = Math.min(remaining, candidate.balance);
    splits.push({ materialId: candidate.materialId, qty: Number(draw.toFixed(6)) });
    remaining = Number((remaining - draw).toFixed(6));
  }

  const insufficient = remaining > EPS;
  return { splits, insufficient, shortfall: insufficient ? remaining : 0, totalAvailable };
}

// Best-effort side-table write (matches the existing TRANSFER/MANUAL_ALLOT
// writers in location_transfer.handlers.ts §138.13) — the real physical
// posting (stock_ledger via post_document/post_stock_movement) has already
// committed by the time this is called; a failure here logs and never rolls
// back or blocks the caller's response, same established precedent.
export async function logMachineStockConsumption(rows: Array<{
  companyId: string;
  storageLocationId: string;
  materialId: string;
  machineId: string | null;
  batchNumber?: string | null;
  qty: number;
  referenceDocumentType: string;
  referenceDocumentId: string;
  createdBy: string;
}>): Promise<void> {
  const filtered = rows.filter((row) => row.qty > 1e-6);
  if (filtered.length === 0) return;
  const { error } = await serviceRoleClient
    .schema("erp_production")
    .from("machine_stock_log")
    .insert(filtered.map((row) => ({
      company_id: row.companyId,
      storage_location_id: row.storageLocationId,
      material_id: row.materialId,
      machine_id: row.machineId,
      batch_number: row.batchNumber ?? null,
      qty: row.qty,
      direction: "OUT",
      source_type: "CONSUMPTION",
      reference_document_type: row.referenceDocumentType,
      reference_document_id: row.referenceDocumentId,
      created_by: row.createdBy,
    })));
  if (error) {
    console.error("[mtsMachineStock.logMachineStockConsumption] insert failed:", JSON.stringify(error));
  }
}

// §138.1 fail-open convention (matches location_transfer.handlers.ts's
// getMtsStorageLocationIds) — a machine with no po_types configured yet still
// counts as MTS-eligible so pre-existing machines don't silently drop out.
export async function getMtsStorageLocationIds(companyId: string): Promise<Set<string>> {
  const { data: machines, error: machineError } = await serviceRoleClient
    .schema("erp_master")
    .from("machine_master")
    .select("id, storage_location_id")
    .eq("company_id", companyId)
    .eq("active", true)
    .not("storage_location_id", "is", null);
  if (machineError) {
    console.error("[mtsMachineStock.getMtsStorageLocationIds] machine query failed:", JSON.stringify(machineError));
    throw new Error("PROD_MACHINE_STOCK_LOOKUP_FAILED");
  }
  const machineRows = (machines ?? []) as JsonRecord[];
  const machineIds = machineRows.map((row) => String(row.id ?? "")).filter(Boolean);
  if (machineIds.length === 0) return new Set();

  const { data: poTypeRows, error: poTypeError } = await serviceRoleClient
    .schema("erp_master")
    .from("machine_po_type_map")
    .select("machine_id, po_type")
    .in("machine_id", machineIds);
  if (poTypeError) {
    console.error("[mtsMachineStock.getMtsStorageLocationIds] po-type query failed:", JSON.stringify(poTypeError));
    throw new Error("PROD_MACHINE_STOCK_LOOKUP_FAILED");
  }
  const poTypesByMachine = new Map<string, string[]>();
  for (const row of (poTypeRows ?? []) as JsonRecord[]) {
    const machineId = String(row.machine_id ?? "");
    const list = poTypesByMachine.get(machineId) ?? [];
    list.push(String(row.po_type ?? "").toUpperCase());
    poTypesByMachine.set(machineId, list);
  }

  const locationIds = new Set<string>();
  for (const row of machineRows) {
    const machineId = String(row.id ?? "");
    const poTypes = poTypesByMachine.get(machineId) ?? [];
    if (poTypes.length === 0 || poTypes.includes("MTS")) {
      const locationId = String(row.storage_location_id ?? "");
      if (locationId) locationIds.add(locationId);
    }
  }
  return locationIds;
}
