/*
 * File-ID: 6.18R
 * File-Path: supabase/functions/api/_shared/acl_runtime.ts
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Keep active ACL version, menu projection, and session cache aligned to the current runtime company
 * Authority: Backend
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type MenuSnapshotRow = {
  menu_code: string;
  title: string | null;
  description: string | null;
  route_path: string | null;
  menu_type: string | null;
  parent_menu_code: string | null;
  display_order: number | null;
  snapshot_version?: number | null;
};

export async function getActiveAclVersionIdForCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<string> {
  const { data, error } = await db
    .schema("acl")
    .from("acl_versions")
    .select("acl_version_id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .single();

  if (error || !data?.acl_version_id) {
    throw new Error("ACL_ACTIVE_VERSION_NOT_FOUND");
  }

  return data.acl_version_id;
}

export async function rebuildAdminSessionMenuSnapshot(
  db: SupabaseClient,
  authUserId: string,
  sessionId?: string | null,
): Promise<MenuSnapshotRow[]> {
  const { error: snapshotError } = await db
    .schema("erp_menu")
    .rpc("generate_menu_snapshot", {
      p_user_id: authUserId,
      p_company_id: null,
      p_work_context_id: null,
      p_universe: "SA",
    });

  if (snapshotError) {
    throw new Error("ADMIN_MENU_SNAPSHOT_REBUILD_FAILED");
  }

  const { data: menuRows, error: menuError } = await db
    .schema("erp_menu")
    .from("menu_snapshot")
    .select(
      "menu_code, title, description, route_path, menu_type, parent_menu_code, display_order, snapshot_version",
    )
    .eq("user_id", authUserId)
    .eq("universe", "SA")
    .eq("is_visible", true)
    .order("display_order", { ascending: true });

  if (menuError) {
    throw new Error("ADMIN_MENU_SNAPSHOT_READ_FAILED");
  }

  if (sessionId) {
    const { error: deleteError } = await db
      .schema("erp_cache")
      .from("session_menu_snapshot")
      .delete()
      .eq("session_id", sessionId)
      .eq("universe", "SA")
      .is("company_id", null)
      .is("work_context_id", null);

    if (deleteError) {
      throw new Error("ADMIN_SESSION_MENU_SNAPSHOT_DELETE_FAILED");
    }

    const { error: insertError } = await db
      .schema("erp_cache")
      .from("session_menu_snapshot")
      .insert({
        session_id: sessionId,
        auth_user_id: authUserId,
        universe: "SA",
        company_id: null,
        work_context_id: null,
        snapshot_version: menuRows?.[0]?.snapshot_version ?? 0,
        menu_json: menuRows ?? [],
      });

    if (insertError) {
      throw new Error("ADMIN_SESSION_MENU_SNAPSHOT_INSERT_FAILED");
    }
  }

  return menuRows ?? [];
}

export async function rebuildAclSessionMenuSnapshot(
  db: SupabaseClient,
  authUserId: string,
  companyId: string,
  workContextId: string,
  sessionId?: string | null,
): Promise<MenuSnapshotRow[]> {
  const aclVersionId = await getActiveAclVersionIdForCompany(db, companyId);

  const { data: existingSnapshot, error: snapshotLookupError } = await db
    .schema("acl")
    .from("precomputed_acl_view")
    .select("snapshot_id")
    .eq("acl_version_id", aclVersionId)
    .eq("company_id", companyId)
    .limit(1)
    .maybeSingle();

  if (snapshotLookupError) {
    throw new Error("ACL_SNAPSHOT_LOOKUP_FAILED");
  }

  const { error: aclError } = existingSnapshot
    ? { error: null }
    : await db
      .schema("acl")
      .rpc("generate_acl_snapshot", {
        p_acl_version_id: aclVersionId,
        p_company_id: companyId,
      });

  if (aclError) {
    throw new Error("ACL_SNAPSHOT_REBUILD_FAILED");
  }

  const { error: menuBuildError } = await db
    .schema("erp_menu")
    .rpc("generate_menu_snapshot", {
      p_user_id: authUserId,
      p_company_id: companyId,
      p_work_context_id: workContextId,
      p_universe: "ACL",
    });

  if (menuBuildError) {
    throw new Error("ACL_MENU_SNAPSHOT_REBUILD_FAILED");
  }

  const { data: menuRows, error: menuReadError } = await db
    .schema("erp_menu")
    .from("menu_snapshot")
    .select(
      "menu_code, title, description, route_path, menu_type, parent_menu_code, display_order, snapshot_version",
    )
    .eq("user_id", authUserId)
    .eq("company_id", companyId)
    .eq("work_context_id", workContextId)
    .eq("universe", "ACL")
    .eq("is_visible", true)
    .order("display_order", { ascending: true });

  if (menuReadError) {
    throw new Error("ACL_MENU_SNAPSHOT_READ_FAILED");
  }

  if (sessionId) {
    const { error: deleteError } = await db
      .schema("erp_cache")
      .from("session_menu_snapshot")
      .delete()
      .eq("session_id", sessionId)
      .eq("universe", "ACL")
      .eq("company_id", companyId)
      .eq("work_context_id", workContextId);

    if (deleteError) {
      throw new Error("ACL_SESSION_MENU_SNAPSHOT_DELETE_FAILED");
    }

    const { error: insertError } = await db
      .schema("erp_cache")
      .from("session_menu_snapshot")
      .insert({
        session_id: sessionId,
        auth_user_id: authUserId,
        universe: "ACL",
        company_id: companyId,
        work_context_id: workContextId,
        snapshot_version: menuRows?.[0]?.snapshot_version ?? 0,
        menu_json: menuRows ?? [],
      });

    if (insertError) {
      throw new Error("ACL_SESSION_MENU_SNAPSHOT_INSERT_FAILED");
    }
  }

  return menuRows ?? [];
}
