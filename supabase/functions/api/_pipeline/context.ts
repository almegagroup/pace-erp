/*
 * File-ID: 7A
 * File-Path: supabase/functions/api/_pipeline/context.ts
 * Gate: 1
 * Phase: 1
 * Domain: CONTEXT
 * Purpose: Context resolver skeleton + invariant placeholders
 * Authority: Backend
 */

export type ContextResolution =
  | { status: "UNRESOLVED" }
  | { status: "RESOLVED"; companyId: string; projectId?: string };

function assertNoContextLeak(ctx: ContextResolution): void {
  // ---- ID-7A: Leak-prevention invariant ----
  // If context is unresolved, NO business logic should proceed later.
  if (ctx.status === "UNRESOLVED") {
    // Placeholder: future stages will convert this to deterministic action
    return;
  }
}

export async function stepContext(
  _req: Request,
  _requestId: string
): Promise<ContextResolution> {
  // Gate-1: no context logic yet
  const ctx: ContextResolution = { status: "UNRESOLVED" };

  // ---- ID-7A hook ----
  assertNoContextLeak(ctx);

  return ctx;
}
