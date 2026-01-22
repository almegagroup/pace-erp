/*
 * File-ID: 0.7A
 * File-Path: supabase/functions/api/_lib/request_id.ts
 * Gate: 0
 * Phase: 0
 * Domain: SECURITY
 * Purpose: Generate deterministic request identifiers
 * Authority: Backend
 */

export function generateRequestId(): string {
  return crypto.randomUUID();
}
