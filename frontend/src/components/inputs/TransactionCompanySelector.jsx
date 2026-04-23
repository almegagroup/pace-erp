import ErpCompanySelector from "./ErpCompanySelector.jsx";

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

export default function TransactionCompanySelector({
  runtimeContext,
  value,
  onChange,
  label = "Transaction Company",
  hint = "Alt+Y",
  disabled = false,
  selectRef,
}) {
  const runtimeCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];
  const currentCompany = runtimeContext?.currentCompany ?? null;
  const availableCompanies =
    runtimeCompanies.length > 0
      ? runtimeCompanies
      : currentCompany
        ? [
            {
              id: resolveCompanyId(currentCompany),
              company_code: currentCompany.company_code ?? "",
              company_name: currentCompany.company_name ?? "",
            },
          ]
        : [];
  const workspaceMode = String(runtimeContext?.workspaceMode ?? "").toUpperCase();
  const resolvedValue =
    String(value ?? "").trim() || resolveDefaultTransactionCompanyId(runtimeContext);
  const readOnly = workspaceMode !== "MULTI" || availableCompanies.length <= 1;

  return (
    <ErpCompanySelector
      companies={availableCompanies}
      value={resolvedValue}
      onChange={onChange}
      mode="required"
      label={label}
      hint={hint}
      disabled={disabled}
      readOnly={readOnly}
      selectRef={selectRef}
    />
  );
}
