/*
 * File-ID: 2.0A-AUTH-DELEGATE
 * File-Path: supabase/functions/api/_core/auth/authDelegate.ts
 * Gate: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Delegate credential verification to Supabase Auth
 * Authority: Backend
 */

import { authClient } from "./authClient.ts";

export async function verifyPassword(
  email: string,
  password: string
) {
  /**
   * ERP NEVER verifies passwords itself.
   * This function ONLY delegates to Supabase Auth.
   */

  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { ok: false };
  }

  return {
    ok: true,
    user: data.user,
  };
}
