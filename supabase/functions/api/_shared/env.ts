/*
 * File-ID: ID-0.4A
 * File-Path: supabase/functions/api/_shared/env.ts
 * Gate: 0
 * Phase: 0
 * Domain: BACKEND
 * Purpose: Single authoritative environment access
 * Authority: Backend
 *
 * RULES:
 * - NO direct Deno.env.get() allowed outside this file
 * - All env access MUST go through requireEnv / ENV
 * - Missing env MUST crash fast (fail-closed)
 */

export function requireEnv(key: string): string {
  const value = Deno.env.get(key);

  if (!value || value.trim() === "") {
    throw new Error(`ENV_MISSING: ${key}`);
  }

  return value;
}

/**
 * Canonical environment map.
 * Add new keys ONLY here.
 */
export const ENV = Object.freeze({
  // Supabase
  SUPABASE_URL: requireEnv("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),

  // Applyflow
  APPLYFLOW_BASE_URL: requireEnv("APPLYFLOW_BASE_URL"),
  APPLYFLOW_API_KEY: requireEnv("APPLYFLOW_API_KEY"),
});
