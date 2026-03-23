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
  const value =
    typeof Deno !== "undefined"
      ? Deno.env.get(key)
      : process.env[key];

  if (!value || value.trim() === "") {
    throw new Error(`ENV_MISSING: ${key}`);
  }

  return value;
}

/**
 * Canonical environment map.
 * Add new keys ONLY here.
 */
export const ENV = {
  // Supabase
  get SUPABASE_URL(): string {
    return requireEnv("SUPABASE_URL");
  },

  get SUPABASE_SERVICE_ROLE_KEY(): string {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },

  // Applyflow
  get APPLYFLOW_BASE_URL(): string {
    return requireEnv("APPLYFLOW_BASE_URL");
  },

  get APPLYFLOW_API_KEY(): string {
    return requireEnv("APPLYFLOW_API_KEY");
  },
} as const;