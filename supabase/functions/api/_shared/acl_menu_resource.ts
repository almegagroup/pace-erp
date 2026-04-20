/*
 * File-ID: 6.9B
 * File-Path: supabase/functions/api/_shared/acl_menu_resource.ts
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Resolve a governed resource_code to the legacy acl.menu_master bridge row used by ACL tables
 * Authority: Backend
 */

import type { DbClient } from "./db_client.ts";

type ResolvedAclMenuResource = {
  aclMenuId: string;
  resourceCode: string;
};

export async function resolveOrProvisionAclMenuResource(
  db: DbClient,
  resourceCodeInput: string,
): Promise<ResolvedAclMenuResource> {
  const normalizedResourceCode = resourceCodeInput.trim().toUpperCase();

  if (!normalizedResourceCode) {
    throw new Error("ACL_RESOURCE_CODE_REQUIRED");
  }

  const { data: erpMenu, error: erpMenuError } = await db
    .schema("erp_menu")
    .from("menu_master")
    .select("menu_code, resource_code, title, description, is_system")
    .eq("resource_code", normalizedResourceCode)
    .maybeSingle();

  if (erpMenuError) {
    throw new Error("ACL_RESOURCE_LOOKUP_FAILED");
  }

  if (!erpMenu?.resource_code) {
    throw new Error("ACL_RESOURCE_NOT_FOUND");
  }

  let { data: aclMenu, error: aclMenuError } = await db
    .schema("acl")
    .from("menu_master")
    .select("id, menu_code")
    .eq("menu_code", normalizedResourceCode)
    .maybeSingle();

  if (aclMenuError) {
    throw new Error("ACL_RESOURCE_LOOKUP_FAILED");
  }

  if (!aclMenu && erpMenu.menu_code) {
    const legacyLookup = await db
      .schema("acl")
      .from("menu_master")
      .select("id, menu_code")
      .eq("menu_code", erpMenu.menu_code)
      .maybeSingle();

    if (legacyLookup.error) {
      throw new Error("ACL_RESOURCE_LOOKUP_FAILED");
    }

    aclMenu = legacyLookup.data ?? null;
  }

  if (!aclMenu) {
    const { data: inserted, error: insertError } = await db
      .schema("acl")
      .from("menu_master")
      .insert({
        menu_code: normalizedResourceCode,
        display_name: erpMenu.title,
        description: erpMenu.description ?? null,
        is_system: erpMenu.is_system ?? false,
      })
      .select("id, menu_code")
      .single();

    if (insertError || !inserted?.id) {
      throw new Error("ACL_RESOURCE_PROVISION_FAILED");
    }

    aclMenu = inserted;
  }

  return {
    aclMenuId: aclMenu.id,
    resourceCode: erpMenu.resource_code,
  };
}
