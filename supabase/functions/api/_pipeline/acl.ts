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
import { log } from "../_lib/logger.ts";
import type {
  VwedAction,
  VwedPermissionRow,
} from "../_acl/vwed_engine.ts";
import { getServiceRoleClientWithContext } from "../_shared/serviceRoleClient.ts";
import type { SupabaseClient } from "@supabase/supabase-js"
import { recordSecurityEvent } from "../_security/security_events.ts";

async function getActiveAclVersionId(
  db: SupabaseClient
): Promise<string> {
  const { data, error } = await db
    .schema("acl").from("acl_versions")
    .select("acl_version_id")
    .eq("is_active", true)
    .single();

  if (error || !data?.acl_version_id) {
    throw new Error("ACL_ACTIVE_VERSION_NOT_FOUND");
  }

  return data.acl_version_id;
}

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
export async function stepAcl(
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
): Promise<AclDecision> {
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
 * 4️⃣ Phase-B2: Snapshot Consumption
 * -------------------------------------------------- */

const db = getServiceRoleClientWithContext({
  status: "RESOLVED",
  source: "BACKEND",
  companyId,
  roleCode: roleCode ?? "",
});

const activeAclVersionId = await getActiveAclVersionId(db);

const { data, error } = await db
  .schema("acl").from("precomputed_acl_view")
  .select(`
    resource_code,
    action_code,
    decision,
    decision_reason
  `)
  .eq("acl_version_id", activeAclVersionId)
  .eq("auth_user_id", authUserId)
  .eq("company_id", companyId)
  .eq("resource_code", resourceCode)
  .eq("action_code", action);

if (error) {
  return {
    decision: "DENY",
    reason: "ACL_SNAPSHOT_QUERY_FAILED",
    action: "NONE",
  };
}

const snapshotPermissions: VwedPermissionRow[] = [];

for (const row of data ?? []) {
  if (row.decision !== "ALLOW") continue;

  snapshotPermissions.push({
    resource_code: row.resource_code,
    can_view: row.action_code === "VIEW",
    can_write: row.action_code === "WRITE",
    can_edit: row.action_code === "EDIT",
    can_delete: row.action_code === "DELETE",
    can_approve: row.action_code === "APPROVE",
    can_export: row.action_code === "EXPORT",
  });
}

const result = resolveAcl({
  authUserId,
  roleCode,
  companyId,
  resourceCode,
  action,
  moduleEnabled,
  userOverrides,
  rolePermissions: snapshotPermissions,
  capabilityPermissions: snapshotPermissions,
});

  log({
  level: "OBSERVABILITY",
  request_id: _requestId,
  gate_id: "10.4",
  route_key: `${resourceCode}:${action}`,
  event: "ACL_DECISION_TRACE",
  decision: result.decision,
  actor: authUserId,
  meta: {
    company_id: companyId,
    resource_code: resourceCode,
    action,
    trace: result.trace,
  },
});

  if (result.decision === "ALLOW") {
    return { decision: "ALLOW" };
  }

recordSecurityEvent(
  _req,
  _requestId,
  "ACL_DENY",
  "ACL",
  `${resourceCode}:${action}`,
  {
    user_id: authUserId,
    company_id: companyId,
    reason: result.reason
  }
);

return {
  decision: "DENY",
  reason: result.reason,
  action: "NONE",
};
}
