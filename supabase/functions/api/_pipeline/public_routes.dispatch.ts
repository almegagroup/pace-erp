/*
 * Public Routes Dispatcher
 * Handles only routes that do NOT require session/ACL
 */

import { loginHandler } from "../_core/auth/login.handler.ts";
import { logoutHandler } from "../_core/auth/logout.handler.ts";
import { signupHandler } from "../_core/auth/signup/signup.handler.ts";

import type { SessionResolution } from "./session.ts";
import { errorResponse } from "../_core/response.ts";


export async function dispatchPublicRoute(
  routeKey: string,
  req: Request,
  requestId: string,
  sessionResult: SessionResolution | null
): Promise<Response> {

  switch (routeKey) {

    case "POST:/api/login":
      return await loginHandler({
        body: await req.json(),
        requestId,
        requestUrl: req.url,
      });
    case "POST:/api/logout":
      return await logoutHandler({
        session: sessionResult ?? { status: "ABSENT", action: "LOGOUT" },
        requestId,
        requestUrl: req.url,
      });

    case "POST:/api/signup":
      return await signupHandler(req);

    default:
      return errorResponse(
  "NO_HANDLER_MATCHED",
  "Route not handled",
  requestId,
  "NONE",
  403,
  {
    gateId: "PUBLIC_DISPATCH",
    routeKey,
    decisionTrace: "NO_HANDLER"
  },
  req
);
  }
}