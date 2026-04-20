/*
 * File-ID: 0.5D
 * File-Path: supabase/functions/api/_shared/db_client.ts
 * Gate: 0
 * Phase: 0
 * Domain: SECURITY
 * Purpose: Shared structural typing contract for Supabase database helpers
 * Authority: Backend
 */

// DbQueryBuilder explicitly extends PromiseLike<{data, error}> so that TypeScript
// recognises direct `await` of a query chain as valid (TS1320 / deno-ts(1320)).
// The intersection keeps full structural compatibility with the real Supabase client
// because PostgrestQueryBuilder is itself PromiseLike<PostgrestResponse<any>> and
// TypeScript's method-parameter bivariance makes the two PromiseLike instantiations
// structurally compatible.
export type DbQueryBuilder = PromiseLike<{ data: any; error: any }> & {
  select: (...args: unknown[]) => DbQueryBuilder;
  insert: (...args: unknown[]) => DbQueryBuilder;
  upsert: (...args: unknown[]) => DbQueryBuilder;
  update: (...args: unknown[]) => DbQueryBuilder;
  delete: (...args: unknown[]) => DbQueryBuilder;
  eq: (...args: unknown[]) => DbQueryBuilder;
  neq: (...args: unknown[]) => DbQueryBuilder;
  in: (...args: unknown[]) => DbQueryBuilder;
  is: (...args: unknown[]) => DbQueryBuilder;
  not: (...args: unknown[]) => DbQueryBuilder;
  order: (...args: unknown[]) => DbQueryBuilder;
  limit: (...args: unknown[]) => DbQueryBuilder;
  maybeSingle: (...args: unknown[]) => Promise<{ data: any; error: any }>;
  single: (...args: unknown[]) => Promise<{ data: any; error: any }>;
};

export type DbSchemaClient = {
  from: (table: string) => DbQueryBuilder;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: any; error: any }>;
};

export type DbClient = {
  schema: (schema: string) => DbSchemaClient;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: any; error: any }>;
};
