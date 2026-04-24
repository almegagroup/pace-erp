import ErpCompanySelector from "./ErpCompanySelector.jsx";
import {
  buildTransactionCompanyList,
  resolveDefaultTransactionCompanyId,
} from "./transactionCompanyRuntime.js";

export default function TransactionCompanySelector({
  runtimeContext,
  value,
  onChange,
  label = "Transaction Company",
  hint = "Alt+Y",
  disabled = false,
  selectRef,
}) {
  const availableCompanies = buildTransactionCompanyList(runtimeContext);
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
