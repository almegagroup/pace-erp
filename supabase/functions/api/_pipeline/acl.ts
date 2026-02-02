/*
 * File-ID: ID-6
 * File-Path: supabase/functions/api/_pipeline/acl.ts
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: ACL authority lock + request-time enforcement adapter
 * Authority: Backend
 *
 * NOTE:
 * - Frontend has ZERO authority
 * - Database is enforcement layer, not decision maker
 * - If ACL cannot decide deterministically → DENY
 */

import { resolveAcl } from "../_acl/acl_resolver.ts";
import type {
  VwedAction,
  VwedPermissionRow,
} from "../_acl/vwed_engine.ts";

export type AclDecision =
  | { decision: "ALLOW" }
  | {
      decision: "DENY";
      reason: string;
      action?: "NONE" | "LOGOUT" | "REDIRECT" | "RELOAD";
    };

/**
 * ACL pipeline step (G11)
 *
 * Contract:
 * - Runs AFTER session + context resolution
 * - Runs BEFORE handler execution
 * - Runner MUST enforce DENY responses
 */
export function stepAcl(
  _req: Request,
  _requestId: string,
  ctx?: {
    context?: {
      state?: "RESOLVED" | "UNRESOLVED";

      // ===== Gate-5 / G4 resolved truth =====
      authUserId?: string;
      roleCode?: string;
      companyId?: string;

      // ===== Gate-6 truth flags (no permission materialization yet) =====
      moduleEnabled?: boolean;
      userOverrides?: { effect: "ALLOW" | "DENY" } | null;
    };

    route?: {
      isPublic?: boolean;
      resourceCode?: string;
      action?: VwedAction;
    };
  }
): AclDecision {
  /* --------------------------------------------------
   * 1️⃣ Public route short-circuit
   * -------------------------------------------------- */
  if (ctx?.route?.isPublic === true) {
    return { decision: "ALLOW" };
  }

  /* --------------------------------------------------
   * 2️⃣ Context authority enforcement (Gate-5 invariant)
   * -------------------------------------------------- */
  if (ctx?.context?.state !== "RESOLVED") {
    return {
      decision: "DENY",
      reason: "ACL_BLOCKED_BY_UNRESOLVED_CONTEXT",
      action: "NONE",
    };
  }

  /* --------------------------------------------------
   * 3️⃣ Mandatory input sanity (fail-safe)
   * -------------------------------------------------- */
  const {
    authUserId,
    roleCode,
    companyId,
    moduleEnabled,
    userOverrides,
  } = ctx.context ?? {};

  const { resourceCode, action } = ctx.route ?? {};

  if (
    !authUserId ||
    !companyId ||
    !resourceCode ||
    !action ||
    moduleEnabled === undefined
  ) {
    return {
      decision: "DENY",
      reason: "ACL_DENY_INCOMPLETE_INPUT",
      action: "NONE",
    };
  }

  /* --------------------------------------------------
   * 4️⃣ Gate-10 / ID-6.14: Execute ACL resolver (G11)
   *
   * IMPORTANT:
   * - rolePermissions / capabilityPermissions DO NOT
   *   originate at runtime yet (state-file compliant)
   * - Empty arrays = “no permission truth”
   * -------------------------------------------------- */
  const result = resolveAcl({
    authUserId,
    roleCode,
    companyId,
    resourceCode,
    action,
    moduleEnabled,
    userOverrides,

    rolePermissions: [] as VwedPermissionRow[],
    capabilityPermissions: [] as VwedPermissionRow[],
  });

  if (result.decision === "ALLOW") {
    return { decision: "ALLOW" };
  }

  return {
    decision: "DENY",
    reason: result.reason,
    action: "NONE",
  };
}
