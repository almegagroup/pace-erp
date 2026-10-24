import {
  DEFAULT_GROUP_TARGET_DAYS,
  defaultCriticalDays,
  derivedGroupDesiredMaxDays,
  effectiveGroupCoveragePolicies,
  groupDesiredMaxDays,
} from "./mts_group_policy.logic.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("family group policy: default target is 30 and default critical is half rounded up", () => {
  assert(DEFAULT_GROUP_TARGET_DAYS === 30, "missing group target must be 30 days");
  assert(defaultCriticalDays(31) === 16, "critical default must be rounded up");
});

Deno.test("family group policy: Desired Max uses the safe member value above the mean", () => {
  assert(derivedGroupDesiredMaxDays([60, 60, 50]) === 60, "60 + 60 + 50 must resolve to 60");
  assert(derivedGroupDesiredMaxDays([40, 80]) === 80, "mean 60 must resolve to next actual member maximum 80");
  assert(derivedGroupDesiredMaxDays([40, null]) === null, "missing individual Desired Max must not be guessed");
});

Deno.test("family group policy: dated override carries forward and supersedes derivation", () => {
  const effective = effectiveGroupCoveragePolicies([
    { material_group_id: "RDP", effective_from: "2026-10-01", target_days: 30, critical_days: 15, desired_max_days_override: null },
    { material_group_id: "RDP", effective_from: "2026-12-01", target_days: 35, critical_days: 18, desired_max_days_override: 70 },
  ], "2027-01-15").get("RDP");
  assert(effective?.target_days === 35, "latest dated group policy must carry forward");
  assert(groupDesiredMaxDays(effective, [60, 60, 50]) === 70, "explicit Desired Max override must win");
});
