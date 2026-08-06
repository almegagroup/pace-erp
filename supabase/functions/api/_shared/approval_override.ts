/*
 * File-Path: supabase/functions/api/_shared/approval_override.ts
 * Purpose: Centralize blanket approval override rules used across modules.
 */

type ApprovalOverrideContext = {
  roleCode: string;
  context?: {
    workContextCode?: string | null;
    workContextName?: string | null;
  } | null;
};

function toUpperTrimmedString(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/*
 * Bug found + fixed 2026-08-06: this previously compared workContextCode
 * (a per-company DEPT_DPTxxx value, e.g. "DEPT_DPT030") against the literal
 * string "ACL_MASTER" -- that comparison could never match any real value,
 * so this branch was dead code, silently masked only because ACL-MASTER's
 * one current holder (P0076) also happens to be role_code=DIRECTOR and gets
 * through on that check instead. work_context_name is the only field that's
 * actually always "ACL-MASTER" (with a hyphen) regardless of company, so
 * that's what this must check for the override to hold even if ACL-MASTER
 * is ever assigned to a non-DIRECTOR-role account.
 */
export function hasBlanketApprovalOverride(ctx: ApprovalOverrideContext): boolean {
  const roleCode = toUpperTrimmedString(ctx.roleCode);
  const workContextName = toUpperTrimmedString(ctx.context?.workContextName);
  return roleCode === "SA"
    || roleCode === "GA"
    || roleCode === "DIRECTOR"
    || workContextName === "ACL-MASTER";
}
