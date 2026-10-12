/*
 * PACE AI Core — initial admin-only Anthropic connection smoke test.
 * No database reads/writes and no arbitrary caller prompts.
 * No feature is enabled unless AI_CORE_ENABLED=true.
 */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { errorResponse, okResponse } from "../response.ts";

type AdminContext = Extract<ContextResolution, { status: "RESOLVED" }>;

export function isAiSmokeAllowed(isAdmin: boolean, enabled: string | undefined): boolean {
  return isAdmin === true && enabled === "true";
}

export async function haikuSmokeHandler(
  req: Request,
  requestId: string,
  context: AdminContext,
): Promise<Response> {
  if (!isAiSmokeAllowed(context.isAdmin === true, process.env.AI_CORE_ENABLED)) {
    return errorResponse("AI_SMOKE_FORBIDDEN", "AI smoke test is not enabled for this user.", requestId, "NONE", 403, {}, req);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return errorResponse("AI_NOT_CONFIGURED", "AI provider is not configured.", requestId, "NONE", 503, {}, req);
  }

  // Hardcoded probe prevents exposing company, user, or business data.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 64,
        messages: [{ role: "user", content: "Reply with exactly: PACE AI connection OK" }],
      }),
    });

    if (!response.ok) {
      // Never echo upstream bodies or request headers. They could contain private data.
      return errorResponse("AI_PROVIDER_UNAVAILABLE", "The AI provider did not complete the connection test.", requestId, "NONE", 502, {}, req);
    }

    const result: unknown = await response.json();
    if (!result || typeof result !== "object") {
      return errorResponse("AI_PROVIDER_INVALID_RESPONSE", "Invalid AI provider response.", requestId, "NONE", 502, {}, req);
    }
    const payload = result as {
      model?: string;
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const message = payload.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("") ?? "";
    const inputTokens = Math.max(0, Number(payload.usage?.input_tokens ?? 0) || 0);
    const outputTokens = Math.max(0, Number(payload.usage?.output_tokens ?? 0) || 0);
    return okResponse({
      status: "CONNECTED",
      model: payload.model ?? "claude-haiku-5-5",
      response: message.slice(0, 256),
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      // Prices are not embedded in code: use Anthropic billing for actual charges.
    }, requestId, req);
  } catch {
    return errorResponse("AI_PROVIDER_TIMEOUT", "AI connection test failed or timed out.", requestId, "NONE", 502, {}, req);
  } finally {
    clearTimeout(timer);
  }
}
