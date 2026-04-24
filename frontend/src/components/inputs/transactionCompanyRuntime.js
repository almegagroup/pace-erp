function resolveCompanyId(company) {
  if (!company || typeof company !== "object") {
    return "";
  }

  return String(company.id ?? company.company_id ?? "").trim();
}

export function resolveDefaultTransactionCompanyId(runtimeContext) {
  const availableCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];
  const selectedCompanyId = String(runtimeContext?.selectedCompanyId ?? "").trim();
  const currentCompanyId = resolveCompanyId(runtimeContext?.currentCompany);

  return (
    selectedCompanyId ||
    currentCompanyId ||
    resolveCompanyId(availableCompanies[0]) ||
    ""
  );
}

export function buildTransactionCompanyList(runtimeContext) {
  const runtimeCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];
  const currentCompany = runtimeContext?.currentCompany ?? null;

  if (runtimeCompanies.length > 0) {
    return runtimeCompanies;
  }

  if (!currentCompany) {
    return [];
  }

  return [
    {
      id: resolveCompanyId(currentCompany),
      company_code: currentCompany.company_code ?? "",
      company_name: currentCompany.company_name ?? "",
    },
  ];
}
