// ID: 0.4A
// Gate: 0 | Phase: 0 | Domain: BACKEND
// Purpose: Single authoritative environment access
// Rule: NO direct Deno.env.get() allowed outside this file

export function requireEnv(key: string): string {
  const value = Deno.env.get(key);

  if (!value || value.trim() === "") {
    throw new Error(`ENV_MISSING: ${key}`);
  }

  return value;
}
