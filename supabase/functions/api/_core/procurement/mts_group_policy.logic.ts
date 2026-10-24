/**
 * PO22 Family Waterfall — effective group coverage policy.
 *
 * Kept pure so the API, planner and UI preview use the same dated rule.  A
 * group cannot invent a lower Desired Max than its member policy calculation:
 * absent override is the safe rounded-up member maximum described by the owner.
 */
export type GroupCoveragePolicyVersion = {
  material_group_id: string;
  effective_from: string;
  target_days: number;
  critical_days: number;
  desired_max_days_override: number | null;
};

export const DEFAULT_GROUP_TARGET_DAYS = 30;
export const defaultCriticalDays = (targetDays: number) => Math.ceil(targetDays / 2);

export function effectiveGroupCoveragePolicies(
  rows: readonly GroupCoveragePolicyVersion[], day: string,
): ReadonlyMap<string, GroupCoveragePolicyVersion> {
  const result = new Map<string, GroupCoveragePolicyVersion>();
  for (const row of rows) {
    if (row.effective_from > day) continue;
    const prior = result.get(row.material_group_id);
    if (!prior || prior.effective_from < row.effective_from) result.set(row.material_group_id, row);
  }
  return result;
}

/**
 * Arithmetic mean of individual Desired Max values, rounded upward to the
 * smallest *actual* member Desired Max.  E.g. 60 + 60 + 50 = 56.67 → 60.
 * Missing member values are deliberately surfaced rather than guessed.
 */
export function derivedGroupDesiredMaxDays(memberDesiredMaxDays: readonly (number | null | undefined)[]): number | null {
  if (memberDesiredMaxDays.length === 0 || memberDesiredMaxDays.some((value) => value === null || value === undefined || !Number.isFinite(value) || value < 0)) return null;
  const values = memberDesiredMaxDays as readonly number[];
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return [...values].sort((a, b) => a - b).find((value) => value + 1e-9 >= average) ?? null;
}

export function groupDesiredMaxDays(policy: GroupCoveragePolicyVersion | null | undefined, memberDesiredMaxDays: readonly (number | null | undefined)[]): number | null {
  if (policy?.desired_max_days_override !== null && policy?.desired_max_days_override !== undefined) return policy.desired_max_days_override;
  return derivedGroupDesiredMaxDays(memberDesiredMaxDays);
}
