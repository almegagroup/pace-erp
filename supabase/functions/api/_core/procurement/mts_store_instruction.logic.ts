/*
 * PO22 Store instructions (owner 2026-10-28). Two things, nothing else:
 *   1. Items by period — what to use, in what quantity, for which PO21 parent group; the child groups of one parent are shown
 *      together on ONE row (see `aggregateStoreItems`, frontend/…/mtsStoreInstruction.js — same rule).
 *   2. Transfers — how much, from which R store to which, and by when:
 *        R003 (the transfer-source store) -> R001 / R002, and R001 <-> R002.
 * Pure, advisory: no stock, STO or transfer is ever posted. A shop floor S00n is fed from R00n (same rule as the Store note).
 */
const EPSILON = 0.000001;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** R00n / S00n -> "R00n"; anything else (P stores, OT…) is not part of the R->R transfer advice. */
export function rStoreKey(code: string): string | null {
  const m = /^[RS](\d+)$/i.exec(String(code ?? "").trim());
  return m ? `R${m[1].padStart(3, "0")}` : null;
}

export type StoreNeed = { material_id: string; period: string; store: string; qty: number };
export type StoreStock = { material_id: string; store: string; qty: number };
export type StoreTransferLine = { material_id: string; period: string; from: string; to: string; qty: number; by: string };

/**
 * Per material, period by period (earliest first): a store whose stock does not cover its need receives first from the
 * TRANSFER-SOURCE stores (R003), then from a peer R store's SPARE (its stock minus what it still needs itself in this and later
 * periods). The stock of a store falls by its need after each period. `by` = the first day of the period.
 */
export function scheduleStoreTransfers(args: {
  needs: readonly StoreNeed[];
  stocks: readonly StoreStock[];
  periods: ReadonlyArray<{ period: string; start: string }>;
  sourceStores: ReadonlySet<string>;
}): StoreTransferLine[] {
  const out = new Map<string, StoreTransferLine>();
  const materials = [...new Set(args.needs.map((n) => n.material_id))].sort();
  for (const material of materials) {
    const stock = new Map<string, number>();
    for (const s of args.stocks) if (s.material_id === material && s.store) stock.set(s.store, (stock.get(s.store) ?? 0) + Math.max(0, s.qty));
    const needOf = (store: string, period: string) => args.needs.filter((n) => n.material_id === material && n.store === store && n.period === period).reduce((sum, n) => sum + n.qty, 0);
    const destinations = [...new Set(args.needs.filter((n) => n.material_id === material && !args.sourceStores.has(n.store)).map((n) => n.store))].sort();
    args.periods.forEach(({ period, start }, index) => {
      const later = args.periods.slice(index).map((p) => p.period);
      for (const dest of destinations) {
        let short = needOf(dest, period) - (stock.get(dest) ?? 0);
        if (short <= EPSILON) continue;
        const take = (from: string, available: number) => {
          const qty = Math.min(short, Math.max(0, available));
          if (qty <= EPSILON) return;
          stock.set(from, (stock.get(from) ?? 0) - qty);
          stock.set(dest, (stock.get(dest) ?? 0) + qty);
          short -= qty;
          const key = `${material}|${period}|${from}|${dest}`;
          const seen = out.get(key);
          out.set(key, { material_id: material, period, from, to: dest, qty: round((seen?.qty ?? 0) + qty), by: start });
        };
        // DEPENDENT: each take lowers the stock the next one can use.
        for (const source of [...args.sourceStores].sort()) take(source, stock.get(source) ?? 0);
        for (const peer of [...new Set([...stock.keys(), ...destinations])].filter((store) => store !== dest && !args.sourceStores.has(store)).sort()) {
          if (short <= EPSILON) break;
          const stillNeeded = later.reduce((sum, p) => sum + needOf(peer, p), 0);
          take(peer, (stock.get(peer) ?? 0) - stillNeeded);
        }
      }
      for (const store of new Set([...stock.keys(), ...destinations])) stock.set(store, Math.max(0, (stock.get(store) ?? 0) - needOf(store, period)));
    });
  }
  return [...out.values()].filter((t) => t.qty > EPSILON).sort((a, b) => a.by.localeCompare(b.by) || a.material_id.localeCompare(b.material_id) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}
