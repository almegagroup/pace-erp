/*
 * File-ID: ID-6.15
 * File-Path: supabase/functions/api/_acl/vwed_engine.ts
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: VWED action authorization engine
 * Authority: Backend
 *
 * NOTE:
 * - This file ONLY evaluates action-level permission
 * - No precedence, no overrides, no module checks
 * - Deterministic, stateless, pure evaluation
 */

/* =========================================================
 * Types
 * ========================================================= */

export type VwedAction =
  | "VIEW"
  | "WRITE"
  | "EDIT"
  | "DELETE"
  | "APPROVE"
  | "EXPORT";

export type VwedPermissionRow = {
  resource_code: string;
  can_view: boolean;
  can_write: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
  can_export: boolean;
};

/* =========================================================
 * Internal helpers
 * ========================================================= */

function actionToColumn(action: VwedAction): keyof VwedPermissionRow {
  switch (action) {
    case "VIEW":
      return "can_view";
    case "WRITE":
      return "can_write";
    case "EDIT":
      return "can_edit";
    case "DELETE":
      return "can_delete";
    case "APPROVE":
      return "can_approve";
    case "EXPORT":
      return "can_export";
    default:
      // exhaustive safety
      throw new Error("VWED_UNKNOWN_ACTION");
  }
}

/* =========================================================
 * VWED Evaluation Engine
 * ========================================================= */

/**
 * Evaluate whether a specific action is allowed on a resource.
 *
 * Contract:
 * - Input MUST already be scoped (role / capability resolved upstream)
 * - Multiple permission rows may exist → ANY true grants ALLOW
 * - Absence of permission rows → DENY
 */
export function evaluateVwedPermission(params: {
  resourceCode: string;
  action: VwedAction;
  permissions: VwedPermissionRow[];
}): { allowed: boolean } {
  const { resourceCode, action, permissions } = params;

  if (!permissions || permissions.length === 0) {
    return { allowed: false };
  }

  const column = actionToColumn(action);

  for (const row of permissions) {
    if (row.resource_code !== resourceCode) continue;
    if (row[column] === true) {
      return { allowed: true };
    }
  }

  return { allowed: false };
}
