import {
  buildFamilyPurposeLedgerInput,
  runFamilyPurposeLedger,
} from "./mts_family_purpose_ledger.logic.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("W3g: one receipt carries direct, narrow and broad purpose balances without a daily refill", () => {
  const result = runFamilyPurposeLedger({
    opening: { BETONE: 320 },
    supplies: [],
    days: 2,
    purposes: [
      {
        id: "DIRECT",
        priority: 1,
        candidates: ["BETONE"],
        demand: [20, 20],
        target_balance: [25, 25],
        desired_balance: [80, 80],
      },
      {
        id: "GROUP_A",
        priority: 2,
        candidates: ["BETONE"],
        demand: [25, 25],
        target_balance: [25, 25],
        desired_balance: [75, 75],
      },
      {
        id: "GROUP_B",
        priority: 3,
        candidates: ["BETONE"],
        demand: [30, 30],
        target_balance: [30, 30],
        desired_balance: [90, 90],
      },
    ],
  });
  const day0 = result.rows.filter((row) => row.day === 0);
  const day1 = result.rows.filter((row) => row.day === 1);
  assert(
    day0.find((row) => row.purpose_id === "DIRECT")?.closing_qty === 80,
    JSON.stringify(day0),
  );
  assert(
    day0.find((row) => row.purpose_id === "GROUP_A")?.closing_qty === 75,
    JSON.stringify(day0),
  );
  assert(
    day0.find((row) => row.purpose_id === "GROUP_B")?.closing_qty === 90,
    JSON.stringify(day0),
  );
  assert(
    day1.every((row) => row.allocated_qty === 0),
    `day two must consume carried balances, not recreate Desired Max: ${
      JSON.stringify(day1)
    }`,
  );
});

Deno.test("W3g: an eligible alternative is pre-allocated but VINNAPAS is consumed first", () => {
  const result = runFamilyPurposeLedger({
    opening: { VINNAPAS: 20, DA: 100 },
    supplies: [],
    days: 2,
    purposes: [{
      id: "RDP_TLA",
      priority: 1,
      candidates: ["VINNAPAS", "DA"],
      consume_order: ["VINNAPAS", "DA"],
      demand: [20, 20],
      target_balance: [10, 10],
      desired_balance: [30, 30],
    }],
  });
  const day0 = result.rows.find((row) => row.day === 0)!;
  assert(
    day0.opening_qty === 50 && day0.closing_qty === 30 &&
      day0.by_material.DA === 30 && day0.consumed_by_material.VINNAPAS === 20,
    `the 20 KG VINNAPAS must be consumed before the pre-allocated DA balance: ${
      JSON.stringify(result.rows)
    }`,
  );
});

Deno.test("W3g adapter: dated PO22 demand and ETA supplies keep their exact event day", () => {
  const input = buildFamilyPurposeLedgerInput({
    days: ["2026-10-25", "2026-10-26"],
    opening: { BETONE: 100 },
    purposes: [
      {
        id: "BETON",
        priority: 2,
        candidates: ["BETONE"],
        day: "2026-10-25",
        demand_qty: 20,
        target_qty: 30,
        desired_qty: 60,
      },
      {
        id: "BETON",
        priority: 2,
        candidates: ["BETONE"],
        day: "2026-10-26",
        demand_qty: 20,
        target_qty: 30,
        desired_qty: 60,
      },
    ],
    supplies: [{
      day: "2026-10-26",
      material_id: "BETONE",
      qty: 2_000,
      reference: "CSN 1",
    }],
  });
  assert(
    input.purposes[0].demand[0] === 20 && input.purposes[0].demand[1] === 20,
    JSON.stringify(input),
  );
  assert(
    input.supplies[0].day === 1 && input.supplies[0].qty === 2_000,
    JSON.stringify(input),
  );
});

Deno.test("W3h: BETONE, SAPCOMER and BENTONE keep direct, narrow and broad balances after one event-day allocation", () => {
  // Owner's canonical overlap: BETONE has direct/exclusive use; BETONE +
  // SAPCOMER serve the narrow group; all three serve the broad group.  The
  // opening balance is allocated in that order once.  It is not recreated on
  // the following calendar day merely because one day of consumption passed.
  const result = runFamilyPurposeLedger({
    opening: { BETONE: 2_500, SAPCOMER: 1_200, BENTONE: 1_200 },
    days: 2,
    supplies: [],
    purposes: [
      {
        id: "DIRECT:BETONE",
        priority: 0,
        candidates: ["BETONE"],
        demand: [20, 20],
        target_balance: [500, 500],
        desired_balance: [1_100, 1_100],
      },
      {
        id: "GROUP:BETON",
        priority: 1,
        candidates: ["BETONE", "SAPCOMER"],
        demand: [25, 25],
        target_balance: [625, 625],
        desired_balance: [1_375, 1_375],
      },
      {
        id: "GROUP:BROAD",
        priority: 2,
        candidates: ["BETONE", "SAPCOMER", "BENTONE"],
        demand: [30, 30],
        target_balance: [900, 900],
        desired_balance: [1_650, 1_650],
      },
    ],
  });
  const direct0 = result.rows.find((row) =>
    row.day === 0 && row.purpose_id === "DIRECT:BETONE"
  )!;
  const narrow0 = result.rows.find((row) =>
    row.day === 0 && row.purpose_id === "GROUP:BETON"
  )!;
  const broad0 = result.rows.find((row) =>
    row.day === 0 && row.purpose_id === "GROUP:BROAD"
  )!;
  assert(
    direct0.closing_qty === 1_100 && direct0.by_material.BETONE === 1_100,
    JSON.stringify(direct0),
  );
  assert(
    direct0.allocated_by_material.BETONE === 1_120,
    JSON.stringify(direct0),
  );
  assert(
    narrow0.closing_qty === 1_375 && narrow0.by_material.BETONE === 1_355 &&
      narrow0.by_material.SAPCOMER === 20,
    JSON.stringify(narrow0),
  );
  assert(
    narrow0.allocated_by_material.BETONE === 1_380 &&
      narrow0.allocated_by_material.SAPCOMER === 20,
    JSON.stringify(narrow0),
  );
  assert(
    broad0.closing_qty === 1_650 && broad0.by_material.SAPCOMER === 1_150 &&
      broad0.by_material.BENTONE === 500,
    `broad group must receive only the stock left after direct and narrow allocation: ${
      JSON.stringify(broad0)
    }`,
  );
  assert(
    broad0.allocated_by_material.SAPCOMER === 1_180 &&
      broad0.allocated_by_material.BENTONE === 500,
    JSON.stringify(broad0),
  );
  const day1 = result.rows.filter((row) => row.day === 1);
  assert(
    day1.every((row) => row.allocated_qty === 0),
    `no new receipt means no daily re-allocation: ${JSON.stringify(day1)}`,
  );
});

Deno.test("W3h: a zero-stock overlap exposes each purpose's Desired-Max shortfall before one MOQ decision", () => {
  const result = runFamilyPurposeLedger({
    opening: { BETONE: 0, SAPCOMER: 0, BENTONE: 0 },
    days: 1,
    supplies: [],
    purposes: [
      { id: "DIRECT:BETONE", priority: 0, candidates: ["BETONE"], demand: [20], target_balance: [500], desired_balance: [1_100] },
      { id: "GROUP:BETON", priority: 1, candidates: ["BETONE", "SAPCOMER"], demand: [25], target_balance: [625], desired_balance: [1_375] },
      { id: "GROUP:BROAD", priority: 2, candidates: ["BETONE", "SAPCOMER", "BENTONE"], demand: [30], target_balance: [900], desired_balance: [1_650] },
    ],
  });
  const shortfall = Object.fromEntries(result.rows.map((row) => [row.purpose_id, row.desired_shortfall_qty]));
  assert(
    shortfall["DIRECT:BETONE"] === 1_100 && shortfall["GROUP:BETON"] === 1_375 && shortfall["GROUP:BROAD"] === 1_650,
    `each purpose must state its own shortfall before a single physical receipt is sized: ${JSON.stringify(result.rows)}`,
  );
});
