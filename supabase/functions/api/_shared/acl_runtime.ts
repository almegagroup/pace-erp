/*
 * File-ID: 6.18R
 * File-Path: supabase/functions/api/_shared/acl_runtime.ts
 * Gate: 6
 * Phase: 6
 * Domain: ACL
 * Purpose: Keep active ACL version, menu projection, and session cache aligned to the current runtime company
 * Authority: Backend
 */

import type { DbClient, DbQueryBuilder } from "./db_client.ts";
import {
  listAvailableWorkContexts,
  listCanonicalCompanyIds,
} from "./canonical_access.ts";

/** Key-order-insensitive JSON text, so jsonb read-back (keys re-sorted by
 *  Postgres) compares equal to a freshly built array. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
        .join(",")
    }}`;
  }
  return JSON.stringify(value) ?? "null";
}

type SessionMenuSnapshotTarget = {
  sessionId: string;
  authUserId: string;
  universe: string;
  companyId: string | null;
  workContextId: string | null;
  snapshotVersion: number;
  menuJson: unknown[];
};

/**
 * Write one erp_cache.session_menu_snapshot row.
 *
 * PERF (prod "Disk IO Budget" warning, 2026-11-12): this cache is rebuilt every
 * MENU_SNAPSHOT_CACHE_TTL_SECONDS per session and used to DELETE + INSERT the
 * row each time even when the menu was identical. That rewrites ~9 KB of TOASTed
 * jsonb plus 8 index entries per rebuild. When the stored row already holds the
 * same menu we now only touch created_at (the TTL clock menu.handler.ts reads),
 * a HOT update that leaves menu_json and every index alone.
 *
 * `scope` applies the same filters the old delete used, so stale rows from
 * older shapes are still cleared whenever the menu really changed.
 */
async function writeSessionMenuSnapshot(
  db: DbClient,
  target: SessionMenuSnapshotTarget,
  scope: (query: DbQueryBuilder) => DbQueryBuilder,
  errorCodes: { delete: string; insert: string },
): Promise<void> {
  const table = () => db.schema("erp_cache").from("session_menu_snapshot");

  const { data: existing, error: existingError } = await scope(
    table().select(
      "snapshot_id, menu_json, snapshot_version, company_id, work_context_id",
    ),
  );

  // A failed lookup just falls through to the original delete + insert path.
  if (!existingError && Array.isArray(existing) && existing.length === 1) {
    const current = existing[0];
    const sameShape = (current.company_id ?? null) === target.companyId &&
      (current.work_context_id ?? null) === target.workContextId;

    if (
      sameShape &&
      stableStringify(current.menu_json) === stableStringify(target.menuJson)
    ) {
      const { data: touched, error: touchError } = await table()
        .update({
          created_at: new Date().toISOString(),
          snapshot_version: target.snapshotVersion,
        })
        .eq("snapshot_id", current.snapshot_id)
        .select("snapshot_id");

      if (!touchError && Array.isArray(touched) && touched.length === 1) {
        return;
      }
    }
  }

  const { error: deleteError } = await scope(table().delete());

  if (deleteError) {
    throw new Error(errorCodes.delete);
  }

  const { error: insertError } = await table().insert({
    session_id: target.sessionId,
    auth_user_id: target.authUserId,
    universe: target.universe,
    company_id: target.companyId,
    work_context_id: target.workContextId,
    snapshot_version: target.snapshotVersion,
    menu_json: target.menuJson,
  });

  if (insertError) {
    throw new Error(errorCodes.insert);
  }
}

type MenuSnapshotRow = {
  menu_code: string;
  title: string | null;
  description: string | null;
  route_path: string | null;
  menu_type: string | null;
  parent_menu_code: string | null;
  display_order: number | null;
  snapshot_version?: number | null;
  tx_code?: string | null;
  is_visible?: boolean | null;
};

export async function getActiveAclVersionIdForCompany(
  db: DbClient,
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

export async function ensureAclVersionSourceCaptured(
  db: DbClient,
  aclVersionId: string,
  companyId: string,
  actorUserId?: string | null,
): Promise<void> {
  const { data: versionRow, error: versionError } = await db
    .schema("acl")
    .from("acl_versions")
    .select("acl_version_id, source_captured_at")
    .eq("acl_version_id", aclVersionId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (versionError) {
    throw new Error(`ACL_VERSION_READ_FAILED:${versionError.message}`);
  }

  if (!versionRow?.acl_version_id) {
    throw new Error("ACL_VERSION_NOT_FOUND");
  }

  if (versionRow.source_captured_at) {
    return;
  }

  const { error: captureError } = await db
    .schema("acl")
    .rpc("capture_acl_version_source", {
      p_acl_version_id: aclVersionId,
      p_company_id: companyId,
      p_actor: actorUserId ?? null,
    });

  if (captureError) {
    throw new Error(`ACL_VERSION_SOURCE_CAPTURE_FAILED:${captureError.message}`);
  }
}

export async function rebuildAdminSessionMenuSnapshot(
  db: DbClient,
  authUserId: string,
  sessionId?: string | null,
): Promise<MenuSnapshotRow[]> {
  const { error: snapshotError } = await db
    .rpc("rebuild_sa_menu_snapshot", {
      p_user_id: authUserId,
    });

  if (snapshotError) {
    throw new Error("ADMIN_MENU_SNAPSHOT_REBUILD_FAILED");
  }

  const { data: menuRows, error: menuError } = await db
    .schema("erp_menu")
    .from("menu_snapshot")
    .select(
      "menu_code, title, description, route_path, menu_type, parent_menu_code, display_order, snapshot_version, tx_code, is_visible",
    )
    .eq("user_id", authUserId)
    .eq("universe", "SA")
    .eq("is_visible", true)
    .order("display_order", { ascending: true });

  if (menuError) {
    throw new Error("ADMIN_MENU_SNAPSHOT_READ_FAILED");
  }

  if (sessionId) {
    await writeSessionMenuSnapshot(
      db,
      {
        sessionId,
        authUserId,
        universe: "SA",
        companyId: null,
        workContextId: null,
        snapshotVersion: menuRows?.[0]?.snapshot_version ?? 0,
        menuJson: menuRows ?? [],
      },
      (query) =>
        query
          .eq("session_id", sessionId)
          .eq("universe", "SA")
          .is("company_id", null)
          .is("work_context_id", null),
      {
        delete: "ADMIN_SESSION_MENU_SNAPSHOT_DELETE_FAILED",
        insert: "ADMIN_SESSION_MENU_SNAPSHOT_INSERT_FAILED",
      },
    );
  }

  return menuRows ?? [];
}

export async function rebuildAclSessionMenuSnapshot(
  db: DbClient,
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
    : await (async () => {
      await ensureAclVersionSourceCaptured(
        db,
        aclVersionId,
        companyId,
        authUserId,
      );

      return await db
        .schema("acl")
        .rpc("generate_acl_snapshot", {
          p_acl_version_id: aclVersionId,
          p_company_id: companyId,
        });
    })();

  if (aclError) {
    throw new Error(`ACL_SNAPSHOT_REBUILD_FAILED:${aclError.message}`);
  }

  const { error: menuBuildError } = await db
    .rpc("rebuild_acl_menu_snapshot", {
      p_user_id: authUserId,
      p_company_id: companyId,
      p_work_context_id: workContextId,
    });

  if (menuBuildError) {
    throw new Error(`ACL_MENU_SNAPSHOT_REBUILD_FAILED:${menuBuildError.message}`);
  }

  const { data: menuRows, error: menuReadError } = await db
    .schema("erp_menu")
    .from("menu_snapshot")
    .select(
      "menu_code, title, description, route_path, menu_type, parent_menu_code, display_order, snapshot_version, tx_code, is_visible",
    )
    .eq("user_id", authUserId)
    .eq("company_id", companyId)
    .eq("work_context_id", workContextId)
    .eq("universe", "ACL")
    // NOTE: intentionally NOT filtering by is_visible here — invisible
    // (denied) rows are still returned so the frontend can render them
    // greyed-out instead of omitting them. See
    // docs/Operation Management/Disabled-Menu-Item-Feature-Plan.md
    .order("display_order", { ascending: true });

  if (menuReadError) {
    throw new Error("ACL_MENU_SNAPSHOT_READ_FAILED");
  }

  if (sessionId) {
    await writeSessionMenuSnapshot(
      db,
      {
        sessionId,
        authUserId,
        universe: "ACL",
        companyId,
        workContextId,
        snapshotVersion: menuRows?.[0]?.snapshot_version ?? 0,
        menuJson: menuRows ?? [],
      },
      (query) =>
        query
          .eq("session_id", sessionId)
          .eq("universe", "ACL")
          .eq("company_id", companyId)
          .eq("work_context_id", workContextId),
      {
        delete: "ACL_SESSION_MENU_SNAPSHOT_DELETE_FAILED",
        insert: "ACL_SESSION_MENU_SNAPSHOT_INSERT_FAILED",
      },
    );
  }

  return menuRows ?? [];
}

/**
 * Union Work Context model (ACL_SSOT.md §29, locked 2026-08-05): a user's
 * effective menu within one company is the union of every Work Context
 * assigned to them there, not a single selected one. Mirrors the same
 * union-by-menu_code / OR-on-is_visible pattern rebuildGlobalAclMenuSnapshot
 * already uses across companies, just applied across Work Contexts within
 * one company instead. Writes exactly one session_menu_snapshot row for
 * (session, universe="ACL", company) with work_context_id = NULL — the
 * sentinel already used by the GLOBAL_ACL union row below — so
 * menu.handler.ts's cache read/write no longer needs a single selected
 * work_context_id to key on.
 */
export async function rebuildAclUnionSessionMenuSnapshot(
  db: DbClient,
  authUserId: string,
  companyId: string,
  workContextIds: string[],
  sessionId?: string | null,
): Promise<MenuSnapshotRow[]> {
  const rowsByMenuCode = new Map<string, MenuSnapshotRow>();
  let maxSnapshotVersion = 0;

  for (const workContextId of workContextIds) {
    // No sessionId passed to the per-context call — this builds
    // erp_menu.menu_snapshot only, no per-context session cache row (the
    // union row written below is the only session cache row for ACL).
    const menuRows = await rebuildAclSessionMenuSnapshot(
      db,
      authUserId,
      companyId,
      workContextId,
    );

    for (const row of menuRows) {
      const existing = rowsByMenuCode.get(row.menu_code);
      if (!existing) {
        rowsByMenuCode.set(row.menu_code, row);
      } else if (row.is_visible === true && existing.is_visible !== true) {
        rowsByMenuCode.set(row.menu_code, row);
      }
      const version = row.snapshot_version ?? 0;
      if (version > maxSnapshotVersion) maxSnapshotVersion = version;
    }
  }

  const unionMenuRows: MenuSnapshotRow[] = Array.from(rowsByMenuCode.values());

  if (sessionId) {
    // No work_context_id filter in scope — clears both any stale per-context
    // row from before this change and any prior union row. The unchanged
    // shortcut only fires when exactly one row exists AND it is the union row
    // (work_context_id NULL) holding the same menu.
    await writeSessionMenuSnapshot(
      db,
      {
        sessionId,
        authUserId,
        universe: "ACL",
        companyId,
        workContextId: null,
        snapshotVersion: maxSnapshotVersion,
        menuJson: unionMenuRows,
      },
      (query) =>
        query
          .eq("session_id", sessionId)
          .eq("universe", "ACL")
          .eq("company_id", companyId),
      {
        delete: "ACL_UNION_SESSION_MENU_SNAPSHOT_DELETE_FAILED",
        insert: "ACL_UNION_SESSION_MENU_SNAPSHOT_INSERT_FAILED",
      },
    );
  }

  return unionMenuRows;
}

export async function rebuildGlobalAclMenuSnapshot(
  db: DbClient,
  authUserId: string,
  sessionId: string,
): Promise<MenuSnapshotRow[]> {
  // 1. Collect all active canonical companies for this user
  const companyIds = await listCanonicalCompanyIds(db, authUserId);

  if (companyIds.length === 0) return [];

  // 2. For each company: build ACL menu snapshot for EVERY Work Context
  //    assigned to this user in that company (Union Work Context model,
  //    ACL_SSOT.md §29 — not just the primary/default one), then union all
  //    results by menu_code across BOTH companies and work contexts. A row
  //    is visible in the union if it is visible in ANY of the user's
  //    (company, work context) pairs — this must be an OR, not a naive
  //    "first occurrence wins", now that a menu_code can appear with
  //    is_visible=false in one pair's snapshot and true in another (e.g.
  //    SCM sees Purchase Orders in every company, but a page might be
  //    granted in Company A / Work Context X only). First-occurrence-wins
  //    would incorrectly grey out a page the user genuinely has access to
  //    elsewhere, purely based on loop order.
  const rowsByMenuCode = new Map<string, MenuSnapshotRow>();

  for (const companyId of companyIds) {
    try {
      const workContexts = await listAvailableWorkContexts(db, authUserId, companyId);
      if (workContexts.length === 0) continue;

      for (const workContext of workContexts) {
        const menuRows = await rebuildAclSessionMenuSnapshot(
          db,
          authUserId,
          companyId,
          workContext.work_context_id,
          // No sessionId — builds erp_menu.menu_snapshot only, no session cache write
        );

        for (const row of menuRows) {
          const existing = rowsByMenuCode.get(row.menu_code);
          if (!existing) {
            rowsByMenuCode.set(row.menu_code, row);
          } else if (row.is_visible === true && existing.is_visible !== true) {
            rowsByMenuCode.set(row.menu_code, row);
          }
        }
      }
    } catch {
      // One company failing must not block login for all others
      continue;
    }
  }

  const unionMenuRows: MenuSnapshotRow[] = Array.from(rowsByMenuCode.values());

  // 3+4. Replace the GLOBAL_ACL snapshot for this session (no write at all
  // beyond the TTL touch when the unified menu is unchanged).
  await writeSessionMenuSnapshot(
    db,
    {
      sessionId,
      authUserId,
      universe: "GLOBAL_ACL",
      companyId: null,
      workContextId: null,
      snapshotVersion: 0,
      menuJson: unionMenuRows,
    },
    (query) =>
      query
        .eq("session_id", sessionId)
        .eq("universe", "GLOBAL_ACL"),
    {
      delete: "GLOBAL_ACL_SESSION_MENU_SNAPSHOT_DELETE_FAILED",
      insert: "GLOBAL_ACL_SESSION_MENU_SNAPSHOT_INSERT_FAILED",
    },
  );

  return unionMenuRows;
}
