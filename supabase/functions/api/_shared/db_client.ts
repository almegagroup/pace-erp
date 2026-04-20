/*
 * File-ID: 0.5D
 * File-Path: supabase/functions/api/_shared/db_client.ts
 * Gate: 0
 * Phase: 0
 * Domain: SECURITY
 * Purpose: Shared structural typing contract for Supabase database helpers
 * Authority: Backend
 */

export type DbQueryBuilder = {
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
  then?: PromiseLike<any>["then"];
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
