/*
 * File-Path: supabase/functions/api/_shared/approval_override.ts
 * Purpose: Centralize blanket approval override rules used across modules.
 */

type ApprovalOverrideContext = {
  roleCode: string;
  context?: {
    workContextCode?: string | null;
  } | null;
};

function toUpperTrimmedString(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function hasBlanketApprovalOverride(ctx: ApprovalOverrideContext): boolean {
  const roleCode = toUpperTrimmedString(ctx.roleCode);
  const workContextCode = toUpperTrimmedString(ctx.context?.workContextCode);
  return roleCode === "SA"
    || roleCode === "GA"
    || roleCode === "DIRECTOR"
    || workContextCode === "ACL_MASTER";
}
