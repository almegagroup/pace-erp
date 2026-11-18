import { assertEquals } from "jsr:@std/assert@1";
import { addDaysToIso, carryCover, levelRecordUpTo, reportKeepDays } from "./mts_level_cover.logic.ts";

const days = [
  { day: "2026-11-18", levels: [{ level_key: "A" }, { level_key: "B" }] },
  { day: "2026-11-22", levels: [{ level_key: "A" }] },
  { day: "2026-12-01", levels: [{ level_key: "B" }] },
];

Deno.test("a level with no record on the date uses its latest earlier record and counts the quiet days", () => {
  const hit = levelRecordUpTo(days, "B", "2026-11-25");
  assertEquals(hit?.record.day, "2026-11-18");
  assertEquals(hit?.gap, 7);
});

Deno.test("an exact record wins and has no quiet days", () => {
  const hit = levelRecordUpTo(days, "A", "2026-11-22");
  assertEquals(hit?.record.day, "2026-11-22");
  assertEquals(hit?.gap, 0);
});

Deno.test("no record yet, or no date: nothing to carry", () => {
  assertEquals(levelRecordUpTo(days, "B", "2026-11-10"), null);
  assertEquals(levelRecordUpTo(days, "A", null), null);
});

Deno.test("cover is carried over quiet days, never below zero, null stays null", () => {
  assertEquals(carryCover(89, 7), 82);
  assertEquals(carryCover(3, 7), 0);
  assertEquals(carryCover(null, 7), null);
  assertEquals(addDaysToIso("2026-11-22", -1), "2026-11-21");
});

Deno.test("report keeps today, every landing day and the day before it (so 'before' is exact, never estimated)", () => {
  const keep = reportKeepDays("2026-11-18", ["2026-12-13", "2026-12-19"]);
  assertEquals([...keep].sort(), ["2026-11-18", "2026-12-12", "2026-12-13", "2026-12-18", "2026-12-19"]);
});
