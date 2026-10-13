/*
 * PACE AI Core — restricted and feature-gated provider connection test.
 * No company data, business documents, or freeform user prompts.
 */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { errorResponse, okResponse } from "../response.ts";
import { AiProviderError, generateAiText } from "./ai.provider.ts";

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

  try {
    const result = await generateAiText({
      prompt: "Reply with exactly: PACE AI connection OK",
      maxTokens: 64,
    });
    return okResponse({
      status: "CONNECTED",
      model: result.model,
      response: result.text.slice(0, 256),
      usage: result.usage,
    }, requestId, req);
  } catch (error) {
    const code = error instanceof AiProviderError ? error.code : "UNAVAILABLE";
    if (code === "NOT_CONFIGURED") {
      return errorResponse("AI_NOT_CONFIGURED", "AI provider is not configured.", requestId, "NONE", 503, {}, req);
    }
    if (code === "INVALID_RESPONSE") {
      return errorResponse("AI_PROVIDER_INVALID_RESPONSE", "Invalid AI provider response.", requestId, "NONE", 502, {}, req);
    }
    if (code === "TIMEOUT") {
      return errorResponse("AI_PROVIDER_TIMEOUT", "AI connection test timed out.", requestId, "NONE", 502, {}, req);
    }
    return errorResponse("AI_PROVIDER_UNAVAILABLE", "The AI provider did not complete the connection test.", requestId, "NONE", 502, {}, req);
  }
}
