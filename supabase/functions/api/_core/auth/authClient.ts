/*
 * File-ID: 2.0A-AUTH-CLIENT
 * File-Path: supabase/functions/api/_core/auth/authClient.ts
 * Gate: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Centralized Supabase Auth authority client
 * Authority: Backend
 */

import { createClient } from "@supabase/supabase-js";
import { assertServiceRole } from "../../_shared/serviceRoleClient.ts";

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
  throw new Error("AUTH_CONFIG_MISSING");
}

/* --------------------------------------------------
 * Gate-1 contract enforcement
 * -------------------------------------------------- */

assertServiceRole();

/* --------------------------------------------------
 * Supabase Auth Client
 * -------------------------------------------------- */

export const authClient = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);