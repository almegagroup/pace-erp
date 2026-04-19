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

import { log } from "../_lib/logger.ts";
import type {
  VwedAction,
} from "../_acl/vwed_engine.ts";
import { getServiceRoleClientWithContext } from "../_shared/serviceRoleClient.ts";
import type { SupabaseClient } from "@supabase/supabase-js"
import { recordSecurityEvent } from "../_security/security_events.ts";
import { readAclSnapshotDecision } from "../_shared/acl_snapshot.ts";

async function getActiveAclVersionId(
  db: SupabaseClient,
  companyId: string,
): Promise<string> {
  const { data, error } = await db
    .schema("acl").from("acl_versions")
    .select("acl_version_id")
    .eq("company_id", companyId)
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
      workContextId?: string;
      isAdmin?: boolean;
    };

    route?: {
      isPublic?: boolean;
      skipAcl?: boolean;
      resourceCode?: string;
      action?: VwedAction;
    };
  }
): Promise<AclDecision> {
  /* --------------------------------------------------
 * 🔥 0️⃣ ADMIN BYPASS (SSOT FIX)
 * -------------------------------------------------- */
if (ctx?.context?.isAdmin === true) {
  return { decision: "ALLOW" };
}

  /* --------------------------------------------------
   * 1️⃣ Public route short-circuit
   * -------------------------------------------------- */
  if (ctx?.route?.isPublic === true) {
    return { decision: "ALLOW" };
  }

  if (ctx?.route?.skipAcl === true) {
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
    companyId,
    workContextId,
  } = ctx.context ?? {};

  const { resourceCode, action } = ctx.route ?? {};

  if (
    !authUserId ||
    ((!companyId || !workContextId) && !ctx.context?.isAdmin) ||
    !resourceCode ||
    !action
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

type ContextForDb = {
  status: "RESOLVED";
  source: "BACKEND";
  companyId?: string;
  roleCode: string;
  isAdmin: boolean;
};

const db = getServiceRoleClientWithContext({
  status: "RESOLVED",
  source: "BACKEND",
  companyId: companyId as string,
  roleCode: ctx.context?.roleCode ?? "",
  isAdmin: false,
} as ContextForDb);

const activeAclVersionId = await getActiveAclVersionId(db, companyId as string);

const { data, error } = await readAclSnapshotDecision({
  db,
  aclVersionId: activeAclVersionId,
  authUserId,
  companyId,
  workContextId,
  resourceCode,
  actionCode: action,
});

if (error) {
  return {
    decision: "DENY",
    reason: "ACL_SNAPSHOT_QUERY_FAILED",
    action: "NONE",
  };
}

if (!data) {
  log({
    level: "WARN",
    request_id: _requestId,
    gate_id: "10.4",
    route_key: `${resourceCode}:${action}`,
    event: "ACL_DEFAULT_DENY_NO_MATCH",
    actor: authUserId,
    meta: {
      company_id: companyId,
      work_context_id: workContextId,
      resource_code: resourceCode,
      action,
      acl_version_id: activeAclVersionId,
    },
  });
  return {
    decision: "DENY",
    reason: "ACL_DEFAULT_DENY_NO_MATCH",
    action: "NONE",
  };
}

  log({
  level: "OBSERVABILITY",
  request_id: _requestId,
  gate_id: "10.4",
  route_key: `${resourceCode}:${action}`,
  event: "ACL_DECISION_TRACE",
  decision: data.decision,
  actor: authUserId,
  meta: {
    company_id: companyId,
    work_context_id: workContextId,
    resource_code: resourceCode,
    action,
    decision_reason: data.decision_reason,
    acl_version_id: activeAclVersionId,
  },
});

  if (data.decision === "ALLOW") {
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
    work_context_id: workContextId,
    reason: data.decision_reason
  }
);

return {
  decision: "DENY",
  reason: data.decision_reason || "ACL_DEFAULT_DENY_NO_MATCH",
  action: "NONE",
};
}
