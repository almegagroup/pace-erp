/*
 * File-ID: ID-6.3.4
 * File-Path: supabase/functions/api/_shared/gst_resolver.ts
 * Gate: 6
 * Phase: 6
 * Domain: INTEGRATION
 * Purpose: Cache-first GST resolver (DB → Applyflow → DB)
 * Authority: Backend
 */

import { fetchGstFromApplyflow } from "./applyflow_client.ts";
import { serviceRoleClient } from "./serviceRoleClient.ts";
import { log } from "../_lib/logger.ts";

type GstProfile = {
  gst_number: string;
  legal_name: string;
  trade_name?: string;
  status: string;
  address: Record<string, unknown>;
  raw_payload: Record<string, unknown>;
  source: "APPLYFLOW";
  fetched_at: string;
};

export type GstProfileResolution = {
  profile: GstProfile;
  source: "CACHE" | "APPLYFLOW";
};

/**
 * Canonical GST resolver
 * - Cache-first
 * - Deterministic
 * - Cost-safe
 */
export async function resolveGstProfileWithSource(
  rawGst: string
): Promise<GstProfileResolution> {
  const gst = rawGst.trim().toUpperCase();
  const db = serviceRoleClient;

  /* -----------------------------------------
   * 1️⃣ Try cache first
   * ----------------------------------------- */
  const { data: cached, error: cacheError } = await db
    .schema("erp_cache").from("gst_profiles")
    .select("*")
    .eq("gst_number", gst)
    .maybeSingle();

  if (cacheError) {
    throw new Error("GST_CACHE_LOOKUP_FAILED");
  }

  if (cached) {
    return {
      profile: cached as GstProfile,
      source: "CACHE",
    };
  }

  /* -----------------------------------------
   * 2️⃣ Fetch from Applyflow
   * ----------------------------------------- */
  const apiData = await fetchGstFromApplyflow(gst);

  const profile: GstProfile = {
    gst_number: gst,
    legal_name: apiData.legal_name,
    trade_name: apiData.trade_name ?? undefined,
    status: apiData.status ?? "UNKNOWN",
    address: (apiData.address ?? {}) as Record<string, unknown>,
    raw_payload: apiData as Record<string, unknown>,
    source: "APPLYFLOW",
    fetched_at: new Date().toISOString(),
  };

  /* -----------------------------------------
   * 3️⃣ Store in cache (idempotent)
   * ----------------------------------------- */
  const { error: insertError } = await db
    .schema("erp_cache").from("gst_profiles")
    .insert(profile);

  if (insertError) {
    log({
      level: "ERROR",
      gate_id: "6.3.4",
      event: "GST_CACHE_INSERT_ERROR",
      meta: {
        gst_number: gst,
        code: insertError.code ?? null,
        message: insertError.message ?? null,
        details: insertError.details ?? null,
        hint: insertError.hint ?? null,
      },
    });
    throw new Error("GST_CACHE_INSERT_FAILED");
  }

  return {
    profile,
    source: "APPLYFLOW",
  };
}

export async function resolveGstProfile(
  rawGst: string,
): Promise<GstProfile> {
  const resolved = await resolveGstProfileWithSource(rawGst);
  return resolved.profile;
}
