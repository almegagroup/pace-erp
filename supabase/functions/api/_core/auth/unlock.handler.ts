import { errorResponse, okResponse } from "../response.ts";
import { verifyPassword } from "./authDelegate.ts";
import { authClient } from "./authClient.ts";
import type { SessionResolution } from "../../_pipeline/session.ts";

interface UnlockContext {
  session: SessionResolution;
  requestId: string;
  req: Request;
  body: {
    password?: string;
  };
}

export async function unlockHandler(ctx: UnlockContext): Promise<Response> {
  const { session, requestId, req, body } = ctx;

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

  const password = body?.password ?? "";
  if (!password) {
    return errorResponse(
      "UNLOCK_PASSWORD_REQUIRED",
      "Password required",
      requestId,
      "NONE",
      400,
      undefined,
      req
    );
  }

  const { data, error } = await authClient.auth.admin.getUserById(
    session.authUserId
  );

  if (error || !data?.user?.email) {
    return errorResponse(
      "UNLOCK_USER_NOT_FOUND",
      "User not found",
      requestId,
      "NONE",
      403,
      undefined,
      req
    );
  }

  const result = await verifyPassword(data.user.email, password);
  if (!result.ok || !result.session) {
    return errorResponse(
      "UNLOCK_INVALID_PASSWORD",
      "Invalid password",
      requestId,
      "NONE",
      403,
      undefined,
      req
    );
  }

  return okResponse({ unlocked: true }, requestId, req);
}
