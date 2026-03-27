/*
 * File-ID: ID-9.2C
 * File-Path: supabase/functions/api/_shared/gst_company_fields.ts
 * Gate: 9
 * Phase: 9
 * Domain: INTEGRATION
 * Purpose: Normalize GST profile address payload into company-master fields
 * Authority: Backend
 */

type GstAddress = Record<string, unknown>;

type GstProfileLike = {
  legal_name: string;
  address?: GstAddress;
};

type CompanyAddressFields = {
  company_name: string;
  state_name: string | null;
  full_address: string | null;
  pin_code: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickFirstString(
  address: GstAddress,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = normalizeText(address[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizePinCode(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\d{6}/);
  return match?.[0] ?? value;
}

function deriveFullAddress(address: GstAddress): string | null {
  const direct = pickFirstString(address, [
    "fullAddress",
    "full_address",
    "formattedAddress",
    "formatted_address",
    "address",
    "addr",
    "completeAddress",
  ]);

  if (direct) {
    return direct;
  }

  const orderedKeys = [
    "bno",
    "bnm",
    "flno",
    "st",
    "lt",
    "loc",
    "city",
    "dst",
    "stcd",
    "pncd",
    "buildingNumber",
    "building_number",
    "buildingName",
    "building_name",
    "floorNumber",
    "floor_number",
    "street",
    "streetName",
    "street_name",
    "road",
    "locality",
    "location",
    "area",
    "city",
    "district",
    "state",
    "stateName",
    "state_name",
    "pincode",
    "pinCode",
    "pin_code",
    "postalCode",
    "postal_code",
  ];

  const parts = orderedKeys
    .map((key) => normalizeText(address[key]))
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);

  if (parts.length > 0) {
    return parts.join(", ");
  }

  const fallbackParts = Object.values(address)
    .map((value) => normalizeText(value))
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);

  return fallbackParts.length > 0 ? fallbackParts.join(", ") : null;
}

export function deriveCompanyFieldsFromGstProfile(
  profile: GstProfileLike,
): CompanyAddressFields {
  const address = profile.address ?? {};

  return {
    company_name: normalizeText(profile.legal_name) ?? "",
    state_name: pickFirstString(address, [
      "stcd",
      "state",
      "stateName",
      "state_name",
      "statename",
    ]),
    full_address: deriveFullAddress(address),
    pin_code: normalizePinCode(
      pickFirstString(address, [
        "pncd",
        "pincode",
        "pinCode",
        "pin_code",
        "postalCode",
        "postal_code",
        "zip",
        "zipCode",
      ]),
    ),
  };
}
