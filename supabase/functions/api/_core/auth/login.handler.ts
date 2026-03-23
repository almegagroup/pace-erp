/*
 * File-ID: 2.1A-AUTH-LOGIN-HANDLER
 * File-Path: supabase/functions/api/_core/auth/login.handler.ts
 * gate_id: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Verify user identity via Supabase Auth (hardened validation)
 * Authority: Backend
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
  const ua =
    typeof globalThis.navigator === "undefined"
      ? "unknown"
      : globalThis.navigator.userAgent ?? "unknown";

  return {
    device_id: ua,
    device_summary: ua.slice(0, 255),
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
    /* ---------- ROLE DETECT ---------- */
    const { data: roleRow, error: roleError } = await supabase
      .schema("erp_map")
      .from("user_company_roles")
      .select("role_code")
      .eq("auth_user_id", authUserId)
      .limit(1)
      .single();

    if (roleError) {
      log({
        level: "ERROR",
        request_id: requestId,
        event: "ROLE_FETCH_FAILED",
        meta: { roleError },
      });
      return;
    }

    const roleCode = roleRow?.role_code ?? null;
    const isAdmin = roleCode === "SA" || roleCode === "GA";

    log({
      level: "INFO",
      request_id: requestId,
      event: "ROLE_DETECTED",
      meta: { roleCode, isAdmin },
    });

    /* ================= SA / GA ================= */
    if (isAdmin) {
      const { data: menuRows, error: menuError } = await supabase
        .schema("erp_menu")
        .from("menu_snapshot")
        .select("*")
        .eq("user_id", authUserId)
        .eq("universe", "SA")
        .eq("is_visible", true)
        .order("display_order", { ascending: true });

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

      await supabase
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

      log({
        level: "INFO",
        request_id: requestId,
        event: "SA_SNAPSHOT_DONE",
        meta: { count: menuRows.length },
      });

      return;
    }

    /* ================= ACL ================= */
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

      await supabase
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

      log({
        level: "INFO",
        request_id: requestId,
        event: "ACL_SNAPSHOT_DONE",
        meta: { companyId, count: menuRows.length },
      });
    }
  } catch (err) {
    log({
      level: "ERROR",
      request_id: requestId,
      event: "SNAPSHOT_CRASH",
      meta: { err },
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

const GENERIC_CODE = "AUTH_INVALID_CREDENTIALS";
const GENERIC_MESSAGE = "Invalid credentials";

export async function loginHandler(ctx: LoginContext): Promise<Response> {
  const { body, requestId, requestUrl } = ctx;

  const identifier =
    typeof body?.identifier === "string" ? body.identifier.trim() : "";

  const password =
    typeof body?.password === "string" ? body.password : "";

  if (!identifier || !password) {
    log({ level: "SECURITY", request_id: requestId, event: "LOGIN_FAIL_EMPTY" });
    return errorResponse(GENERIC_CODE, GENERIC_MESSAGE, requestId, "NONE", 403);
  }

  const resolved = await resolveIdentifier(identifier);

  if (!resolved) {
    log({ level: "SECURITY", request_id: requestId, event: "LOGIN_FAIL_RESOLVE" });
    return errorResponse(GENERIC_CODE, GENERIC_MESSAGE, requestId, "NONE", 403);
  }

  let authUserId: string;

  if (resolved.kind === "email") {
    const result = await verifyPassword(resolved.email, password);

    if (!result.ok || !result.session) {
      log({ level: "SECURITY", request_id: requestId, event: "LOGIN_FAIL_PASSWORD" });
      return errorResponse(GENERIC_CODE, GENERIC_MESSAGE, requestId, "NONE", 403);
    }

    authUserId = result.user.id;
  } else {
    const { data, error } = await authClient.auth.admin.getUserById(
      resolved.authUserId
    );

    if (error || !data?.user?.email) {
      log({ level: "SECURITY", request_id: requestId, event: "LOGIN_FAIL_FETCH_USER" });
      return errorResponse(GENERIC_CODE, GENERIC_MESSAGE, requestId, "NONE", 403);
    }

    const result = await verifyPassword(data.user.email, password);

    if (!result.ok || !result.session) {
      log({ level: "SECURITY", request_id: requestId, event: "LOGIN_FAIL_PASSWORD" });
      return errorResponse(GENERIC_CODE, GENERIC_MESSAGE, requestId, "NONE", 403);
    }

    authUserId = resolved.authUserId;
  }

  const state = await getAccountState(authUserId);

  if (state !== "ACTIVE") {
    log({ level: "SECURITY", request_id: requestId, event: "LOGIN_FAIL_STATE" });
    return errorResponse(GENERIC_CODE, GENERIC_MESSAGE, requestId, "NONE", 403);
  }

  const device = extractDeviceInfo(ctx);
  const sessionId = await createSession(authUserId, device);

  /* 🔥 SNAPSHOT BUILD */
  await buildAndStoreMenuSnapshot(sessionId, authUserId, requestId);

  recordSessionTimeline({
    requestId,
    sessionId,
    userId: authUserId,
    event: "LOGIN",
  });

  const cookie = buildSessionCookie(sessionId, requestUrl);

  log({
    level: "SECURITY",
    request_id: requestId,
    event: "AUTH_LOGIN_SUCCESS",
  });

  return new Response(
    JSON.stringify({ ok: true, request_id: requestId }),
    {
      status: 200,
      headers: {
        "Set-Cookie": cookie,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}