function pickFirst(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null;
}

export function formatCompanyMeta(company) {
  const parts = [
    pickFirst(company?.state_name, company?.company_state_name),
    pickFirst(company?.pin_code, company?.company_pin_code)
      ? `PIN ${pickFirst(company?.pin_code, company?.company_pin_code)}`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : "State and PIN not captured";
}

export function formatCompanyAddress(company) {
  return pickFirst(company?.full_address, company?.company_full_address) ?? "Address not captured";
}

export function formatCompanyLabel(company, { separator = " | " } = {}) {
  return [pickFirst(company?.company_code), pickFirst(company?.company_name)]
    .filter(Boolean)
    .join(separator) || "Company not captured";
}

export function formatCompanyOptionLabel(company) {
  const label = formatCompanyLabel(company);
  const address = [
    pickFirst(company?.full_address, company?.company_full_address),
    pickFirst(company?.state_name, company?.company_state_name),
    pickFirst(company?.pin_code, company?.company_pin_code),
  ]
    .filter(Boolean)
    .join(", ");

  return address ? `${label} | ${address}` : label;
}
