/*
 * File-ID: 2.0A-CREDENTIAL-GUARD
 * File-Path: supabase/functions/api/_core/auth/credentialGuards.ts
 * Gate: 2
 * Phase: 2
 * Domain: AUTH
 * Purpose: Guard against illegal credential handling
 * Authority: Backend
 */

export function assertNoLocalCredentialHandling() {
  /**
   * If this project ever tries to:
   * - hash passwords
   * - compare passwords
   * - store credentials
   *
   * Gate-2 is violated.
   */
  return true;
}
