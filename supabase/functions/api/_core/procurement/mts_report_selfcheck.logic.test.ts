import { selfCheckBlock } from "./mts_report_selfcheck.logic.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("report self-check: arithmetic holds, a counted lot after the last recorded order is fine", () => {
  const issues = selfCheckBlock([
    { day: "2026-11-17", opening: 3444, arrivals: 0, new_lot: null, use: 178.5, closing: 3265.5 },
    { day: "2026-11-23", opening: 2372.99, arrivals: 4600, new_lot: null, use: 178.51, closing: 6794.48 },
    { day: "2026-12-26", opening: 2894.76, arrivals: 0, new_lot: 4600, use: 106.01, closing: 7388.75 },
  ], "2026-11-23");
  assert(issues.length === 0, `no issue expected: ${issues.join(" | ")}`);
});

Deno.test("report self-check: a wrong closing and a counted lot inside the recorded orders are reported", () => {
  const wrongClosing = selfCheckBlock([{ day: "2026-11-23", opening: 2372.99, arrivals: 4600, new_lot: null, use: 178.51, closing: 9000 }], "2026-11-23");
  assert(wrongClosing.length === 1 && wrongClosing[0].includes("Closing 9000"), `closing mismatch: ${wrongClosing.join("|")}`);
  const inside = selfCheckBlock([{ day: "2026-11-22", opening: 100, arrivals: 0, new_lot: 50, use: 10, closing: 140 }], "2026-11-23");
  assert(inside.length === 1 && inside[0].includes("inside the recorded orders"), `lot inside: ${inside.join("|")}`);
});
