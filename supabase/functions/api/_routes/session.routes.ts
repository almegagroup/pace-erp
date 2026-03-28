/*
 * File-ID: 3.10D
 * File-Path: supabase/functions/api/_routes/session.routes.ts
 * Gate: 3
 * Phase: 3
 * Domain: SESSION
 * Purpose: Protected route dispatcher for session-cluster lifecycle and governed multi-window endpoints.
 * Authority: Backend
 */

import type { SessionResolution } from "../_pipeline/session.ts";
import {
  admitSessionClusterWindowHandler,
  closeSessionClusterWindowHandler,
  issueSessionClusterJoinTicketHandler,
} from "../_core/session/session.cluster.handler.ts";

export async function dispatchSessionRoutes(
  routeKey: string,
  req: Request,
  requestId: string,
  session: Extract<SessionResolution, { status: "ACTIVE" }>
): Promise<Response | null> {
  switch (routeKey) {
    case "POST:/api/session/cluster/admit":
      return await admitSessionClusterWindowHandler({
        session,
        requestId,
        req,
      });

    case "POST:/api/session/cluster/open-window":
      return await issueSessionClusterJoinTicketHandler({
        session,
        requestId,
        req,
      });

    case "POST:/api/session/cluster/window-close":
      return await closeSessionClusterWindowHandler({
        session,
        requestId,
        req,
      });

    default:
      return null;
  }
}
