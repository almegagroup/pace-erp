/*
 * FINAL LOCKED LOGIN HANDLER
 * Fully deterministic + debug observable + SA safe
 */

import { createClient } from "@supabase/supabase-js";
import { ENV } from "../../_shared/env.ts";

import { verifyPassword } from "./authDelegate.ts";
import { errorResponse } from "../response.ts";
import { getAccountState } from "./accountState.ts";
import { createSession } from "../session/session.create.ts";
import { buildSessionCookie } from "../session/session.cookie.ts";
import { resolveIdentifier } from "./identifierResolver.ts";
import { log } from "../../_lib/logger.ts";
import { authClient } from "./authClient.ts";
import { recordSessionTimeline } from "../session/session_timeline.ts";
import {
  resolveDefaultWorkCompanyId,
  resolveDefaultWorkContextId,
  resolveCanonicalAccessProfile,
  listCanonicalCompanyIds,
} from "../../_shared/canonical_access.ts";
import {
  rebuildAclSessionMenuSnapshot,
  rebuildAdminSessionMenuSnapshot,
  rebuildGlobalAclMenuSnapshot,
} from "../../_shared/acl_runtime.ts";

function extractDeviceInfo(_ctx: LoginContext) {
  return {
    device_id: "unknown",
    device_summary: "unknown",
  };
}

async function buildAndStoreMenuSnapshot(
  sessionId: string,
  authUserId: string,
  requestId: string,
  selectedCompanyId: string | null,
  selectedWorkContextId: string | null,
  workspaceMode?: "SINGLE" | "MULTI" | null,
) {
  const start = Date.now();

  const supabase = createClient(
    ENV.SUPABASE_URL,
    ENV.SUPABASE_SERVICE_ROLE_KEY,
  );

  log({
    level: "INFO",
    request_id: requestId,
    event: "SNAPSHOT_START",
    meta: { sessionId, authUserId },
  });

  try {
    const { userCode, roleCode, isAdmin } =
      await resolveCanonicalAccessProfile(supabase, authUserId);

    if (!isAdmin && !roleCode) {
      log({
        level: "ERROR",
        request_id: requestId,
        event: "ROLE_MISSING_SNAPSHOT_DENY",
      });
      return;
    }

    log({
      level: "INFO",
      request_id: requestId,
      event: "ROLE_DETECTED",
      meta: { roleCode, isAdmin, userCode },
    });

    if (isAdmin) {
      try {
        const menuRows = await rebuildAdminSessionMenuSnapshot(
          supabase,
          authUserId,
          sessionId,
        );

        log({
          level: "INFO",
          request_id: requestId,
          event: "SA_SNAPSHOT_SUCCESS",
          meta: { count: menuRows.length },
        });
      } catch (error) {
        log({
          level: "ERROR",
          request_id: requestId,
          event: "SA_SNAPSHOT_REBUILD_FAILED",
          meta: { error: String(error) },
        });
      }

      return;
    }

    // MULTI (Type 2) users: build GLOBAL_ACL snapshot — union of all companies
    if (workspaceMode === "MULTI") {
      try {
        const menuRows = await rebuildGlobalAclMenuSnapshot(
          supabase,
          authUserId,
          sessionId,
        );

        log({
          level: "INFO",
          request_id: requestId,
          event: "GLOBAL_ACL_SNAPSHOT_SUCCESS",
          meta: { count: menuRows.length },
        });
      } catch (error) {
        log({
          level: "ERROR",
          request_id: requestId,
          event: "GLOBAL_ACL_SNAPSHOT_REBUILD_FAILED",
          meta: { error: String(error) },
        });
      }

      return;
    }

    const companyId = selectedCompanyId ??
      await resolveDefaultWorkCompanyId(supabase, authUserId);
    const workContextId = companyId
      ? selectedWorkContextId ??
        await resolveDefaultWorkContextId(supabase, authUserId, companyId)
      : null;

    if (!companyId || !workContextId) {
      log({
        level: "WARN",
        request_id: requestId,
        event: "NO_RUNTIME_CONTEXT_FOUND",
      });
      return;
    }

    try {
      const menuRows = await rebuildAclSessionMenuSnapshot(
        supabase,
        authUserId,
        companyId,
        workContextId,
        sessionId,
      );

      log({
        level: "INFO",
        request_id: requestId,
        event: "ACL_SNAPSHOT_SUCCESS",
        meta: { companyId, workContextId, count: menuRows.length },
      });
    } catch (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        event: "ACL_SNAPSHOT_REBUILD_FAILED",
        meta: { companyId, workContextId, error: String(error) },
      });
    }
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      event: "SNAPSHOT_CRASH",
      meta: {
        error: String(err),
        stack: err instanceof Error ? err.stack : null,
      },
    });
  }

  log({
    level: "INFO",
    request_id: requestId,
    event: "SNAPSHOT_END",
    meta: { duration_ms: Date.now() - start },
  });
}

interface LoginContext {
  body: {
    identifier?: string;
    password?: string;
  };
  requestId: string;
  requestUrl: string;
}

export async function loginHandler(ctx: LoginContext): Promise<Response> {
  const { body, requestId, requestUrl } = ctx;

  const identifier = body?.identifier?.trim() ?? "";
  const password = body?.password ?? "";

  if (!identifier || !password) {
    return errorResponse("AUTH_FAIL", "Invalid", requestId, "NONE", 403);
  }

  const resolved = await resolveIdentifier(identifier);
  if (!resolved) {
    return errorResponse("AUTH_FAIL", "Invalid", requestId, "NONE", 403);
  }

  let authUserId: string;

  if (resolved.kind === "email") {
    const result = await verifyPassword(resolved.email, password);
    if (!result.ok || !result.session) {
      return errorResponse("AUTH_FAIL", "Invalid", requestId, "NONE", 403);
    }
    authUserId = result.user.id;
  } else {
    const { data, error } = await authClient.auth.admin.getUserById(
      resolved.authUserId,
    );

    if (error || !data?.user?.email) {
      return errorResponse("AUTH_FAIL", "Invalid", requestId, "NONE", 403);
    }

    const result = await verifyPassword(data.user.email, password);
    if (!result.ok || !result.session) {
      return errorResponse("AUTH_FAIL", "Invalid", requestId, "NONE", 403);
    }

    authUserId = resolved.authUserId;
  }

  const state = await getAccountState(authUserId);
  if (state !== "ACTIVE") {
    return errorResponse("AUTH_FAIL", "Inactive", requestId, "NONE", 403);
  }

  const supabase = createClient(
    ENV.SUPABASE_URL,
    ENV.SUPABASE_SERVICE_ROLE_KEY,
  );

  let roleCode: string | null = null;
  let userCode = "";

  try {
    const resolvedProfile = await resolveCanonicalAccessProfile(supabase, authUserId);
    roleCode = resolvedProfile.roleCode;
    userCode = resolvedProfile.userCode;
  } catch (error) {
    log({
      level: "ERROR",
      request_id: requestId,
      event: "USER_FETCH_FAILED",
      meta: { error: String(error) },
    });

    return errorResponse("AUTH_FAIL", "Invalid user", requestId, "NONE", 403);
  }

  if (!roleCode) {
    log({
      level: "SECURITY",
      request_id: requestId,
      event: "LOGIN_ROLE_MISSING_DENY",
      meta: { authUserId },
    });

    return errorResponse("AUTH_FAIL", "Role not assigned", requestId, "NONE", 403);
  }

  log({
    level: "INFO",
    request_id: requestId,
    event: "LOGIN_ROLE_RESOLVED",
    meta: { roleCode, userCode },
  });

  let selectedCompanyId: string | null = null;
  let selectedWorkContextId: string | null = null;

  if (roleCode !== "SA" && roleCode !== "GA") {
    try {
      selectedCompanyId = await resolveDefaultWorkCompanyId(supabase, authUserId);
    } catch (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        event: "WORK_COMPANY_RESOLUTION_FAILED",
        meta: { error: String(error), authUserId },
      });

      return errorResponse(
        "AUTH_FAIL",
        "Work company not assigned",
        requestId,
        "NONE",
        403,
      );
    }

    if (!selectedCompanyId) {
      return errorResponse(
        "AUTH_FAIL",
        "Work company not assigned",
        requestId,
        "NONE",
        403,
      );
    }

    try {
      selectedWorkContextId = await resolveDefaultWorkContextId(
        supabase,
        authUserId,
        selectedCompanyId,
      );
    } catch (error) {
      log({
        level: "ERROR",
        request_id: requestId,
        event: "WORK_CONTEXT_RESOLUTION_FAILED",
        meta: { error: String(error), authUserId, selectedCompanyId },
      });

      return errorResponse(
        "AUTH_FAIL",
        "Work context not assigned",
        requestId,
        "NONE",
        403,
      );
    }

    if (!selectedWorkContextId) {
      return errorResponse(
        "AUTH_FAIL",
        "Work context not assigned",
        requestId,
        "NONE",
        403,
      );
    }
  }

  let workspaceMode: "SINGLE" | "MULTI" | null = null;

  if (roleCode !== "SA" && roleCode !== "GA") {
    try {
      const allCompanyIds = await listCanonicalCompanyIds(supabase, authUserId);
      workspaceMode = allCompanyIds.length > 1 ? "MULTI" : "SINGLE";
    } catch {
      workspaceMode = "SINGLE";
    }
  }

  const { sessionId } = await createSession(
    authUserId,
    roleCode,
    selectedCompanyId,
    selectedWorkContextId,
    extractDeviceInfo(ctx),
    workspaceMode,
  );

  await buildAndStoreMenuSnapshot(
    sessionId,
    authUserId,
    requestId,
    selectedCompanyId,
    selectedWorkContextId,
    workspaceMode,
  );

  recordSessionTimeline({
    requestId,
    sessionId,
    userId: authUserId,
    event: "LOGIN",
  });

  const cookie = buildSessionCookie(sessionId, requestUrl);

  return new Response(
    JSON.stringify({ ok: true, request_id: requestId }),
    {
      status: 200,
      headers: {
        "Set-Cookie": cookie,
        "Content-Type": "application/json",
      },
    },
  );
}
