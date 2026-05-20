import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listMaterials, listVendors } from "../../om/omApi.js";
import { addRTVLine, createRTV, getGRN, listGRNs } from "../procurementApi.js";

const REASON_OPTIONS = [
  "SHORT_RECEIVED",
  "QUALITY_REJECTION",
  "WRONG_MATERIAL",
  "DAMAGED",
  "EXCESS",
  "OTHER",
];
const SETTLEMENT_OPTIONS = ["DEBIT_NOTE", "NEXT_INVOICE_ADJUST", "EXCHANGE"];

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

export default function RTVCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [step, setStep] = useState(1);
  const [grnRows, setGrnRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [selectedGrn, setSelectedGrn] = useState(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    reason_category: "QUALITY_REJECTION",
    settlement_mode: "DEBIT_NOTE",
    remarks: "",
  });
  const [lineItems, setLineItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const companyId = runtimeContext?.selectedCompanyId || "";

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [grnData, vendorData, materialData] = await Promise.all([
          listGRNs({
            company_id: companyId || undefined,
            status: "POSTED",
            limit: 200,
          }),
          listVendors({ limit: 200, offset: 0 }),
          listMaterials({ limit: 200, offset: 0 }),
        ]);
        if (!active) {
          return;
        }
        setGrnRows(Array.isArray(grnData?.items) ? grnData.items : []);
        setVendors(Array.isArray(vendorData?.data) ? vendorData.data : []);
        setMaterials(Array.isArray(materialData?.data) ? materialData.data : []);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_RTV_SETUP_FAILED");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [companyId]);

  const vendorMap = useMemo(
    () => new Map(vendors.map((entry) => [entry.id, entry])),
    [vendors]
  );
  const materialMap = useMemo(
    () => new Map(materials.map((entry) => [entry.id, entry])),
    [materials]
  );
  const filteredGrns = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) {
      return grnRows;
    }
    return grnRows.filter((row) => {
      const vendor = vendorMap.get(row.vendor_id);
      const haystack = [
        row.grn_number,
        vendor?.vendor_name,
        vendor?.vendor_code,
        row.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [grnRows, search, vendorMap]);

  async function handleSelectGrn(grnRow) {
    setLoading(true);
    setError("");
    try {
      const detail = await getGRN(grnRow.id);
      setSelectedGrn(detail);
      setLineItems(
        Array.isArray(detail?.lines)
          ? detail.lines.map((line) => ({
              grn_line_id: line.id,
              material_id: line.material_id,
              storage_location_id: line.storage_location_id || "",
              blocked_qty: Number(line.blocked_qty ?? line.received_qty ?? 0),
              return_qty: "",
              uom_code: line.uom_code || "",
              po_rate: line.grn_rate ?? "",
            }))
          : []
      );
      setStep(2);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_RTV_GRN_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  function updateLine(index, patch) {
    setLineItems((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line))
    );
  }

  async function handleSubmit() {
    if (!selectedGrn?.id) {
      setError("Select a GRN first.");
      return;
    }
    const validLines = lineItems.filter((line) => Number(line.return_qty) > 0);
    if (validLines.length === 0) {
      setError("Enter at least one return quantity.");
      return;
    }
    if (validLines.some((line) => Number(line.return_qty) > Number(line.blocked_qty || 0))) {
      setError("Return quantity cannot exceed available blocked stock.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const created = await createRTV({
        company_id: companyId,
        vendor_id: selectedGrn.vendor_id,
        grn_id: selectedGrn.id,
        po_id: selectedGrn.po_id || null,
        reason_category: form.reason_category,
        settlement_mode: form.settlement_mode,
        remarks: form.remarks.trim() || null,
      });
      for (const line of validLines) {
        await addRTVLine(created.id, {
          grn_line_id: line.grn_line_id,
          storage_location_id: line.storage_location_id,
          return_qty: Number(line.return_qty),
        });
      }
      openScreen(OPERATION_SCREENS.PROC_RTV_DETAIL.screen_code);
      navigate(`/dashboard/procurement/rtvs/${encodeURIComponent(created.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_RTV_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="Procurement"
      title="Create Return To Vendor"
      actions={[
        {
          key: "back",
          label: step === 2 ? "Back To GRN Selection" : "Back",
          tone: "neutral",
          onClick: () => {
            if (step === 2) {
              setStep(1);
              return;
            }
            popScreen();
          },
        },
        ...(step === 2
          ? [
              {
                key: "save",
                label: saving ? "Saving..." : "Create RTV",
                tone: "primary",
                onClick: () => void handleSubmit(),
                disabled: saving || loading,
              },
            ]
          : []),
      ]}
      notices={error ? [{ key: "rtv-create-error", tone: "error", message: error }] : []}
      formEyebrow={`Step ${step} Of 2`}
      formTitle={step === 1 ? "Select a GRN to return against" : "Configure RTV header and lines"}
      formContent={
        loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading RTV setup...
          </div>
        ) : step === 1 ? (
          <div className="grid gap-3">
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Search GRN
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                placeholder="Search GRN number or vendor"
              />
            </label>
            <ErpDenseGrid
              columns={[
                { key: "grn_number", label: "GRN Number", width: "140px" },
                {
                  key: "vendor",
                  label: "Vendor",
                  render: (row) =>
                    vendorMap.get(row.vendor_id)?.vendor_name ||
                    vendorMap.get(row.vendor_id)?.vendor_code ||
                    row.vendor_id ||
                    "—",
                },
                {
                  key: "material",
                  label: "Material",
                  render: (row) => {
                    const firstLine = Array.isArray(row.lines) ? row.lines[0] : null;
                    return firstLine
                      ? materialMap.get(firstLine.material_id)?.material_name ||
                          materialMap.get(firstLine.material_id)?.material_code ||
                          firstLine.material_id ||
                          "—"
                      : "Open detail after select";
                  },
                },
                { key: "received_qty", label: "Received Qty", width: "110px", render: (row) => row.total_received_qty || "—" },
                { key: "grn_date", label: "Date", width: "110px" },
                {
                  key: "actions",
                  label: "Actions",
                  width: "110px",
                  render: (row) => (
                    <button
                      type="button"
                      onClick={() => void handleSelectGrn(row)}
                      className="border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900"
                    >
                      Select
                    </button>
                  ),
                },
              ]}
              rows={filteredGrns}
              rowKey={(row) => row.id}
              emptyMessage="No posted GRN matched the current search."
            />
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900">
              Selected GRN: <span className="font-semibold">{selectedGrn?.grn_number || selectedGrn?.id}</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <ErpDenseFormRow label="Reason Category" required>
                <select
                  value={form.reason_category}
                  onChange={(event) => setForm((current) => ({ ...current, reason_category: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  {REASON_OPTIONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Settlement Mode" required>
                <select
                  value={form.settlement_mode}
                  onChange={(event) => setForm((current) => ({ ...current, settlement_mode: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  {SETTLEMENT_OPTIONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Remarks">
                <textarea
                  rows={3}
                  value={form.remarks}
                  onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))}
                  className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
            </div>

            <div className="grid gap-3">
              <div className="text-sm font-semibold text-slate-900">RTV Lines</div>
              {lineItems.map((line, index) => (
                <div key={line.grn_line_id} className="grid gap-3 border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Line {index + 1} | {materialMap.get(line.material_id)?.material_name || materialMap.get(line.material_id)?.material_code || line.material_id}
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                    <ErpDenseFormRow label="Storage Location">
                      <input
                        value={line.storage_location_id}
                        onChange={(event) => updateLine(index, { storage_location_id: event.target.value })}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Return Qty">
                      <input
                        type="number"
                        min="0"
                        max={line.blocked_qty}
                        step="0.0001"
                        value={line.return_qty}
                        onChange={(event) => updateLine(index, { return_qty: event.target.value })}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="UOM">
                      <input
                        value={line.uom_code}
                        readOnly
                        className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-sm text-slate-700 outline-none"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="PO Rate">
                      <input
                        value={line.po_rate}
                        readOnly
                        className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-sm text-slate-700 outline-none"
                      />
                    </ErpDenseFormRow>
                  </div>
                  <div className="text-xs font-medium text-amber-700">
                    Available blocked: {line.blocked_qty}
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
