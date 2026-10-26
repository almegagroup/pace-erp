/**
 * PO22 Family Waterfall W3g — persistent planning-purpose ledger.
 *
 * This is deliberately independent of PO/CSN reading and UI presentation.
 * A physical receipt becomes unallocated stock once; the ledger assigns it in
 * priority order and carries each purpose balance across days.  A purpose is
 * refilled only when a real supply arrives, or when it has fallen below its
 * Target and genuine unallocated eligible stock exists.  It never fabricates
 * a daily receipt merely to recreate its Desired-Max balance.
 */

const EPSILON = 0.000001;
const round = (value: number) => Math.round(value * 1000) / 1000;

export type FamilyPurpose = {
  id: string;
  /** Direct/exclusive first; then narrow group to broad group. */
  priority: number;
  candidates: readonly string[];
  /** Actual consumption for each event-day. */
  demand: readonly number[];
  /** Target balance to retain after consumption for each event-day. */
  target_balance: readonly number[];
  /** Desired-Max balance to restore after consumption for each event-day. */
  desired_balance: readonly number[];
  /** FEFO / user order / run-down order prepared by the caller. */
  consume_order?: readonly string[];
};

export type FamilySupply = { day: number; material_id: string; qty: number; reference: string };

export type PurposeLedgerDay = {
  day: number;
  purpose_id: string;
  opening_qty: number;
  allocated_qty: number;
  consumed_qty: number;
  closing_qty: number;
  target_qty: number;
  desired_qty: number;
  shortage_qty: number;
  by_material: Readonly<Record<string, number>>;
};

export type PurposeLedgerResult = {
  rows: readonly PurposeLedgerDay[];
  unallocated_by_day: readonly Readonly<Record<string, number>>[];
};

export function runFamilyPurposeLedger(args: {
  opening: Readonly<Record<string, number>>;
  supplies: readonly FamilySupply[];
  purposes: readonly FamilyPurpose[];
  days: number;
}): PurposeLedgerResult {
  const purposes = [...args.purposes].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const unallocated = new Map<string, number>();
  for (const [material, qty] of Object.entries(args.opening)) unallocated.set(material, Math.max(0, qty));
  const balances = new Map(purposes.map((purpose) => [purpose.id, new Map<string, number>()]));
  const rows: PurposeLedgerDay[] = [];
  const unallocatedByDay: Readonly<Record<string, number>>[] = [];

  const sum = (balance: ReadonlyMap<string, number>) => [...balance.values()].reduce((total, qty) => total + Math.max(0, qty), 0);
  const add = (balance: Map<string, number>, material: string, qty: number) => balance.set(material, round((balance.get(material) ?? 0) + qty));
  const candidatesFor = (purpose: FamilyPurpose) => {
    const saved = purpose.consume_order ?? [];
    return [...new Set([...saved.filter((id) => purpose.candidates.includes(id)), ...purpose.candidates])];
  };
  const allocate = (purpose: FamilyPurpose, required: number) => {
    if (required <= EPSILON) return 0;
    const balance = balances.get(purpose.id)!;
    let left = required;
    for (const material of candidatesFor(purpose)) {
      if (left <= EPSILON) break;
      const take = Math.min(left, unallocated.get(material) ?? 0);
      if (take <= EPSILON) continue;
      unallocated.set(material, round((unallocated.get(material) ?? 0) - take));
      add(balance, material, take);
      left = round(left - take);
    }
    return round(required - left);
  };

  for (let day = 0; day < args.days; day += 1) {
    const newSupply = day === 0;
    for (const supply of args.supplies.filter((item) => item.day === day)) {
      unallocated.set(supply.material_id, round((unallocated.get(supply.material_id) ?? 0) + Math.max(0, supply.qty)));
    }
    const hasSupply = newSupply || args.supplies.some((item) => item.day === day && item.qty > EPSILON);

    // A real receipt fills all priorities to Desired Max.  The amount includes
    // today's planned use, so the recorded post-use balance is Desired Max.
    if (hasSupply) {
      for (const purpose of purposes) {
        const balance = balances.get(purpose.id)!;
        const desiredFill = Math.max(0, (purpose.demand[day] ?? 0) + (purpose.desired_balance[day] ?? 0));
        allocate(purpose, Math.max(0, desiredFill - sum(balance)));
      }
    }

    for (const purpose of purposes) {
      const balance = balances.get(purpose.id)!;
      const openingQty = sum(balance);
      let need = Math.max(0, purpose.demand[day] ?? 0);
      let consumed = 0;
      for (const material of candidatesFor(purpose)) {
        if (need <= EPSILON) break;
        const take = Math.min(need, balance.get(material) ?? 0);
        if (take <= EPSILON) continue;
        balance.set(material, round((balance.get(material) ?? 0) - take));
        need = round(need - take);
        consumed = round(consumed + take);
      }
      const target = Math.max(0, purpose.target_balance[day] ?? 0);
      const desired = Math.max(target, purpose.desired_balance[day] ?? target);
      // Without a new receipt, only genuine free stock may restore a purpose
      // that has reached Target.  This is where a depleted VINNAPAS allocation
      // can legitimately hand off to DA; it is not a new buy.
      const beforeRefill = sum(balance);
      let allocated = 0;
      if (beforeRefill + EPSILON < target) allocated = allocate(purpose, Math.max(0, desired - beforeRefill));
      const closing = sum(balance);
      rows.push({
        day, purpose_id: purpose.id, opening_qty: round(openingQty), allocated_qty: round(allocated), consumed_qty: round(consumed),
        closing_qty: round(closing), target_qty: round(target), desired_qty: round(desired), shortage_qty: round(need),
        by_material: Object.fromEntries([...balance.entries()].filter(([, qty]) => qty > EPSILON).map(([material, qty]) => [material, round(qty)])),
      });
    }
    unallocatedByDay.push(Object.fromEntries([...unallocated.entries()].filter(([, qty]) => qty > EPSILON).map(([material, qty]) => [material, round(qty)])));
  }
  return { rows, unallocated_by_day: unallocatedByDay };
}
