import { okResponse, errorResponse } from "../response.ts";
import type { SessionResolution } from "../../_pipeline/session.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";

interface MeProfileContext {
  session: SessionResolution;
  requestId: string;
  req: Request;
}

export async function meProfileHandler(
  ctx: MeProfileContext
): Promise<Response> {
  const { session, requestId, req } = ctx;

  if (session.status !== "ACTIVE") {
    return errorResponse(
      "AUTH_NOT_AUTHENTICATED",
      "Not authenticated",
      requestId,
      "LOGOUT",
      401,
      undefined,
      req
    );
  }

  const { data: userRow, error } = await serviceRoleClient
    .schema("erp_core")
    .from("users")
    .select("user_code")
    .eq("auth_user_id", session.authUserId)
    .single();

  if (error || !userRow?.user_code) {
    return errorResponse(
      "PROFILE_READ_FAILED",
      "Profile read failed",
      requestId,
      "NONE",
      403,
      {
        gateId: "PROFILE",
        routeKey: "GET:/api/me/profile",
        decisionTrace: "USER_CODE_NOT_FOUND",
      },
      req
    );
  }

  const { data: signupRow } = await serviceRoleClient
    .schema("erp_core")
    .from("signup_requests")
    .select("name")
    .eq("auth_user_id", session.authUserId)
    .maybeSingle();

  return okResponse(
    {
      user_code: userRow.user_code,
      role_code: session.roleCode,
      name: signupRow?.name ?? null,
    },
    requestId,
    req
  );
}
