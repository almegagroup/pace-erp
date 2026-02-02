/*
 * File-ID: ID-6.16
 * File-Path: supabase/functions/api/_acl/acl_resolver.ts
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Final ACL decision engine (ALLOW / DENY with reason)
 * Authority: Backend
 *
 * NOTE:
 * - Precedence is LOCKED by ID-6.14
 * - VWED evaluation delegated to ID-6.15
 * - If any step cannot decide deterministically → DENY
 */

import { evaluateVwedPermission, type VwedAction, type VwedPermissionRow } from "./vwed_engine.ts";
import { isSuperAdmin, isGlobalAdmin } from "../_shared/role_ladder.ts";

/* =========================================================
 * Types
 * ========================================================= */

export type AclResolveInput = {
  authUserId: string;
  roleCode?: string;

  companyId: string;
  resourceCode: string;
  action: VwedAction;

  // Data already fetched by caller (NO DB HERE)
  moduleEnabled: boolean;
  userOverrides?: {
    effect: "ALLOW" | "DENY";
  } | null;

  rolePermissions?: VwedPermissionRow[];
  capabilityPermissions?: VwedPermissionRow[];
};

export type AclResolveResult =
  | { decision: "ALLOW"; reason: string }
  | { decision: "DENY"; reason: string };

/* =========================================================
 * Resolver
 * ========================================================= */

/**
 * Final ACL resolver
 *
 * Evaluation Order (ID-6.14 LOCKED):
 * 1. Admin universe (SA / GA)
 * 2. Module hard deny
 * 3. User override
 * 4. Role VWED
 * 5. Capability VWED
 * 6. Default DENY
 */
export function resolveAcl(input: AclResolveInput): AclResolveResult {
  const {
    roleCode,
    resourceCode,
    action,
    moduleEnabled,
    userOverrides,
    rolePermissions = [],
    capabilityPermissions = [],
  } = input;

  /* --------------------------------------------------
   * 1️⃣ Admin universe (SA / GA)
   * -------------------------------------------------- */
  if (isSuperAdmin(roleCode) || isGlobalAdmin(roleCode)) {
    return {
      decision: "ALLOW",
      reason: "ACL_ALLOW_ADMIN_UNIVERSE",
    };
  }

  /* --------------------------------------------------
   * 2️⃣ Module hard deny (ID-6.11A)
   * -------------------------------------------------- */
  if (!moduleEnabled) {
    return {
      decision: "DENY",
      reason: "ACL_DENY_MODULE_NOT_ENABLED",
    };
  }

  /* --------------------------------------------------
   * 3️⃣ User override (ID-6.12)
   * -------------------------------------------------- */
  if (userOverrides) {
    if (userOverrides.effect === "DENY") {
      return {
        decision: "DENY",
        reason: "ACL_DENY_USER_OVERRIDE",
      };
    }

    if (userOverrides.effect === "ALLOW") {
      return {
        decision: "ALLOW",
        reason: "ACL_ALLOW_USER_OVERRIDE",
      };
    }
  }

  /* --------------------------------------------------
   * 4️⃣ Role VWED (ID-6.15)
   * -------------------------------------------------- */
  const roleEval = evaluateVwedPermission({
    resourceCode,
    action,
    permissions: rolePermissions,
  });

  if (roleEval.allowed) {
    return {
      decision: "ALLOW",
      reason: "ACL_ALLOW_ROLE_PERMISSION",
    };
  }

  /* --------------------------------------------------
   * 5️⃣ Capability VWED (ID-6.15)
   * -------------------------------------------------- */
  const capEval = evaluateVwedPermission({
    resourceCode,
    action,
    permissions: capabilityPermissions,
  });

  if (capEval.allowed) {
    return {
      decision: "ALLOW",
      reason: "ACL_ALLOW_CAPABILITY_PERMISSION",
    };
  }

  /* --------------------------------------------------
   * 6️⃣ Default deny (Fail-safe)
   * -------------------------------------------------- */
  return {
    decision: "DENY",
    reason: "ACL_DEFAULT_DENY_NO_MATCH",
  };
}
