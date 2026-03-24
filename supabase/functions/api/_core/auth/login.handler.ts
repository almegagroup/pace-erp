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

/* ---------------- DEVICE ---------------- */
function extractDeviceInfo(_ctx: LoginContext) {
  return {
    device_id: "unknown",
    device_summary: "unknown",
  };
}

/* ---------------- SNAPSHOT BUILDER ---------------- */
async function buildAndStoreMenuSnapshot(
  sessionId: string,
  authUserId: string,
  requestId: string
) {
  const start = Date.now();

  const supabase = createClient(
    ENV.SUPABASE_URL,
    ENV.SUPABASE_SERVICE_ROLE_KEY
  );

  log({
    level: "INFO",
    request_id: requestId,
    event: "SNAPSHOT_START",
    meta: { sessionId, authUserId },
  });

  try {
    /* =====================================================
     * 1️⃣ ROLE DETECTION (WITH SA FALLBACK)
     * ===================================================== */

    const { data: roleRow } = await supabase
      .schema("erp_map")
      .from("user_company_roles")
      .select("role_code")
      .eq("auth_user_id", authUserId)
      .maybeSingle(); // 🔥 SAFE

    // 🔹 Get user_code
const { data: userRow, error: userError } = await supabase
  .schema("erp_core")
  .from("users")
  .select("user_code")
  .eq("auth_user_id", authUserId)
  .single();

if (userError || !userRow) {
  log({
    level: "ERROR",
    request_id: requestId,
    event: "USER_FETCH_FAILED_SNAPSHOT",
    meta: { userError },
  });

  return;
}

const userCode = userRow.user_code;

let roleCode = roleRow?.role_code ?? null;

// 🟢 Admin allow
if (userCode.startsWith("SA")) {
  roleCode = "SA";
} else if (userCode.startsWith("GA")) {
  roleCode = "GA";
} else {
  // 🔴 ACL strict
  if (!roleCode) {
    log({
      level: "ERROR",
      request_id: requestId,
      event: "ROLE_MISSING_SNAPSHOT_DENY",
    });
    return;
  }
}

const isAdmin = roleCode === "SA" || roleCode === "GA";

    log({
      level: "INFO",
      request_id: requestId,
      event: "ROLE_DETECTED",
      meta: { roleCode, isAdmin },
    });

    /* =====================================================
     * 2️⃣ SA FLOW
     * ===================================================== */

    if (isAdmin) {
      const { data: menuRows, error: menuError } = await supabase
        .schema("erp_menu")
        .from("menu_snapshot")
        .select("*")
        .eq("user_id", authUserId)
        .eq("universe", "SA")
        .eq("is_visible", true)
        .order("display_order", { ascending: true });

      log({
        level: "INFO",
        request_id: requestId,
        event: "SA_MENU_FETCH",
        meta: {
          count: (menuRows as any)?.length ?? 0,
          error: menuError?.message ?? null,
        },
      });

      if (menuError) {
        log({
          level: "ERROR",
          request_id: requestId,
          event: "SA_MENU_FETCH_FAILED",
          meta: { menuError },
        });
        return;
      }

      if (!menuRows || menuRows.length === 0) {
        log({
          level: "WARN",
          request_id: requestId,
          event: "SA_MENU_EMPTY",
        });
        return;
      }

      const { error: upsertError } = await supabase
        .schema("erp_cache")
        .from("session_menu_snapshot")
        .upsert(
          {
            session_id: sessionId,
            auth_user_id: authUserId,
            universe: "SA",
            company_id: null,
            snapshot_version: menuRows[0]?.snapshot_version ?? 0,
            menu_json: menuRows,
          },
          { onConflict: "session_id,universe,company_id" }
        );

      if (upsertError) {
        log({
          level: "ERROR",
          request_id: requestId,
          event: "SA_SNAPSHOT_UPSERT_FAILED",
          meta: { upsertError },
        });
      } else {
        log({
          level: "INFO",
          request_id: requestId,
          event: "SA_SNAPSHOT_SUCCESS",
          meta: { count: menuRows.length },
        });
      }

      return;
    }

    /* =====================================================
     * 3️⃣ ACL FLOW
     * ===================================================== */

    const { data: companyRows, error: companyError } = await supabase
      .schema("erp_map")
      .from("user_company_roles")
      .select("company_id")
      .eq("auth_user_id", authUserId);

    if (companyError) {
      log({
        level: "ERROR",
        request_id: requestId,
        event: "COMPANY_FETCH_FAILED",
        meta: { companyError },
      });
      return;
    }

    if (!companyRows || companyRows.length === 0) {
      log({
        level: "WARN",
        request_id: requestId,
        event: "NO_COMPANY_FOUND",
      });
      return;
    }

    for (const row of companyRows) {
      const companyId = row.company_id;

      const { data: menuRows, error: menuError } = await supabase
        .schema("erp_menu")
        .from("menu_snapshot")
        .select("*")
        .eq("user_id", authUserId)
        .eq("universe", "ACL")
        .eq("company_id", companyId)
        .eq("is_visible", true)
        .order("display_order", { ascending: true });

      if (menuError) {
        log({
          level: "ERROR",
          request_id: requestId,
          event: "ACL_MENU_FETCH_FAILED",
          meta: { companyId, menuError },
        });
        continue;
      }

      if (!menuRows || menuRows.length === 0) continue;

      const { error: upsertError } = await supabase
        .schema("erp_cache")
        .from("session_menu_snapshot")
        .upsert(
          {
            session_id: sessionId,
            auth_user_id: authUserId,
            universe: "ACL",
            company_id: companyId,
            snapshot_version: menuRows[0]?.snapshot_version ?? 0,
            menu_json: menuRows,
          },
          { onConflict: "session_id,universe,company_id" }
        );

      if (upsertError) {
        log({
          level: "ERROR",
          request_id: requestId,
          event: "ACL_SNAPSHOT_UPSERT_FAILED",
          meta: { companyId, upsertError },
        });
      } else {
        log({
          level: "INFO",
          request_id: requestId,
          event: "ACL_SNAPSHOT_SUCCESS",
          meta: { companyId, count: menuRows.length },
        });
      }
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

/* ---------------- LOGIN ---------------- */
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
  resolved.authUserId
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
  /* =====================================================
 * 🔥 ROLE DETECT FOR SESSION CACHE
 * ===================================================== */

const supabase = createClient(
  ENV.SUPABASE_URL,
  ENV.SUPABASE_SERVICE_ROLE_KEY
);

const { data: roleRow } = await supabase
  .schema("erp_map")
  .from("user_company_roles")
  .select("role_code")
  .eq("auth_user_id", authUserId)
  .maybeSingle();

// 🔹 Get user_code
const { data: userRow, error: userError } = await supabase
  .schema("erp_core")
  .from("users")
  .select("user_code")
  .eq("auth_user_id", authUserId)
  .single();

if (userError || !userRow) {
  log({
    level: "ERROR",
    request_id: requestId,
    event: "USER_FETCH_FAILED",
    meta: { userError },
  });

  return errorResponse("AUTH_FAIL", "Invalid user", requestId, "NONE", 403);
}

const userCode = userRow.user_code;

let roleCode = roleRow?.role_code ?? null;

// 🟢 Admin allow (code-based)
if (userCode.startsWith("SA")) {
  roleCode = "SA";
} else if (userCode.startsWith("GA")) {
  roleCode = "GA";
} else {
  // 🔴 ACL strict
  if (!roleCode) {
  log({
    level: "SECURITY",
    request_id: requestId,
    event: "LOGIN_ROLE_MISSING_DENY",
    meta: { authUserId }
  });

  return errorResponse("AUTH_FAIL", "Role not assigned", requestId, "NONE", 403);
}
}

log({
  level: "INFO",
  request_id: requestId,
  event: "LOGIN_ROLE_RESOLVED",
  meta: { roleCode, userCode },
});

  const sessionId = await createSession(
  authUserId,
  roleCode,                    // 🔥 ADD
  extractDeviceInfo(ctx)
);

  await buildAndStoreMenuSnapshot(sessionId, authUserId, requestId);

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
    }
  );
}