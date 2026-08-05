/*
 * File-ID: 5.6
 * File-Path: supabase/functions/api/_pipeline/context.ts
 * Gate: 5
 * Phase: 5
 * Domain: SECURITY
 * Purpose: Deterministic backend-only runtime context resolution
 * Authority: Backend
 */

import { serviceRoleClient } from "../_shared/serviceRoleClient.ts";
import { isSuperAdmin, isGlobalAdmin } from "../_shared/role_ladder.ts";
import { hasEffectiveProjectAccess } from "../_shared/effective_project_access.ts";

export type ContextResolution =
  | {
      status: "UNRESOLVED";
      source: "BACKEND";
      errorCode: "CONTEXT_UNRESOLVED";
    }
  | {
      status: "RESOLVED";
      source: "BACKEND";
      companyId?: string;
      workContextId?: string;
      workContextCode?: string;
      // Union Work Context model (ACL_SSOT.md §29, locked 2026-08-05): a user's
      // effective access within a company is the union of every Work Context
      // assigned to them there, not one selected context. workContextId/Code
      // above stay populated (primary/first) for legacy display callers;
      // workContextIds is the authoritative set the ACL/menu layers must use.
      workContextIds?: string[];
      projectId?: string;
      departmentId?: string;
      roleCode: string;
      isAdmin: boolean;
    };

export type PipelineSession = {
  authUserId: string;
  roleCode: string;
  selectedCompanyId?: string | null;
  selectedWorkContextId?: string | null;
  workspaceMode?: "SINGLE" | "MULTI" | null;
};

function sanitizeContextInput(): void {
  return;
}

function isAdminUniverse(session: PipelineSession): boolean {
  return isSuperAdmin(session.roleCode) || isGlobalAdmin(session.roleCode);
}

function unresolved(): ContextResolution {
  return {
    status: "UNRESOLVED",
    source: "BACKEND",
    errorCode: "CONTEXT_UNRESOLVED",
  };
}

async function resolveCompanyId(
  authUserId: string,
  selectedCompanyId: string | null | undefined,
): Promise<string | null> {
  let companyId =
    typeof selectedCompanyId === "string" && selectedCompanyId.trim().length > 0
      ? selectedCompanyId.trim()
      : null;

  if (companyId) {
    const { data: membership, error: membershipError } = await serviceRoleClient
      .schema("erp_map")
      .from("user_companies")
      .select("company_id")
      .eq("auth_user_id", authUserId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (membershipError) {
      throw new Error("CONTEXT_UNRESOLVED");
    }

    if (!membership) {
      companyId = null;
    }
  }

  if (!companyId) {
    const { data: fallbackCompany, error: fallbackError } = await serviceRoleClient
      .schema("erp_map")
      .from("user_companies")
      .select("company_id, is_primary")
      .eq("auth_user_id", authUserId)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackError) {
      throw new Error("CONTEXT_UNRESOLVED");
    }

    companyId = fallbackCompany?.company_id ?? null;
  }

  return companyId;
}

async function resolveContextFromDb(
  req: Request,
  session: PipelineSession,
): Promise<ContextResolution> {
  const authUserId = session.authUserId;

  // -------------------------------------------------------
  // Type 2 (MULTI) — company comes from x-company-id header
  // -------------------------------------------------------
  // If the header is present and the user is MULTI:
  //   → validate membership strictly, NO fallback to session
  //   → if company not accessible → UNRESOLVED → 403
  // If the header is absent:
  //   → fall through to existing session-based resolution
  // -------------------------------------------------------
  if (session.workspaceMode === "MULTI") {
    const headerCompanyId = req.headers.get("x-company-id")?.trim() ?? null;

    if (headerCompanyId) {
      const { data: membership, error: membershipError } = await serviceRoleClient
        .schema("erp_map")
        .from("user_companies")
        .select("company_id")
        .eq("auth_user_id", authUserId)
        .eq("company_id", headerCompanyId)
        .maybeSingle();

      if (membershipError) {
        return unresolved();
      }

      if (!membership) {
        // Company specified but not accessible — hard deny, no fallback
        return unresolved();
      }

      // Company validated — continue resolution with this company
      return await resolveContextForCompany(req, session, headerCompanyId);
    }
  }

  // SINGLE users or MULTI without x-company-id header:
  // resolve company from session (existing behavior)
  const companyId = await resolveCompanyId(authUserId, session.selectedCompanyId);

  if (!companyId) {
    return unresolved();
  }

  return await resolveContextForCompany(req, session, companyId);
}

// Shared resolution path once companyId is validated.
// Used by both SINGLE (session-resolved) and MULTI (header-resolved) paths.
async function resolveContextForCompany(
  req: Request,
  session: PipelineSession,
  companyId: string,
): Promise<ContextResolution> {
  const authUserId = session.authUserId;

  const { data: workContextRows, error: workContextError } = await serviceRoleClient
    .schema("erp_acl")
    .from("user_work_contexts")
    .select(`
      is_primary,
      work_context:work_context_id!inner (
        work_context_id,
        company_id,
        work_context_code,
        department_id,
        is_active
      )
    `)
    .eq("auth_user_id", authUserId)
    .eq("company_id", companyId)
    .order("is_primary", { ascending: false });

  if (workContextError) {
    return unresolved();
  }

  const flattenWorkContext = (
    value: unknown,
  ): {
    work_context_id: string;
    company_id: string;
    work_context_code: string;
    department_id: string | null;
    is_active: boolean;
  } | null => {
    if (!value) return null;
    const row = Array.isArray(value) ? value[0] : value;
    if (!row || typeof row !== "object") return null;
    return row as {
      work_context_id: string;
      company_id: string;
      work_context_code: string;
      department_id: string | null;
      is_active: boolean;
    };
  };

  const availableWorkContexts = (workContextRows as Array<{ work_context: unknown }> ?? [])
    .map((row) => flattenWorkContext(row.work_context))
    .filter((
      row,
    ): row is {
      work_context_id: string;
      company_id: string;
      work_context_code: string;
      department_id: string | null;
      is_active: boolean;
    } => Boolean(row && row.is_active === true));

  if (availableWorkContexts.length === 0) {
    return unresolved();
  }

  const workContext =
    availableWorkContexts.find(
      (row) => row.work_context_id === session.selectedWorkContextId,
    ) ?? availableWorkContexts[0] ?? null;

  if (!workContext?.work_context_id) {
    return unresolved();
  }

  let projectId: string | undefined;
  const projectHeader = req.headers.get("x-project-id");

  if (projectHeader) {
    const projectAllowed = await hasEffectiveProjectAccess(
      serviceRoleClient,
      authUserId,
      companyId,
      projectHeader,
    );

    if (!projectAllowed) {
      return unresolved();
    }

    projectId = projectHeader;
  }

  let departmentId: string | undefined = workContext.department_id ?? undefined;
  const departmentHeader = req.headers.get("x-department-id");

  if (departmentHeader) {
    if (departmentId && departmentId !== departmentHeader) {
      return unresolved();
    }

    const { data: departmentMembership } = await serviceRoleClient
      .schema("erp_map")
      .from("user_departments")
      .select("department_id")
      .eq("auth_user_id", authUserId)
      .eq("department_id", departmentHeader)
      .maybeSingle();

    if (!departmentMembership) {
      return unresolved();
    }

    const { data: departmentScope } = await serviceRoleClient
      .schema("erp_master")
      .from("departments")
      .select("id")
      .eq("id", departmentHeader)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!departmentScope) {
      return unresolved();
    }

    departmentId = departmentHeader;
  }

  return {
    status: "RESOLVED",
    source: "BACKEND",
    companyId,
    workContextId: workContext.work_context_id,
    workContextCode: workContext.work_context_code,
    workContextIds: availableWorkContexts.map((row) => row.work_context_id),
    projectId,
    departmentId,
    roleCode: session.roleCode,
    isAdmin: false,
  };
}

function enforceContextInvariants(ctx: ContextResolution): ContextResolution {
  if (ctx.status === "UNRESOLVED") {
    return ctx;
  }

  if (!ctx.companyId && !ctx.isAdmin) {
    return unresolved();
  }

  if (!ctx.isAdmin && !ctx.workContextId) {
    return unresolved();
  }

  return ctx;
}

/* =========================================================
 * PERF: short-lived context memoization
 *
 * Measured via Server-Timing on a live request: `context` was 492ms of a 1.00s
 * pipeline, i.e. ~2 serial Mumbai round trips paid on EVERY request. The app
 * loads a page as a burst of ~30 requests within a few seconds, so the exact
 * same context was being re-resolved ~30 times per page.
 *
 * stepContext() is a pure function of a small, fully-enumerable input set:
 *   session: authUserId, roleCode, selectedCompanyId, selectedWorkContextId,
 *            workspaceMode
 *   headers: x-company-id, x-project-id, x-department-id
 * ...so memoizing on exactly those inputs returns a provably identical result —
 * no auth logic is reimplemented or bypassed, it is the same code path, just
 * not re-run for a few seconds.
 *
 * 🔒 SECURITY: the cache key MUST contain every input, `authUserId` above all.
 * An incomplete key could hand one user another user's context. Do not remove a
 * component from buildContextCacheKey without re-reading stepContext's inputs.
 *
 * Staleness is bounded by the TTL: a permission change takes effect within
 * PIPELINE_CONTEXT_CACHE_TTL_MS. Company/work-context switches change the key
 * itself, so they take effect immediately. Set the TTL to 0 to disable the
 * cache entirely and restore the previous behaviour without a code change.
 * ========================================================= */

const PIPELINE_CONTEXT_CACHE_TTL_MS = (() => {
  const raw = typeof Deno !== "undefined"
    ? Deno.env.get("PIPELINE_CONTEXT_CACHE_TTL_MS")
    : process.env.PIPELINE_CONTEXT_CACHE_TTL_MS;
  const parsed = Number(raw);
  // 30s. The original 5s was chosen on a wrong assumption — that a page's request
  // burst finishes in ~3s. Live Server-Timing data disproved it: each request takes
  // 1.5-2s and the browser runs ~6 in parallel, so a ~30-request page takes 10-30s.
  // A 5s TTL therefore expired mid-burst and threw away most of the benefit.
  //
  // 30s covers a typical burst while halving the staleness window vs 60s. What that
  // window can and cannot do:
  //   • CANNOT grant anything — the cache only replays a context that was legitimately
  //     resolved moments ago for the exact same key. It can only DELAY a revocation.
  //   • Company / work-context switch, a different user, or different scope headers all
  //     change the key, so they take effect immediately.
  //   • Session validity (login, logout, idle lock) is NOT cached — session.ts is untouched.
  //   • ACL decisions are NOT cached — stepAcl re-evaluates every request.
  // So the only bounded staleness is an admin revoking company/work-context/project
  // access, which takes up to 30s to bite.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30000;
})();

const contextCache = new Map<string, { at: number; value: ContextResolution }>();
const CONTEXT_CACHE_MAX_ENTRIES = 500;

function buildContextCacheKey(req: Request, session: PipelineSession): string {
  // Every input stepContext reads. Keep in sync with resolveContextFromDb /
  // resolveContextForCompany if either ever reads something new.
  return [
    session.authUserId,
    session.roleCode,
    session.selectedCompanyId ?? "",
    session.selectedWorkContextId ?? "",
    session.workspaceMode ?? "",
    req.headers.get("x-company-id")?.trim() ?? "",
    req.headers.get("x-project-id") ?? "",
    req.headers.get("x-department-id") ?? "",
  ].join("|");
}

export async function stepContext(
  req: Request,
  session: PipelineSession,
): Promise<ContextResolution> {
  sanitizeContextInput();

  if (isAdminUniverse(session)) {
    return {
      status: "RESOLVED",
      source: "BACKEND",
      roleCode: session.roleCode,
      isAdmin: true,
      companyId: undefined,
      workContextId: undefined,
      workContextCode: undefined,
    };
  }

  const cacheKey = PIPELINE_CONTEXT_CACHE_TTL_MS > 0
    ? buildContextCacheKey(req, session)
    : null;

  if (cacheKey) {
    const hit = contextCache.get(cacheKey);
    if (hit && Date.now() - hit.at < PIPELINE_CONTEXT_CACHE_TTL_MS) {
      return hit.value;
    }
  }

  const resolved = await resolveContextFromDb(req, session).catch(() => unresolved());
  const finalCtx = enforceContextInvariants(resolved);

  // Only cache a RESOLVED context. An UNRESOLVED result is often transient
  // (mid-setup user, race on company assignment) and caching a denial would
  // keep a user locked out for the whole TTL for no benefit.
  if (cacheKey && finalCtx.status === "RESOLVED") {
    if (contextCache.size >= CONTEXT_CACHE_MAX_ENTRIES) {
      // Bounded memory: drop the oldest inserted key (Map preserves insertion order).
      const oldestKey = contextCache.keys().next().value;
      if (oldestKey !== undefined) contextCache.delete(oldestKey);
    }
    contextCache.set(cacheKey, { at: Date.now(), value: finalCtx });
  }

  return finalCtx;
}
