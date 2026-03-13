/*
 * File-ID: 9.6A
 * File-Path: supabase/functions/api/_core/admin/user/_guards/self_lockout.guard.ts
 * Gate: 9
 * Phase: 9
 * Domain: ADMIN
 * Purpose: Enforce admin self-lockout prevention invariants
 * Authority: Backend
 */

import {
  isSuperAdmin,
  compareRoleRank,
} from "../../../../_shared/role_ladder.ts";
import { serviceRoleClient } from "../../../../_shared/serviceRoleClient.ts";

type SelfLockoutParams = {
  _actorAuthUserId: string;
  actorRoleCode: string;
  _targetAuthUserId: string;
  targetCurrentRole?: string;
  targetNextRole?: string;
  targetNextState?: "ACTIVE" | "DISABLED";
};

export async function assertSelfLockoutSafe(
  params: SelfLockoutParams
): Promise<void> {
  const {
  _actorAuthUserId,
  actorRoleCode,
  _targetAuthUserId,
  targetCurrentRole,
  targetNextRole,
  targetNextState,
} = params;

  // --------------------------------------------------
  // Rule 1: Last Super Admin cannot be disabled
  // --------------------------------------------------
  if (
    isSuperAdmin(targetCurrentRole) &&
    targetNextState === "DISABLED"
  ) {
    const { count } = await serviceRoleClient
      .schema("erp_acl").from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role_code", "SA");

    if ((count ?? 0) <= 1) {
      throw new Error("G4_BLOCK_LAST_SUPER_ADMIN");
    }
  }

  // --------------------------------------------------
  // Rule 2: Actor cannot downgrade higher role
  // --------------------------------------------------
  if (targetCurrentRole && targetNextRole) {
    const diff = compareRoleRank(
      actorRoleCode,
      targetCurrentRole
    );

    if (diff === null || diff < 0) {
      throw new Error("G4_ROLE_DOWNGRADE_NOT_ALLOWED");
    }
  }
}
