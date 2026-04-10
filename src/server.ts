import Fastify from "fastify"
import handler from "../supabase/functions/api/index.ts"
import { generateRequestId } from "../supabase/functions/api/_lib/request_id.ts"
import { log } from "../supabase/functions/api/_lib/logger.ts"
import { errorResponse } from "../supabase/functions/api/_core/response.ts"
import { applyCORS } from "../supabase/functions/api/_pipeline/cors.ts"
import { applySecurityHeaders } from "../supabase/functions/api/_security/security_headers.ts"
import { applyCSP } from "../supabase/functions/api/_security/csp.ts"

const app = Fastify()

app.all("/*", async (req, reply) => {
  const requestId = generateRequestId()

  try {
    const body =
      req.body && typeof req.body === "object"
        ? JSON.stringify(req.body)
        : req.body

    const request = new Request(
      `http://localhost${req.url}`,
      {
        method: req.method,
        headers: req.headers as any,
        body: body
      }
    )

    const response = await handler(request)
    const text = await response.text()

    reply
      .code(response.status)
      .headers(Object.fromEntries(response.headers))
      .send(text)
  } catch (error) {
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers as any,
    })

    const code = error instanceof Error ? error.message : "SERVER_ADAPTER_FAILURE"

    log({
      level: "ERROR",
      request_id: requestId,
      gate_id: "NODE_ADAPTER",
      event: "server_adapter_error",
      meta: {
        code,
        route: `${req.method}:${req.url}`,
      },
    })

    const fallback = applyCSP(
      applySecurityHeaders(
        applyCORS(
          request,
          errorResponse(
            "REQUEST_BLOCKED",
            "Unexpected server failure",
            requestId,
            "NONE",
            500,
            {
              gateId: "NODE_ADAPTER",
              routeKey: `${req.method}:${req.url}`,
              decisionTrace: code,
            },
            request
          )
        ),
        requestId
      )
    )

    const text = await fallback.text()

    reply
      .code(fallback.status)
      .headers(Object.fromEntries(fallback.headers))
      .send(text)
  }
})

app.listen({
  port: Number(process.env.PORT) || 3000,
  host: "0.0.0.0"
})
