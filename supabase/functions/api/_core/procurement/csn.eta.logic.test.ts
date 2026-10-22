import { calculateETACascade } from "./csn.handlers.ts";

function equal<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const domesticLeadTime = { transit_days: 12 };

Deno.test("domestic ETA uses an optional PO delivery date when it is supplied", () => {
  const updates = calculateETACascade(
    { csn_type: "DOMESTIC", etd: null, lr_date: null, gate_entry_date: null },
    null,
    domesticLeadTime,
    null,
    "2026-10-10",
  );

  equal(updates, {
    etd: "2026-10-10",
    eta_to_plant_calculated: "2026-10-22",
  }, "PO delivery date must seed domestic ETD and plant ETA");
});

Deno.test("manual domestic ETD is recalculated into plant ETA", () => {
  const updates = calculateETACascade(
    { csn_type: "DOMESTIC", etd: "2026-10-12", lr_date: null, gate_entry_date: null },
    null,
    domesticLeadTime,
    null,
    "2026-10-10",
  );

  equal(updates, {
    eta_to_plant_calculated: "2026-10-24",
  }, "manual ETD must override the PO baseline");
});

Deno.test("domestic LR date overrides ETD for plant ETA", () => {
  const updates = calculateETACascade(
    { csn_type: "DOMESTIC", etd: "2026-10-12", lr_date: "2026-10-15", gate_entry_date: null },
    null,
    domesticLeadTime,
    null,
    "2026-10-10",
  );

  equal(updates, {
    eta_to_plant_calculated: "2026-10-27",
  }, "LR date must override ETD for the in-transit ETA");
});
