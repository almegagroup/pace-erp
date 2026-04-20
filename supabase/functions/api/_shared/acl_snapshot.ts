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
