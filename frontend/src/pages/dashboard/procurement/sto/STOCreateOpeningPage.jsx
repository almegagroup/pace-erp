import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import LocationSelect from "../../../../components/inputs/LocationSelect.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { useMaterialOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { confirmSTO, createSTO } from "../procurementApi.js";

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
  };
}

export default function STOCreateOpeningPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [form, setForm] = useState({
    sto_number: "",
    sto_date: new Date().toISOString().slice(0, 10),
    sending_company_id: "",
    receiving_company_id: "",
    remarks: "",
  });
  const [materialType, setMaterialType] = useState("");
  const [lines, setLines] = useState([createEmptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const materialQuery = useMaterialOptionsQuery({
    material_type: materialType || undefined,
    limit: 200,
    offset: 0,
  });
  const materials = materialQuery.materials;
  const loading = materialQuery.isLoading;

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
  }

  function updateLine(index, patch) {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line))
    );
  }

  function addLine() {
    setLines((current) => [...current, createEmptyLine()]);
  }

  function removeLine(index) {
    setLines((current) => (current.length === 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));
  }

  async function handleSubmit() {
    if (!form.sto_number.trim()) {
      setError("Legacy STO Number is required.");
      return;
    }
    if (!form.sending_company_id || !form.receiving_company_id || lines.length === 0) {
      setError("Sending company, receiving company, and at least one line are required.");
      return;
    }
    if (lines.some((line) => !line.material_id || !line.quantity || !line.uom_code)) {
      setError("Each STO line requires material, quantity, and UOM.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createSTO({
        sto_type: "INTER_PLANT",
        sto_number: form.sto_number.trim(),
        sto_date: form.sto_date || null,
        is_opening_sto: true,
        sending_company_id: form.sending_company_id,
        receiving_company_id: form.receiving_company_id,
        remarks: form.remarks.trim() || null,
        lines: lines.map((line) => ({
          material_id: line.material_id,
          sending_storage_location_id: line.sending_storage_location_id || null,
          receiving_storage_location_id: line.receiving_storage_location_id || null,
          quantity: Number(line.quantity),
          uom_code: line.uom_code || null,
          transfer_price: line.transfer_price ? Number(line.transfer_price) : null,
          transfer_price_currency: line.transfer_price_currency || "BDT",
        })),
      });

      await confirmSTO(created?.id, { approval_required: false });
      setNotice(`Opening STO ${created?.sto_number || form.sto_number.trim()} created and confirmed.`);
      navigate("/dashboard/procurement/stos");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_STO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="Procurement"
      title="Create Opening / Legacy Stock Transfer Order"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        {
          key: "save",
          label: saving ? "Saving..." : "Create Opening STO",
          tone: "primary",
          onClick: () => void handleSubmit(),
          disabled: saving || loading,
        },
      ]}
      notices={[
        ...(error ? [{ key: "sto-opening-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "sto-opening-notice", tone: "success", message: notice }] : []),
      ]}
      formEyebrow="STO Header"
      formTitle="Load a legacy inter-company stock transfer"
      formContent={
        loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading STO setup data...
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <ErpDenseFormRow label="Legacy STO Number" required>
                <input
                  value={form.sto_number}
                  onChange={(event) => updateHeaderField("sto_number", event.target.value.toUpperCase())}
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="STO Date" required>
                <input
                  type="date"
                  value={form.sto_date}
                  onChange={(event) => updateHeaderField("sto_date", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
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

              {lines.map((line, index) => (
                <div key={`opening-sto-line-${index}`} className="grid gap-3 border border-slate-200 bg-slate-50 p-3">
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
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="UOM Code" required>
                      <input
                        value={line.uom_code}
                        onChange={(event) => updateLine(index, { uom_code: event.target.value.toUpperCase() })}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
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
                </div>
              ))}
            </div>
          </div>
        )
      }
      bottomContent={
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Opening / legacy STOs stay on the standalone INTER_PLANT path and are auto-confirmed after create so their CSNs are generated immediately.
        </div>
      }
    />
  );
}
