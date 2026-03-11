/*
 * Public Routes Dispatcher
 * Handles only routes that do NOT require session/ACL
 */

import { loginHandler } from "../_core/auth/login.handler.ts";
import { logoutHandler } from "../_core/auth/logout.handler.ts";
import { meHandler } from "../_core/auth/me.handler.ts";
import { signupHandler } from "../_core/auth/signup/signup.handler.ts";

import type { SessionResolution } from "./session.ts";

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

    case "GET:/api/me":
      return meHandler({
        session: sessionResult ?? { status: "ABSENT", action: "LOGOUT" },
        requestId,
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
      return new Response(
        JSON.stringify({
          status: "blocked",
          reason: "no_handler_matched",
          request_id: requestId,
        }),
        { status: 403 }
      );
  }
}