/*
 * File-ID: ID-6.3.2B
 * File-Path: supabase/functions/api/_shared/gst_profile.service.ts
 * Gate: 6
 * Phase: 6
 * Domain: CACHE
 * Purpose: Cache-first GST profile fetch with Applyflow fallback
 * Authority: Backend
 */



import { serviceRoleClient } from "../_shared/serviceRoleClient.ts";
import { fetchGstFromApplyflow } from "./applyflow_client.ts";

export async function getGstProfile(gstNumber: string) {
  const gst = gstNumber.trim().toUpperCase();
  const db = serviceRoleClient; // ✅ FIXED

  // 1) Cache lookup
  const { data: cached } = await db
    .from("erp_cache.gst_profiles")
    .select("*")
    .eq("gst_number", gst)
    .single();

  if (cached) {
    return { source: "CACHE", profile: cached };
  }

  // 2) Fetch from Applyflow
  const af = await fetchGstFromApplyflow(gst);

  const payload = {
    gst_number: gst,
    legal_name: af.legal_name,
    trade_name: af.trade_name ?? null,
    status: af.status ?? "UNKNOWN",
    address: af.address ?? {},
    raw_payload: af,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await db.from("erp_cache.gst_profiles").insert(payload);

  return { source: "APPLYFLOW", profile: payload };
}

