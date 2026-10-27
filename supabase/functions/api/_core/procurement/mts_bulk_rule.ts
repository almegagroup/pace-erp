/*
 * Bulk RM rule, pure (owner 2026-10-27): Bulk / Standard / Tanker is decided by the PO type
 * (`purchase_order.delivery_type`); the CRCP flag does not change it. See mts_bulk_materials.ts for the loader.
 */

/** Pure: the rule above over (company, delivery type) -> material facts. */
export function classifyBulkMaterials(input: { ownBulk: ReadonlySet<string>; ownAnyPo: ReadonlySet<string>; otherBulk: ReadonlySet<string> }): Set<string> {
  const result = new Set(input.ownBulk);
  for (const id of input.otherBulk) if (!input.ownAnyPo.has(id)) result.add(id);
  return result;
}

/** Groups whose every active member is Bulk: they are left out together with their members. */
export function bulkOnlyGroupIds(
  groupMembers: ReadonlyMap<string, ReadonlyArray<{ material_id: string; active: boolean }>>,
  bulk: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  for (const [groupId, members] of groupMembers) {
    const active = members.filter((m) => m.active);
    if (active.length > 0 && active.every((m) => bulk.has(m.material_id))) ids.push(groupId);
  }
  return ids;
}
