import Fastify from "fastify"
import handler from "../supabase/functions/api/index.ts"

const app = Fastify()

app.all("/*", async (req, reply) => {

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
})

app.listen({
  port: Number(process.env.PORT) || 3000,
  host: "0.0.0.0"
})