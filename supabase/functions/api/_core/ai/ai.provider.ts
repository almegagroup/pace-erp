/**
 * PACE AI Core: provider adapter, backend only.
 * No ERP database access or user-provided tool invocation is permitted here.
 */
export type AiTextResult = {
  model: string;
  text: string;
  usage: { input_tokens: number; output_tokens: number };
};

export type AiTextRequest = {
  prompt: string;
  maxTokens: number;
  signal?: AbortSignal;
};

export class AiProviderError extends Error {
  constructor(public readonly code: "NOT_CONFIGURED" | "UNAVAILABLE" | "INVALID_RESPONSE" | "TIMEOUT") {
    super(code);
  }
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-5-5";

function tokenCount(input: unknown): number {
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export async function generateAiText(args: AiTextRequest): Promise<AiTextResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiProviderError("NOT_CONFIGURED");
  if (typeof args.prompt !== "string" || args.prompt.length === 0 || args.prompt.length > 4000) {
    throw new AiProviderError("INVALID_RESPONSE");
  }
  const maxTokens = Math.min(1024, Math.max(1, Math.trunc(args.maxTokens) || 64));
  const controller = new AbortController();
  const abort = () => controller.abort();
  args.signal?.addEventListener("abort", abort, { once: true });
  if (args.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: args.prompt }],
      }),
    });
    if (!response.ok) throw new AiProviderError("UNAVAILABLE");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") throw new AiProviderError("INVALID_RESPONSE");
    const message = payload as {
      model?: unknown;
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (!Array.isArray(message.content)) throw new AiProviderError("INVALID_RESPONSE");
    return {
      model: typeof message.model === "string" ? message.model : DEFAULT_MODEL,
      text: message.content.filter(x => x?.type === "text").map(x => x.text ?? "").join("").slice(0, 4096),
      usage: {
        input_tokens: tokenCount(message.usage?.input_tokens),
        output_tokens: tokenCount(message.usage?.output_tokens),
      },
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(controller.signal.aborted ? "TIMEOUT" : "UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener("abort", abort);
  }
}
