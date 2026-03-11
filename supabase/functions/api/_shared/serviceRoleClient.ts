/*
 * File-ID: 0.5A
 * Gate: 0
 * Phase: 0
 * Domain: SECURITY
 * Purpose: Service role usage policy
 * Authority: Backend-only
 */

import { createClient } from "@supabase/supabase-js";
import { buildRlsContextHeaders } from "./context_headers.ts";
import type { ContextResolution } from "../_pipeline/context.ts";

/* --------------------------------------------------
 * ENV RESOLUTION (Deno + Node compatible)
 * -------------------------------------------------- */

const SUPABASE_URL =
  typeof Deno !== "undefined"
    ? Deno.env.get("SUPABASE_URL")
    : process.env.SUPABASE_URL;

const SERVICE_ROLE_KEY =
  typeof Deno !== "undefined"
    ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    : process.env.SUPABASE_SERVICE_ROLE_KEY;

/* --------------------------------------------------
 * ENV SAFETY ASSERTION
 * -------------------------------------------------- */

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("SERVICE_ROLE_NOT_CONFIGURED");
}

/* --------------------------------------------------
 * BASE SERVICE ROLE CLIENT
 * -------------------------------------------------- */

export const serviceRoleClient = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    global: { fetch },
  }
);

/* --------------------------------------------------
 * SERVICE ROLE ASSERTION
 * -------------------------------------------------- */

export function assertServiceRole(): void {
  if (!SERVICE_ROLE_KEY) {
    throw new Error("DB_SERVICE_ROLE_ASSERTION_FAILED");
  }
}

/* --------------------------------------------------
 * CONTEXT-AWARE SERVICE ROLE CLIENT
 * (RLS context injection)
 * -------------------------------------------------- */

export function getServiceRoleClientWithContext(ctx: ContextResolution) {
  const headers = buildRlsContextHeaders(ctx);

  return createClient(
    SUPABASE_URL!,
    SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      global: { headers, fetch },
    }
  );
}