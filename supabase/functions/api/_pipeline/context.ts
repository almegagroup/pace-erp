/*
 * File-ID: 5.6 (rewired in Gate-6 / G4)
 * File-Path: supabase/functions/api/_pipeline/context.ts
 * Gate: 5
 * Phase: 5
 * Domain: SECURITY
 * Purpose: Deterministic backend-only context resolution using G4 mappings
 * Authority: Backend
 */
import { serviceRoleClient } from "../_shared/serviceRoleClient.ts";
import { isSuperAdmin, isGlobalAdmin } from "../_shared/role_ladder.ts";

/* =========================================================
 * Types
 * ========================================================= */

export type ContextResolution =
  | {
      status: "UNRESOLVED";
      source: "BACKEND";
      errorCode: "CONTEXT_UNRESOLVED";
    }
  | {
    status: "RESOLVED";
    source: "BACKEND";
    companyId?: string; // ✅ optional
    projectId?: string;
    departmentId?: string;
    roleCode: string;  
    isAdmin: boolean;
  }

export type PipelineSession = {
  authUserId: string;
  roleCode: string;   // 🔥 REQUIRED (session থেকে আসছে)
};

/* =========================================================
 * 1️⃣ Ignore frontend hints (no-op by design)
 * ========================================================= */
function sanitizeContextInput(): void {
  return;
}

/* =========================================================
 * 2️⃣ Admin universe detection
 * ========================================================= */
function isAdminUniverse(
  session: PipelineSession
): boolean {
  return (
    isSuperAdmin(session.roleCode) ||
    isGlobalAdmin(session.roleCode)
  );
}

/* =========================================================
 * 3️⃣ Resolve context from DB (G4 truth)
 * ========================================================= */
async function resolveContextFromDb(
  req: Request,
  session: PipelineSession
): Promise<ContextResolution> {
  const authUserId = session.authUserId;
  const db = serviceRoleClient;

  /* ---- Primary company (ID-6.6 / 6.6A) ---- */
 type GetPrimaryCompanyRPC = {
  p_auth_user_id: string;
};

const { data: companyId, error: rpcError } = await db.rpc(
  "erp_map.get_primary_company",
  { p_auth_user_id: authUserId } as GetPrimaryCompanyRPC
) as { data: string | null; error: any };

if (rpcError) {
  return {
    status: "UNRESOLVED",
    source: "BACKEND",
    errorCode: "CONTEXT_UNRESOLVED",
  };
}

  if (!companyId) {
    return {
      status: "UNRESOLVED",
      source: "BACKEND",
      errorCode: "CONTEXT_UNRESOLVED",
    };
  }
  /* ---- Optional project (ID-6.7 / 6.7A) ---- */
  let projectId: string | undefined;
  const projectHeader = req.headers.get("x-project-id");

  if (projectHeader) {
    const { data } = await db
      .schema("erp_map").from("user_projects")
      .select("project_id")
      .eq("auth_user_id", authUserId)
      .eq("project_id", projectHeader)
      .maybeSingle();

    if (!data) {
      return {
        status: "UNRESOLVED",
        source: "BACKEND",
        errorCode: "CONTEXT_UNRESOLVED",
      };
    }

    projectId = projectHeader;
  }

  /* ---- Optional department (ID-6.8 / 6.8A) ---- */
  let departmentId: string | undefined;
  const deptHeader = req.headers.get("x-department-id");

  if (deptHeader) {
    const { data } = await db
      .schema("erp_map").from("user_departments")
      .select("department_id")
      .eq("auth_user_id", authUserId)
      .eq("department_id", deptHeader)
      .maybeSingle();

    if (!data) {
      return {
        status: "UNRESOLVED",
        source: "BACKEND",
        errorCode: "CONTEXT_UNRESOLVED",
      };
    }

    departmentId = deptHeader;
  }

 return {
  status: "RESOLVED",
  source: "BACKEND",
  companyId,
  projectId,
  departmentId,
  roleCode: session.roleCode,   // 🔥 FROM SESSION
  isAdmin: false,
};
}


/* =========================================================
 * 5️⃣ Context invariants
 * ========================================================= */
function enforceContextInvariants(
  ctx: ContextResolution
): ContextResolution {
  if (ctx.status === "UNRESOLVED") return ctx;

  if (!ctx.companyId && !ctx.isAdmin) {
  return {
    status: "UNRESOLVED",
    source: "BACKEND",
    errorCode: "CONTEXT_UNRESOLVED",
  };
}

  return ctx;
}

/* =========================================================
 * 6️⃣ Pipeline entry (CORRECT signature)
 * ========================================================= */
export async function stepContext(
  req: Request,
  session: PipelineSession
): Promise<ContextResolution> {
  sanitizeContextInput();

  // 🔥 1️⃣ ADMIN FIRST — HARD BYPASS (NO DB CALL)
 if (isAdminUniverse(session)) {
  return {
    status: "RESOLVED",
    source: "BACKEND",
    roleCode: session.roleCode,
    isAdmin: true,
    companyId: undefined,   // 🔥 explicit
  };
}

  // 🔹 2️⃣ ONLY NON-ADMIN → DB CONTEXT
  const resolved = await resolveContextFromDb(req, session);

  return enforceContextInvariants(resolved);
}
