/*
 * File-ID: ID-6.16
 * File-Path: supabase/functions/api/_acl/acl_resolver.ts
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Final ACL decision engine (ALLOW / DENY with reason + trace)
 * Authority: Backend
 *
 * NOTE:
 * - Precedence is LOCKED by ID-6.14
 * - VWED evaluation delegated to ID-6.15
 * - If any step cannot decide deterministically → DENY
 * - Trace is internal explainability layer (non-breaking)
 */

import {
  evaluateVwedPermission,
  type VwedAction,
  type VwedPermissionRow,
} from "./vwed_engine.ts";

import {
  isSuperAdmin,
  isGlobalAdmin,
} from "../_shared/role_ladder.ts";

import {
  createDecisionTrace,
  type AclDecisionTrace,
} from "./decision_trace.ts";

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
  | { decision: "ALLOW"; reason: string; trace: AclDecisionTrace }
  | { decision: "DENY"; reason: string; trace: AclDecisionTrace };

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
export function resolveAcl(
  input: AclResolveInput
): AclResolveResult {
  const trace = createDecisionTrace();

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
    trace.add({
      layer: "ADMIN_BYPASS",
      outcome: "ALLOW",
      reason: "ACL_ALLOW_ADMIN_UNIVERSE",
    });

    return {
      decision: "ALLOW",
      reason: "ACL_ALLOW_ADMIN_UNIVERSE",
      trace: trace.finalize("ALLOW"),
    };
  }

  trace.add({
    layer: "ADMIN_BYPASS",
    outcome: "SKIPPED",
    reason: "NOT_ADMIN",
  });

  /* --------------------------------------------------
   * 2️⃣ Module hard deny
   * -------------------------------------------------- */
  if (!moduleEnabled) {
    trace.add({
      layer: "MODULE_HARD_DENY",
      outcome: "DENY",
      reason: "ACL_DENY_MODULE_NOT_ENABLED",
    });

    return {
      decision: "DENY",
      reason: "ACL_DENY_MODULE_NOT_ENABLED",
      trace: trace.finalize("DENY"),
    };
  }

  trace.add({
    layer: "MODULE_HARD_DENY",
    outcome: "SKIPPED",
    reason: "MODULE_ENABLED",
  });

  /* --------------------------------------------------
   * 3️⃣ User override
   * -------------------------------------------------- */
  if (userOverrides) {
    if (userOverrides.effect === "DENY") {
      trace.add({
        layer: "USER_OVERRIDE_DENY",
        outcome: "DENY",
        reason: "ACL_DENY_USER_OVERRIDE",
      });

      return {
        decision: "DENY",
        reason: "ACL_DENY_USER_OVERRIDE",
        trace: trace.finalize("DENY"),
      };
    }

    if (userOverrides.effect === "ALLOW") {
      trace.add({
        layer: "USER_OVERRIDE_ALLOW",
        outcome: "ALLOW",
        reason: "ACL_ALLOW_USER_OVERRIDE",
      });

      return {
        decision: "ALLOW",
        reason: "ACL_ALLOW_USER_OVERRIDE",
        trace: trace.finalize("ALLOW"),
      };
    }
  }

  /* --------------------------------------------------
   * 4️⃣ Role VWED
   * -------------------------------------------------- */
  const roleEval = evaluateVwedPermission({
    resourceCode,
    action,
    permissions: rolePermissions,
  });

  if (roleEval.allowed) {
    trace.add({
      layer: "ROLE_PERMISSION",
      outcome: "ALLOW",
      reason: "ACL_ALLOW_ROLE_PERMISSION",
    });

    return {
      decision: "ALLOW",
      reason: "ACL_ALLOW_ROLE_PERMISSION",
      trace: trace.finalize("ALLOW"),
    };
  }

  trace.add({
    layer: "ROLE_PERMISSION",
    outcome: "SKIPPED",
    reason: "ROLE_NO_MATCH",
  });

  /* --------------------------------------------------
   * 5️⃣ Capability VWED
   * -------------------------------------------------- */
  const capEval = evaluateVwedPermission({
    resourceCode,
    action,
    permissions: capabilityPermissions,
  });

  if (capEval.allowed) {
    trace.add({
      layer: "CAPABILITY_PERMISSION",
      outcome: "ALLOW",
      reason: "ACL_ALLOW_CAPABILITY_PERMISSION",
    });

    return {
      decision: "ALLOW",
      reason: "ACL_ALLOW_CAPABILITY_PERMISSION",
      trace: trace.finalize("ALLOW"),
    };
  }

  trace.add({
    layer: "CAPABILITY_PERMISSION",
    outcome: "SKIPPED",
    reason: "CAPABILITY_NO_MATCH",
  });

  /* --------------------------------------------------
   * 6️⃣ Default deny (Fail-safe)
   * -------------------------------------------------- */
  trace.add({
    layer: "DEFAULT_DENY",
    outcome: "DENY",
    reason: "ACL_DEFAULT_DENY_NO_MATCH",
  });

  return {
    decision: "DENY",
    reason: "ACL_DEFAULT_DENY_NO_MATCH",
    trace: trace.finalize("DENY"),
  };
}