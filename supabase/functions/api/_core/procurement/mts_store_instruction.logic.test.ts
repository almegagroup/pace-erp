import { rStoreKey, scheduleStoreTransfers } from "./mts_store_instruction.logic.ts";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const periods = [{ period: "CM", start: "2026-10-28" }, { period: "NM", start: "2026-11-01" }];
const R3 = new Set(["R003"]);

Deno.test("an R, S or P code: S00n is fed from R00n, P and others are not part of the R transfer advice", () => {
  assert(rStoreKey("R001") === "R001" && rStoreKey("S002") === "R002" && rStoreKey("r3") === "R003", "R/S -> R00n");
  assert(rStoreKey("P001") === null && rStoreKey("OT01") === null, "P / OT are not R stores");
});

Deno.test("R003 -> R001: the short store receives from the transfer-source store, dated by the period it is needed", () => {
  const t = scheduleStoreTransfers({
    needs: [{ material_id: "M", period: "CM", store: "R001", qty: 1000 }, { material_id: "M", period: "NM", store: "R001", qty: 1500 }],
    stocks: [{ material_id: "M", store: "R001", qty: 400 }, { material_id: "M", store: "R003", qty: 5000 }],
    periods, sourceStores: R3,
  });
  assert(t.length === 2, JSON.stringify(t));
  assert(t[0].from === "R003" && t[0].to === "R001" && t[0].qty === 600 && t[0].by === "2026-10-28", `CM: 1000 - 400 on hand: ${JSON.stringify(t[0])}`);
  assert(t[1].qty === 1500 && t[1].by === "2026-11-01", `NM: the stock was used up, the whole 1500 comes: ${JSON.stringify(t[1])}`);
});

Deno.test("R001 <-> R002: a store with spare gives to the short one; its own later need is protected", () => {
  const t = scheduleStoreTransfers({
    needs: [{ material_id: "M", period: "CM", store: "R001", qty: 1000 }, { material_id: "M", period: "CM", store: "R002", qty: 200 }, { material_id: "M", period: "NM", store: "R002", qty: 300 }],
    stocks: [{ material_id: "M", store: "R001", qty: 100 }, { material_id: "M", store: "R002", qty: 1200 }],
    periods, sourceStores: R3,
  });
  // R001 is short 900. R002 holds 1200 but needs 200 + 300 itself -> spare 700.
  assert(t.length === 1 && t[0].from === "R002" && t[0].to === "R001" && t[0].qty === 700, JSON.stringify(t));
});

Deno.test("R003 is used before a peer store, and nothing moves when the store is covered", () => {
  const t = scheduleStoreTransfers({
    needs: [{ material_id: "M", period: "CM", store: "R001", qty: 500 }, { material_id: "N", period: "CM", store: "R001", qty: 100 }],
    stocks: [{ material_id: "M", store: "R001", qty: 100 }, { material_id: "M", store: "R002", qty: 9000 }, { material_id: "M", store: "R003", qty: 300 }, { material_id: "N", store: "R001", qty: 100 }],
    periods, sourceStores: R3,
  });
  const fromR3 = t.find((x) => x.from === "R003");
  const fromR2 = t.find((x) => x.from === "R002");
  assert(t.length === 2 && fromR3?.qty === 300 && fromR2?.qty === 100, JSON.stringify(t));
  assert(!t.some((x) => x.material_id === "N"), "material N is covered where it is needed");
});
