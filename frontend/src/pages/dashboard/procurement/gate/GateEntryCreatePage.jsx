import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listMaterials, listVendors } from "../../om/omApi.js";
import { listPurchaseOrders } from "../procurementApi.js";
import { createGateEntry, listOpenCSNsForGE } from "../procurementApi.js";

function createEmptyLine() {
  return {
    csn_id: "",
    po_line_id: "",
    po_number: "",
    material_id: "",
    material_name: "",
    vendor_name: "",
    expected_qty: "",
    uom_code: "",
    invoice_number: "",
    invoice_date: "",
    received_qty: "",
    gross_weight: "",
    weighbridge_required: false,
    delivery_type: "",
  };
}

export default function GateEntryCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [form, setForm] = useState({
    company_id: "",
    entry_date: new Date().toISOString().slice(0, 10),
    vehicle_number: "",
    driver_name: "",
    gate_staff_id: "",
    remarks: "",
  });
  const [lines, setLines] = useState([createEmptyLine()]);
  const [openCsns, setOpenCsns] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const companyOptions = useMemo(
    () =>
      (runtimeContext?.availableCompanies ?? []).map((entry) => ({
        value: entry.id,
        label: entry.company_name || entry.company_code || entry.id,
      })),
    [runtimeContext?.availableCompanies]
  );
  const csnOptions = useMemo(
    () =>
      openCsns.map((entry) => ({
        value: entry.id,
        label: `${entry.csn_number || entry.id} | ${entry.status || "OPEN"}`,
      })),
    [openCsns]
  );
  const materialMap = useMemo(() => new Map(materials.map((entry) => [entry.id, entry])), [materials]);
  const vendorMap = useMemo(() => new Map(vendors.map((entry) => [entry.id, entry])), [vendors]);
  const poMap = useMemo(() => new Map(purchaseOrders.map((entry) => [entry.id, entry])), [purchaseOrders]);
  const anyWeighbridgeRequired = useMemo(() => lines.some((line) => line.weighbridge_required), [lines]);

  useEffect(() => {
    if (!form.company_id) {
      setForm((current) => ({
        ...current,
        company_id: current.company_id || runtimeContext?.selectedCompanyId || companyOptions[0]?.value || "",
      }));
    }
  }, [companyOptions, form.company_id, runtimeContext?.selectedCompanyId]);

  useEffect(() => {
    let active = true;
    async function loadMasters() {
      if (!form.company_id) return;
      setLoading(true);
      setError("");
      try {
        const [csnData, materialData, vendorData, poData] = await Promise.all([
          listOpenCSNsForGE({ company_id: form.company_id }),
          listMaterials({ limit: 200, offset: 0 }),
          listVendors({ limit: 200, offset: 0 }),
          listPurchaseOrders({ limit: 200, offset: 0 }),
        ]);
        if (!active) return;
        setOpenCsns(Array.isArray(csnData?.items) ? csnData.items : []);
        setMaterials(Array.isArray(materialData?.data) ? materialData.data : []);
        setVendors(Array.isArray(vendorData?.data) ? vendorData.data : []);
        setPurchaseOrders(Array.isArray(poData?.data) ? poData.data : []);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "GE_CREATE_SETUP_FAILED");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadMasters();
    return () => {
      active = false;
    };
  }, [form.company_id]);

  function updateLine(index, patch) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function applyCsnSelection(index, csnId) {
    const selectedCsn = openCsns.find((entry) => entry.id === csnId);
    const material = selectedCsn ? materialMap.get(selectedCsn.material_id) : null;
    const vendor = selectedCsn ? vendorMap.get(selectedCsn.vendor_id) : null;
    const po = selectedCsn ? poMap.get(selectedCsn.po_id) : null;
    updateLine(index, {
      csn_id: csnId,
      po_line_id: selectedCsn?.po_line_id || "",
      po_number: po?.po_number || "",
      material_id: selectedCsn?.material_id || "",
      material_name: material?.material_name || "",
      vendor_name: vendor?.vendor_name || "",
      expected_qty: selectedCsn?.dispatch_qty ?? selectedCsn?.po_qty ?? "",
      uom_code: selectedCsn?.po_uom_code || material?.base_uom_code || "",
      weighbridge_required: material?.weighbridge_required === true,
      delivery_type: po?.delivery_type || "",
      gross_weight: "",
    });
  }

  function addLine() {
    setLines((current) => [...current, createEmptyLine()]);
  }

  function removeLine(index) {
    setLines((current) => (current.length === 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));
  }

  async function handleSubmit() {
    if (!form.company_id || !form.entry_date || !form.vehicle_number.trim() || !form.gate_staff_id.trim()) {
      setError("Company, entry date, vehicle number, and gate staff are required.");
      return;
    }
    if (lines.some((line) => !line.csn_id || !line.received_qty)) {
      setError("Each gate entry line requires a CSN and received quantity.");
      return;
    }
    if (anyWeighbridgeRequired && lines.some((line) => line.weighbridge_required && !line.gross_weight)) {
      setError("Gross weight is mandatory for weighbridge-managed materials.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createGateEntry({
        company_id: form.company_id,
        entry_date: form.entry_date,
        vehicle_number: form.vehicle_number.trim(),
        driver_name: form.driver_name.trim() || null,
        gate_staff_id: form.gate_staff_id.trim(),
        remarks: form.remarks.trim() || null,
        lines: lines.map((line) => ({
          csn_id: line.csn_id,
          po_line_id: line.po_line_id || null,
          material_id: line.material_id,
          ge_qty: Number(line.received_qty),
          uom_code: line.uom_code,
          challan_or_invoice_no: line.invoice_number || null,
          rst_number: line.invoice_date || null,
          gross_weight: line.gross_weight ? Number(line.gross_weight) : null,
        })),
      });
      setNotice("Gate entry created.");
      openScreen(OPERATION_SCREENS.PROC_GATE_ENTRY_DETAIL.screen_code);
      navigate(`/dashboard/procurement/gate-entries/${encodeURIComponent(created.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "GE_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="Procurement"
      title="Create Gate Entry"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Create GE", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || loading },
      ]}
      notices={[
        ...(error ? [{ key: "ge-create-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "ge-create-notice", tone: "success", message: notice }] : []),
        {
          key: "ge-backdate-note",
          tone: "info",
          message: "Entry date allows backdating. System audit timestamp is still captured automatically.",
        },
        ...(anyWeighbridgeRequired
          ? [{ key: "ge-weighbridge-note", tone: "warning", message: "At least one selected material requires weighbridge gross weight." }]
          : []),
      ]}
      formEyebrow="Gate Header"
      formTitle="Capture inbound vehicle arrival"
      formContent={
        loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading open CSNs and master data...
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <ErpDenseFormRow label="Company" required>
                <select value={form.company_id} onChange={(event) => setForm((current) => ({ ...current, company_id: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500">
                  <option value="">Select company</option>
                  {companyOptions.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Entry Date" required>
                <input type="date" value={form.entry_date} onChange={(event) => setForm((current) => ({ ...current, entry_date: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Vehicle Number" required>
                <input value={form.vehicle_number} onChange={(event) => setForm((current) => ({ ...current, vehicle_number: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Driver Name">
                <input value={form.driver_name} onChange={(event) => setForm((current) => ({ ...current, driver_name: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Gate Staff" required>
                <input value={form.gate_staff_id} onChange={(event) => setForm((current) => ({ ...current, gate_staff_id: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Remarks">
                <input value={form.remarks} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
              </ErpDenseFormRow>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">GE Lines</h3>
                <button type="button" onClick={addLine} className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900">
                  Add Line
                </button>
              </div>
              {lines.map((line, index) => (
                <div key={`${index}-${line.csn_id || "new"}`} className="grid gap-3 border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Line {index + 1}</div>
                    {lines.length > 1 ? (
                      <button type="button" onClick={() => removeLine(index)} className="border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-900">
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    <ErpDenseFormRow label="CSN" required>
                      <ErpComboboxField value={line.csn_id} onChange={(value) => applyCsnSelection(index, value)} options={csnOptions} blankLabel="Select open CSN" />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="PO Number">
                      <input value={line.po_number} readOnly className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-sm text-slate-700 outline-none" />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Material">
                      <input value={line.material_name} readOnly className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-sm text-slate-700 outline-none" />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Vendor">
                      <input value={line.vendor_name} readOnly className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-sm text-slate-700 outline-none" />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Expected Qty">
                      <input value={line.expected_qty} readOnly className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-sm text-slate-700 outline-none" />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Received Qty" required>
                      <input type="number" min="0" step="0.0001" value={line.received_qty} onChange={(event) => updateLine(index, { received_qty: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Invoice Number">
                      <input value={line.invoice_number} onChange={(event) => updateLine(index, { invoice_number: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Invoice Date">
                      <input type="date" value={line.invoice_date} onChange={(event) => updateLine(index, { invoice_date: event.target.value })} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500" />
                    </ErpDenseFormRow>
                    {line.weighbridge_required || line.delivery_type === "BULK" || line.delivery_type === "TANKER" ? (
                      <ErpDenseFormRow label="Gross Weight" required>
                        <input type="number" min="0" step="0.0001" value={line.gross_weight} onChange={(event) => updateLine(index, { gross_weight: event.target.value })} className="h-8 w-full border border-amber-300 bg-amber-50 px-2 text-sm text-slate-900 outline-none focus:border-amber-500" />
                      </ErpDenseFormRow>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }
    />
  );
}
