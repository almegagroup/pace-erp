/*
 * File-ID: 8A
 * File-Path: supabase/functions/api/_pipeline/acl.ts
 * Gate: 1
 * Phase: 1
 * Domain: ACL
 * Purpose: ACL resolver skeleton + decision contract
 * Authority: Backend
 */

export type AclDecision =
  | { decision: "ALLOW" }
  | {
      decision: "DENY";
      reason: string;
      action?: "NONE" | "LOGOUT" | "REDIRECT" | "RELOAD";
    };

export async function stepAcl(
  _req: Request,
  _requestId: string
): Promise<AclDecision> {
  // Gate-1: no ACL logic yet
  // Deterministic default
  return {
    decision: "DENY",
    reason: "ACL_NOT_INITIALIZED",
    action: "NONE",
  };
}
