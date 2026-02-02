/*
 * File-ID: ID-6.3.2A
 * File-Path: supabase/functions/api/_shared/applyflow_client.ts
 * Gate: 6
 * Phase: 6
 * Domain: INTEGRATION
 * Purpose: Backend-only Applyflow GST fetch client (vendor-aligned, cache-safe)
 * Authority: Backend
 */

import { ENV } from "./env.ts";

export type ApplyflowResponse = {
  gstin: string;
  legal_name: string;
  trade_name: string | null;
  status: string;
  address: Record<string, unknown>;
};

/**
 * Fetch GST profile from Applyflow
 * Deterministic:
 * - Any anomaly → throw
 * - No silent fallback
 */
export async function fetchGstFromApplyflow(
  gstNumber: string
): Promise<ApplyflowResponse> {
  // 1️⃣ ENV contract
  const baseUrl = ENV.APPLYFLOW_BASE_URL;
  const apiKey = ENV.APPLYFLOW_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("APPLYFLOW_ENV_NOT_CONFIGURED");
  }

  // 2️⃣ Normalize GST
  const gst = gstNumber?.trim().toUpperCase();
  if (!gst) {
    throw new Error("GST_NUMBER_EMPTY");
  }

  // 3️⃣ Vendor-aligned endpoint (as per doc)
  // Example:
  // https://appyflow.in/api/verifyGST?gstNo=XXXXXXXXXXXXXXX
  const url = `${baseUrl}?gstNo=${gst}`;

  // 4️⃣ Fetch
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`APPLYFLOW_HTTP_${res.status}`);
  }

  // 5️⃣ Parse
  const raw = (await res.json()) as any;

  /**
   * Expected vendor fields (doc-based):
   * raw.taxpayerInfo.gstin
   * raw.taxpayerInfo.legalName
   * raw.taxpayerInfo.tradeName
   * raw.taxpayerInfo.status
   * raw.taxpayerInfo.address
   */

  const info = raw?.taxpayerInfo;

  if (!info || typeof info.gstin !== "string") {
    throw new Error("APPLYFLOW_INVALID_RESPONSE");
  }

  // 6️⃣ Normalized SSOT-safe shape
  return {
    gstin: info.gstin,
    legal_name: String(info.legalName ?? ""),
    trade_name: info.tradeName ?? null,
    status: String(info.status ?? "UNKNOWN"),
    address: info.address ?? {},
  };
}
