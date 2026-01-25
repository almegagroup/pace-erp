/*
 * File-ID: 2.0A-AUTH-CLIENT
 * File-Path: supabase/functions/api/_core/auth/authClient.ts
 * Gate: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Centralized Supabase Auth authority client
 * Authority: Backend
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertServiceRole } from "../../_shared/serviceRoleClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("AUTH_CONFIG_MISSING");
}

// Gate-1 contract enforcement
assertServiceRole();

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
