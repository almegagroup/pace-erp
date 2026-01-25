/*
 * File-ID: 12
 * File-Path: supabase/functions/api/_shared/rls_assert.ts
 * Gate: 1
 * Phase: 1
 * Domain: DB
 * Purpose: Assert RLS is enabled before any DB query
 * Authority: Backend
 */

// Contract-only assertion. Actual DB check will be wired
// when DB access is introduced (future Gate).
export function assertRlsEnabled(): void {
  // Gate-1: no DB calls yet.
  // This function exists as a mandatory checkpoint.
  // Future implementation MUST verify RLS via DB metadata.
  return;
}
