/*
 * File-ID: 6.6-ACL-SNAPSHOT
 * File-Path: supabase/functions/api/_shared/acl_snapshot.ts
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Shared precomputed ACL snapshot lookup helpers for request-time and workflow checks
 * Authority: Backend
 */

import type { DbClient } from "./db_client.ts";

export type AclSnapshotDecision = {
  resource_code: string;
  action_code: string;
  decision: "ALLOW" | "DENY";
  decision_reason: string | null;
};

export async function readAclSnapshotDecision(input: {
  db: DbClient;
  aclVersionId: string;
  authUserId: string;
  companyId: string;
  workContextId: string;
  resourceCode: string;
  actionCode: string;
}): Promise<{
  data: AclSnapshotDecision | null;
  error: { message?: string } | null;
}> {
  const { data, error } = await input.db
    .schema("acl")
    .from("precomputed_acl_view")
    .select(`
      resource_code,
      action_code,
      decision,
      decision_reason
    `)
    .eq("acl_version_id", input.aclVersionId)
    .eq("auth_user_id", input.authUserId)
    .eq("company_id", input.companyId)
    .eq("work_context_id", input.workContextId)
    .eq("resource_code", input.resourceCode)
    .eq("action_code", input.actionCode)
    .maybeSingle();

  return {
    data: (data ?? null) as AclSnapshotDecision | null,
    error: error ?? null,
  };
}

/**
 * Union Work Context model (ACL_SSOT.md §29, locked 2026-08-05): a user's
 * effective access within a company is the union of every Work Context
 * assigned to them there. ALLOW if the resource:action is ALLOW under ANY
 * work_context_id in the set; otherwise fall back to whatever DENY row (if
 * any) was found, so callers still get a decision_reason to log.
 */
export async function readAclSnapshotDecisionAny(input: {
  db: DbClient;
  aclVersionId: string;
  authUserId: string;
  companyId: string;
  workContextIds: string[];
  resourceCode: string;
  actionCode: string;
}): Promise<{
  data: AclSnapshotDecision | null;
  error: { message?: string } | null;
}> {
  if (input.workContextIds.length === 0) {
    return { data: null, error: null };
  }

  const { data, error } = await input.db
    .schema("acl")
    .from("precomputed_acl_view")
    .select(`
      resource_code,
      action_code,
      decision,
      decision_reason
    `)
    .eq("acl_version_id", input.aclVersionId)
    .eq("auth_user_id", input.authUserId)
    .eq("company_id", input.companyId)
    .in("work_context_id", input.workContextIds)
    .eq("resource_code", input.resourceCode)
    .eq("action_code", input.actionCode);

  if (error) {
    return { data: null, error };
  }

  const rows = (data ?? []) as AclSnapshotDecision[];
  const allowRow = rows.find((row) => row.decision === "ALLOW");

  return {
    data: allowRow ?? rows[0] ?? null,
    error: null,
  };
}
