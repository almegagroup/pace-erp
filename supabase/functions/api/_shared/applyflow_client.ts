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
import { log } from "../_lib/logger.ts";

export type ApplyflowResponse = {
  gstin: string;
  legal_name: string;
  trade_name: string | null;
  status: string;
  address: Record<string, unknown>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(
  source: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function pickObject(
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const value = source[key];
    if (isObject(value)) {
      return value;
    }
  }

  return null;
}

function normalizeAddressPayload(
  info: Record<string, unknown>,
  raw: unknown,
): Record<string, unknown> {
  const directAddress =
    pickObject(info, ["address", "principalAddress"]) ??
    (isObject(raw) ? pickObject(raw, ["address"]) : null);

  if (directAddress) {
    return directAddress;
  }

  const principalRegistration = pickObject(info, ["pradr"]);
  if (principalRegistration) {
    const addr = pickObject(principalRegistration, ["addr"]);
    if (addr) {
      return {
        ...principalRegistration,
        ...addr,
      };
    }

    return principalRegistration;
  }

  return {};
}

function buildInvalidResponseMeta(
  gst: string,
  raw: unknown,
): Record<string, unknown> {
  const topLevelKeys = isObject(raw) ? Object.keys(raw) : [];
  const candidateKeys = isObject(raw)
    ? [
        "taxpayerInfo",
        "data",
        "result",
        "taxpayer",
        "gst",
        "gstDetails",
      ].map((key) => {
        const value = raw[key];
        return {
          key,
          nested_keys: isObject(value) ? Object.keys(value) : [],
        };
      })
    : [];

  let rawPreview = "";
  try {
    rawPreview = JSON.stringify(raw).slice(0, 1500);
  } catch {
    rawPreview = "[unserializable]";
  }

  return {
    gst_number: gst,
    top_level_keys: topLevelKeys,
    candidate_keys: candidateKeys,
    raw_preview: rawPreview,
  };
}

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
  const separator = baseUrl.includes("?") ? "&" : "?";
  const url = `${baseUrl}${separator}gstNo=${encodeURIComponent(gst)}&key_secret=${encodeURIComponent(apiKey)}`;

  // 4️⃣ Fetch
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
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

  const candidates = [
    isObject(raw) ? raw.taxpayerInfo : null,
    isObject(raw) && isObject(raw.data) ? raw.data.taxpayerInfo : null,
    isObject(raw) ? raw.data : null,
    isObject(raw) && isObject(raw.result) ? raw.result.taxpayerInfo : null,
    isObject(raw) ? raw.result : null,
    isObject(raw) ? raw.taxpayer : null,
    isObject(raw) ? raw.gstDetails : null,
    isObject(raw) ? raw.gst : null,
    raw,
  ].filter(isObject);

  const info =
    candidates.find((candidate) =>
      Boolean(
        pickString(candidate, ["gstin", "GSTIN", "gstNo", "gst_number"]) &&
        pickString(candidate, ["legalName", "legal_name", "lgnm", "tradeNam"]),
      ),
    ) ?? candidates[0];

  if (!info) {
    log({
      level: "ERROR",
      gate_id: "6.3.2A",
      event: "APPLYFLOW_RESPONSE_INVALID",
      meta: buildInvalidResponseMeta(gst, raw),
    });
    throw new Error("APPLYFLOW_INVALID_RESPONSE");
  }

  const gstin = pickString(info, ["gstin", "GSTIN", "gstNo", "gst_number"]);
  const legalName = pickString(info, ["legalName", "legal_name", "lgnm", "legal_name_of_business"]);
  const tradeName = pickString(info, ["tradeName", "trade_name", "tradeNam", "trade_name_of_business"]);
  const status = pickString(info, ["status", "sts", "gstStatus", "registrationStatus"]);
  const address = normalizeAddressPayload(info, raw);

  if (!gstin || !legalName) {
    log({
      level: "ERROR",
      gate_id: "6.3.2A",
      event: "APPLYFLOW_RESPONSE_INVALID",
      meta: buildInvalidResponseMeta(gst, raw),
    });
    throw new Error("APPLYFLOW_INVALID_RESPONSE");
  }

  // 6️⃣ Normalized SSOT-safe shape
  return {
    gstin,
    legal_name: legalName,
    trade_name: tradeName ?? null,
    status: status ?? "UNKNOWN",
    address,
  };
}
