import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  confirmSTO,
  createSTO,
  listAvailableSubCsnsForSto,
} from "../procurementApi.js";
import LocationSelect from "../../../../components/inputs/LocationSelect.jsx";
import { useMaterialOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";

const STO_TYPE_OPTIONS = ["CONSIGNMENT_DISTRIBUTION", "INTER_PLANT"];
const MATERIAL_TYPES = ["RM", "PM", "INT", "FG", "TRA", "CONS"];

function createEmptyLine() {
  return {
    material_id: "",
    sending_storage_location_id: "",
    receiving_storage_location_id: "",
    quantity: "",
    uom_code: "",
    transfer_price: "",
    transfer_price_currency: "BDT",
    source_csn_id: "",
  };
}

export default function STOCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [form, setForm] = useState({
    sto_type: "CONSIGNMENT_DISTRIBUTION",
    sending_company_id: "",
    receiving_company_id: "",
    remarks: "",
  });
  const [materialType, setMaterialType] = useState("");
  const [lines, setLines] = useState([createEmptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pickerIndex, setPickerIndex] = useState(null);
  const materialQuery = useMaterialOptionsQuery({
    material_type: materialType || undefined,
    limit: 200,
    offset: 0,
  });
  const materials = materialQuery.materials;
  const loading = materialQuery.isLoading;
  const isConsignmentSto = form.sto_type === "CONSIGNMENT_DISTRIBUTION";

  const companies = runtimeContext?.availableCompanies ?? [];
  const companyOptions = useMemo(
    () =>
      companies.map((entry) => ({
        value: entry.id,
        label: entry.company_name || entry.company_code || entry.id,
      })),
    [companies]
  );
  const materialOptions = useMemo(
    () =>
      materials.map((entry) => ({
        value: entry.id,
        label: `${entry.pace_code || ""} ${entry.material_name || ""}`.trim(),
      })),
    [materials]
  );

  const subCsnQueries = useQueries({
    queries: lines.map((line, index) => {
      const params = {
        sending_company_id: form.sending_company_id,
        receiving_company_id: form.receiving_company_id,
        material_id: line.material_id,
      };
      return {
        queryKey: ["procurement", "available-sub-csns-for-sto", index, params],
        queryFn: () => listAvailableSubCsnsForSto(params),
        enabled:
          isConsignmentSto &&
          Boolean(form.sending_company_id) &&
          Boolean(form.receiving_company_id) &&
          Boolean(line.material_id),
      };
    }),
  });

  const anySubCsnLoading = subCsnQueries.some((query) => query.isLoading);

  useEffect(() => {
    setError(materialQuery.error?.message || "");
  }, [materialQuery.error]);

  useEffect(() => {
    if (loading) {
      return;
    }
    setForm((current) => ({
      ...current,
      sending_company_id:
        current.sending_company_id ||
        runtimeContext?.selectedCompanyId ||
        companies[0]?.id ||
        "",
      receiving_company_id:
        current.receiving_company_id ||
        companies.find((entry) => entry.id !== (runtimeContext?.selectedCompanyId || ""))?.id ||
        "",
    }));
  }, [companies, loading, runtimeContext?.selectedCompanyId]);

  function updateHeaderField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "sto_type" || key === "sending_company_id" || key === "receiving_company_id") {
      setLines((current) =>
        current.map((line) => ({
          ...line,
          source_csn_id: "",
          ...(key === "sto_type" && value === "INTER_PLANT"
            ? { quantity: line.quantity, uom_code: line.uom_code }
            : {}),
        }))
      );
      setPickerIndex(null);
    }
  }

  function updateLine(index, patch) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) {
          return line;
        }
        const nextLine = { ...line, ...patch };
        if (patch.material_id !== undefined && patch.material_id !== line.material_id) {
          nextLine.source_csn_id = "";
          if (isConsignmentSto) {
            nextLine.quantity = "";
            nextLine.uom_code = "";
          }
        }
        return nextLine;
      })
    );
  }

  function addLine() {
    setLines((current) => [...current, createEmptyLine()]);
  }

  function removeLine(index) {
    setLines((current) => (current.length === 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));
    setPickerIndex((current) => (current === index ? null : current));
  }

  function getSubCsnRows(index) {
    const query = subCsnQueries[index];
    return Array.isArray(query?.data) ? query.data : [];
  }

  function selectSubCsn(index, row) {
    updateLine(index, {
      source_csn_id: row.id,
      material_id: row.material_id,
      quantity: String(row.dispatch_qty ?? row.po_qty ?? ""),
      uom_code: row.po_uom_code || "",
    });
    setPickerIndex(null);
  }

  async function handleSubmit() {
    if (!form.sending_company_id || !form.receiving_company_id || lines.length === 0) {
      setError("Sending company, receiving company, and at least one line are required.");
      return;
    }
    if (isConsignmentSto) {
      if (lines.some((line) => !line.material_id || !line.source_csn_id)) {
        setError("Each consignment STO line requires a material and selected source sub-CSN.");
        return;
      }
    } else if (lines.some((line) => !line.material_id || !line.quantity || !line.uom_code)) {
      setError("Each STO line requires material, quantity, and UOM.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createSTO({
        sto_type: form.sto_type,
        sending_company_id: form.sending_company_id,
        receiving_company_id: form.receiving_company_id,
        remarks: form.remarks.trim() || null,
        lines: lines.map((line) => ({
          material_id: line.material_id,
          source_csn_id: line.source_csn_id || null,
          sending_storage_location_id: line.sending_storage_location_id || null,
          receiving_storage_location_id: line.receiving_storage_location_id || null,
          quantity: line.quantity ? Number(line.quantity) : null,
          uom_code: line.uom_code || null,
          transfer_price: line.transfer_price ? Number(line.transfer_price) : null,
          transfer_price_currency: line.transfer_price_currency || "BDT",
        })),
      });

      if (form.sto_type === "INTER_PLANT") {
        try {
          await confirmSTO(created?.id, { approval_required: true });
        } catch (confirmError) {
          setNotice(`STO ${created?.sto_number || created?.id || ""} was created in DRAFT, but confirm-for-approval failed.`);
          setError(confirmError instanceof Error ? confirmError.message : "STO_CONFIRM_FAILED");
          return;
        }
      }

      openScreen(OPERATION_SCREENS.PROC_STO_DETAIL.screen_code);
      navigate(`/dashboard/procurement/stos/${encodeURIComponent(created?.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_STO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="Procurement"
      title="Create Stock Transfer Order"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        {
          key: "save",
          label: saving ? "Saving..." : "Create STO",
          tone: "primary",
          onClick: () => void handleSubmit(),
          disabled: saving || loading || anySubCsnLoading,
        },
      ]}
      notices={[
        ...(error ? [{ key: "sto-create-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "sto-create-notice", tone: "success", message: notice }] : []),
      ]}
      formEyebrow="STO Header"
      formTitle="Create an inter-company stock transfer"
      formContent={
        loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading STO setup data...
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <ErpDenseFormRow label="STO Type" required>
                <select
                  value={form.sto_type}
                  onChange={(event) => updateHeaderField("sto_type", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  {STO_TYPE_OPTIONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Material Type">
                <select
                  value={materialType}
                  onChange={(event) => {
                    setMaterialType(event.target.value);
                    setLines((current) => current.map((line) => ({ ...line, material_id: "" })));
                  }}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">All types</option>
                  {MATERIAL_TYPES.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Sending Company" required>
                <select
                  value={form.sending_company_id}
                  onChange={(event) => updateHeaderField("sending_company_id", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select company</option>
                  {companyOptions.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Receiving Company" required>
                <select
                  value={form.receiving_company_id}
                  onChange={(event) => updateHeaderField("receiving_company_id", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select company</option>
                  {companyOptions.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Remarks">
                <textarea
                  rows={3}
                  value={form.remarks}
                  onChange={(event) => updateHeaderField("remarks", event.target.value)}
                  className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
            </div>

            <div className="grid gap-3 border-t border-slate-300 pt-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">STO Lines</div>
                <button
                  type="button"
                  onClick={addLine}
                  className="border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900"
                >
                  Add Line
                </button>
              </div>

              {lines.map((line, index) => {
                const subCsnRows = getSubCsnRows(index);
                const subCsnError = subCsnQueries[index]?.error?.message || "";
                const selectedSubCsn = subCsnRows.find((row) => row.id === line.source_csn_id) || null;
                return (
                  <div key={`sto-line-${index}`} className="grid gap-3 border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Line {index + 1}</div>
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        disabled={lines.length === 1}
                        className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                      <ErpDenseFormRow label="Material" required>
                        <ErpComboboxField
                          value={line.material_id}
                          onChange={(value) => updateLine(index, { material_id: value })}
                          options={materialOptions}
                          blankLabel="Select material"
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="Quantity" required>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={line.quantity}
                          onChange={(event) => updateLine(index, { quantity: event.target.value })}
                          disabled={isConsignmentSto}
                          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:opacity-60"
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="UOM Code" required>
                        <input
                          value={line.uom_code}
                          onChange={(event) => updateLine(index, { uom_code: event.target.value.toUpperCase() })}
                          disabled={isConsignmentSto}
                          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:opacity-60"
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="Sending SLOC">
                        <LocationSelect
                          companyId={form.sending_company_id}
                          projectCode="PRJ009"
                          value={line.sending_storage_location_id}
                          onChange={(id) => updateLine(index, { sending_storage_location_id: id })}
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="Receiving SLOC">
                        <LocationSelect
                          companyId={form.receiving_company_id}
                          projectCode="PRJ009"
                          value={line.receiving_storage_location_id}
                          onChange={(id) => updateLine(index, { receiving_storage_location_id: id })}
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="Transfer Price">
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={line.transfer_price}
                          onChange={(event) => updateLine(index, { transfer_price: event.target.value })}
                          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      </ErpDenseFormRow>
                    </div>

                    {isConsignmentSto ? (
                      <div className="grid gap-2 border-t border-slate-200 pt-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Source Sub-CSN</div>
                            <div className="text-sm text-slate-700">
                              {selectedSubCsn
                                ? `${selectedSubCsn.mother_po_number || "PO ?"} | ${selectedSubCsn.invoice_or_boe_reference || "No invoice/BOE"} | Qty ${selectedSubCsn.dispatch_qty ?? selectedSubCsn.po_qty ?? "—"}`
                                : "Select the sub-CSN slice that will feed this STO line."}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPickerIndex((current) => (current === index ? null : index))}
                            disabled={!form.sending_company_id || !form.receiving_company_id || !line.material_id}
                            className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 disabled:opacity-50"
                          >
                            {pickerIndex === index ? "Hide Picker" : "Select Sub-CSN"}
                          </button>
                        </div>
                        {subCsnError ? <div className="text-xs text-rose-700">{subCsnError}</div> : null}
                        {pickerIndex === index ? (
                          <div className="max-h-56 overflow-auto border border-slate-200 bg-white">
                            {subCsnQueries[index]?.isLoading ? (
                              <div className="px-3 py-4 text-sm text-slate-500">Loading matching sub-CSNs...</div>
                            ) : subCsnRows.length === 0 ? (
                              <div className="px-3 py-4 text-sm text-slate-500">No matching sub-CSNs found for this sending company, receiving company, and material.</div>
                            ) : (
                              subCsnRows.map((row) => (
                                <button
                                  key={row.id}
                                  type="button"
                                  onClick={() => selectSubCsn(index, row)}
                                  className={`grid w-full gap-1 border-b border-slate-100 px-3 py-3 text-left text-sm last:border-b-0 hover:bg-sky-50 ${
                                    row.id === line.source_csn_id ? "bg-sky-50" : "bg-white"
                                  }`}
                                >
                                  <div className="font-semibold text-slate-900">{row.mother_po_number || row.csn_number || row.id}</div>
                                  <div className="text-xs text-slate-600">Invoice / BOE: {row.invoice_or_boe_reference || "—"}</div>
                                  <div className="text-xs text-slate-600">Allotted Qty: {row.dispatch_qty ?? row.po_qty ?? "—"} {row.po_uom_code || ""}</div>
                                  <div className="text-xs text-slate-500">CSN Status: {row.status}</div>
                                </button>
                              ))
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )
      }
      bottomContent={
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {isConsignmentSto
            ? "Consignment STO lines must link to earmarked sub-CSNs for the receiving company."
            : "INTER_PLANT STOs are saved as DRAFT and immediately sent for approval after create."}
        </div>
      }
    />
  );
}
