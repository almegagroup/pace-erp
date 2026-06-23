import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { getVendorMaterialInfo, listCostCenters, listMaterials, listVendors } from "../../om/omApi.js";
import {
  createPurchaseOrder,
  listPaymentTerms,
} from "../procurementApi.js";

const DELIVERY_TYPE_OPTIONS = ["STANDARD", "BULK", "TANKER"];
const FREIGHT_TERM_OPTIONS = ["FOR", "FREIGHT_SEPARATE"];

function createEmptyLine() {
  return {
    material_id: "",
    quantity: "",
    uom_code: "",
    uomOptions: [],
    rate: "",
    cost_center_id: "",
    delivery_date: "",
    indent_reference: "",
    aslWarning: "",
    aslChecked: false,
  };
}

export default function POCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [vendors, setVendors] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [form, setForm] = useState({
    company_id: "",
    vendor_id: "",
    delivery_type: "STANDARD",
    incoterm: "",
    payment_term_id: "",
    freight_term: "FOR",
    remarks: "",
  });
  const [lines, setLines] = useState([createEmptyLine()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const companyOptions = useMemo(
    () => (runtimeContext?.availableCompanies ?? []).map((entry) => ({ value: entry.id, label: entry.company_name || entry.company_code || entry.id })),
    [runtimeContext?.availableCompanies]
  );
  const vendorOptions = useMemo(
    () =>
      vendors.map((entry) => ({
        value: entry.id,
        label: `${entry.vendor_code || ""} ${entry.vendor_name || ""}`.trim(),
      })),
    [vendors]
  );
  const materialOptions = useMemo(
    () =>
      materials.map((entry) => ({
        value: entry.id,
        label: `${entry.pace_code || ""} ${entry.material_name || ""}`.trim(),
      })),
    [materials]
  );
  const costCenterOptions = useMemo(
    () => costCenters.map((entry) => ({ value: entry.id, label: `${entry.cost_center_code || entry.id} | ${entry.cost_center_name || entry.name || ""}` })),
    [costCenters]
  );

  const selectedVendor = useMemo(
    () => vendors.find((entry) => entry.id === form.vendor_id) ?? null,
    [form.vendor_id, vendors]
  );
  const showIncoterm = useMemo(
    () => String(selectedVendor?.vendor_type || "").toUpperCase() === "IMPORT",
    [selectedVendor]
  );
  const indentRequired = selectedVendor?.indent_number_required === true;

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [vendorData, paymentData, materialData, costCenterData] = await Promise.all([
          listVendors({ limit: 200, offset: 0, status: "ACTIVE" }),
          listPaymentTerms({ is_active: true }),
          listMaterials({ limit: 400, offset: 0 }),
          listCostCenters(),
        ]);
        if (!active) {
          return;
        }
        const vendorRows = Array.isArray(vendorData?.data) ? vendorData.data : [];
        const termRows = Array.isArray(paymentData) ? paymentData : (paymentData?.data ?? []);
        const materialRows = Array.isArray(materialData?.data) ? materialData.data : [];
        const costCenterRows = Array.isArray(costCenterData?.data) ? costCenterData.data : [];
        setVendors(vendorRows);
        setPaymentTerms(termRows);
        // RM/PM materials only — Sales Order/PO restricts to these two types.
        setMaterials(materialRows.filter((entry) => ["RM", "PM"].includes(String(entry.material_type || "").toUpperCase())));
        setCostCenters(costCenterRows);
        setForm((current) => ({
          ...current,
          company_id: current.company_id || runtimeContext?.selectedCompanyId || companyOptions[0]?.value || "",
          payment_term_id: current.payment_term_id || termRows[0]?.id || "",
        }));
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_PO_SETUP_FAILED");
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
  }, [companyOptions, runtimeContext?.selectedCompanyId]);

  function updateHeaderField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLine(index, patch) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, createEmptyLine()]);
  }

  function removeLine(index) {
    setLines((current) => (current.length === 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));
  }

  // Vendor can change after lines already have a material selected — re-run
  // the ASL/VMI check for every line so the hard-block + UOM/Rate auto-fill
  // stay correct for the newly selected vendor.
  useEffect(() => {
    lines.forEach((line, index) => {
      if (line.material_id) {
        void checkApprovedAsl(index);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vendor_id]);

  async function checkApprovedAsl(index) {
    const line = lines[index];
    if (!form.vendor_id || !line?.material_id) {
      return;
    }
    try {
      // Exact vendor+material pair lookup (per 85.2.4 hard-block rule) —
      // NOT the search-only list endpoint, which ignores vendor_id/material_id.
      const vmi = (await getVendorMaterialInfo({ vendor_id: form.vendor_id, material_id: line.material_id }))?.data;
      const isActive = String(vmi?.status || "").toUpperCase() === "ACTIVE";
      if (!isActive) {
        updateLine(index, {
          aslChecked: true,
          aslWarning: "Vendor-material info record exists but is not ACTIVE — this is a hard block, line cannot be saved.",
        });
        return;
      }
      const uomOptions = Array.isArray(vmi?.uoms) ? vmi.uoms.map((entry) => entry.uom_code) : [];
      const defaultUom = vmi?.default_uom_code || uomOptions[0] || vmi?.base_uom_code || "";
      updateLine(index, {
        aslChecked: true,
        aslWarning: "",
        uomOptions,
        uom_code: line.uom_code || defaultUom,
        rate: line.rate || (vmi?.last_purchase_price != null ? String(vmi.last_purchase_price) : ""),
      });
    } catch (lookupError) {
      const code = lookupError instanceof Error ? lookupError.message : "";
      if (code === "OM_VMI_NOT_FOUND") {
        updateLine(index, {
          aslChecked: true,
          aslWarning: "No approved VMI record exists for this vendor-material pair — this is a hard block, line cannot be saved.",
          uomOptions: [],
        });
      } else {
        updateLine(index, {
          aslChecked: false,
          aslWarning: "Unable to verify approved VMI right now.",
        });
      }
    }
  }

  async function handleSubmit() {
    if (!form.company_id || !form.vendor_id || !form.payment_term_id || !form.freight_term) {
      setError("Company, vendor, payment term, and freight term are required.");
      return;
    }
    if (showIncoterm && !form.incoterm.trim()) {
      setError("Incoterm is required for import purchase orders.");
      return;
    }
    if (lines.some((line) => !line.material_id || !line.quantity || !line.rate || !line.cost_center_id)) {
      setError("Each PO line requires material, quantity, rate, and cost center.");
      return;
    }
    if (lines.some((line) => line.aslWarning)) {
      setError("One or more lines have no approved VMI record for this vendor — this is a hard block per design. Fix or remove those lines before saving.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        company_id: form.company_id,
        vendor_id: form.vendor_id,
        vendor_type: String(selectedVendor?.vendor_type || "DOMESTIC").toUpperCase(),
        delivery_type: form.delivery_type,
        incoterm: showIncoterm ? form.incoterm.trim() : null,
        payment_term_id: form.payment_term_id,
        freight_term: form.freight_term,
        remarks: form.remarks.trim() || null,
        // Per feasibility doc 87.12A: each material becomes its own PO, all
        // grouped under one internal Order ID — never one multi-line PO.
        materials: lines.map((line) => ({
          material_id: line.material_id,
          ordered_qty: Number(line.quantity),
          po_uom_code: line.uom_code || null,
          unit_rate: Number(line.rate),
          cost_center_id: line.cost_center_id,
          delivery_date: line.delivery_date || null,
          indent_reference: indentRequired ? line.indent_reference || null : null,
        })),
      };
      const created = await createPurchaseOrder(payload);
      const groupId = created?.order_group?.id;
      const poCount = Array.isArray(created?.purchase_orders) ? created.purchase_orders.length : 1;
      setNotice(`${poCount} purchase order${poCount === 1 ? "" : "s"} created.`);
      if (groupId) {
        navigate(`/dashboard/procurement/po-order-groups/${encodeURIComponent(groupId)}`);
      } else {
        navigate(`/dashboard/procurement/purchase-orders/${encodeURIComponent(created?.id)}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_PO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const netTotal = lines.reduce((sum, line) => sum + (Number(line.quantity || 0) || 0) * (Number(line.rate || 0) || 0), 0);

  const lineColumns = [
    {
      key: "material_id",
      label: "Material",
      width: "260px",
      render: (_row, index) => (
        <ErpComboboxField
          value={lines[index].material_id}
          onChange={(value) => updateLine(index, { material_id: value, aslWarning: "", aslChecked: false })}
          options={materialOptions}
          blankLabel="Select material"
          inputProps={{ onBlur: () => void checkApprovedAsl(index) }}
        />
      ),
    },
    {
      key: "quantity",
      label: "Qty",
      width: "100px",
      render: (_row, index) => (
        <input
          type="number" min="0" step="0.0001"
          value={lines[index].quantity}
          onChange={(event) => updateLine(index, { quantity: event.target.value })}
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
        />
      ),
    },
    {
      key: "uom_code",
      label: "UOM",
      width: "100px",
      render: (_row, index) => {
        const options = lines[index].uomOptions || [];
        if (options.length === 0) {
          return (
            <input
              value={lines[index].uom_code}
              readOnly
              placeholder="Select material first"
              className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-xs text-slate-500 outline-none"
            />
          );
        }
        return (
          <select
            value={lines[index].uom_code}
            onChange={(event) => updateLine(index, { uom_code: event.target.value })}
            className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
          >
            {options.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        );
      },
    },
    {
      key: "rate",
      label: "Rate",
      width: "100px",
      render: (_row, index) => (
        <input
          type="number" min="0" step="0.0001"
          value={lines[index].rate}
          onChange={(event) => updateLine(index, { rate: event.target.value })}
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
        />
      ),
    },
    {
      key: "cost_center_id",
      label: "Cost Center",
      width: "200px",
      render: (_row, index) => (
        <ErpComboboxField
          value={lines[index].cost_center_id}
          onChange={(value) => updateLine(index, { cost_center_id: value })}
          options={costCenterOptions}
          blankLabel="Select cost center"
        />
      ),
    },
    {
      key: "delivery_date",
      label: "Delivery Date",
      width: "140px",
      render: (_row, index) => (
        <input
          type="date"
          value={lines[index].delivery_date}
          onChange={(event) => updateLine(index, { delivery_date: event.target.value })}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
        />
      ),
    },
    ...(indentRequired
      ? [{
          key: "indent_reference",
          label: "Indent Ref.",
          width: "140px",
          render: (_row, index) => (
            <input
              value={lines[index].indent_reference}
              onChange={(event) => updateLine(index, { indent_reference: event.target.value })}
              className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
            />
          ),
        }]
      : []),
    {
      key: "net_value",
      label: "Net Value",
      width: "110px",
      align: "right",
      render: (_row, index) => ((Number(lines[index].quantity || 0) || 0) * (Number(lines[index].rate || 0) || 0)).toFixed(2),
    },
    {
      key: "actions",
      label: "",
      width: "80px",
      render: (_row, index) => (
        <button
          type="button"
          onClick={() => removeLine(index)}
          disabled={lines.length === 1}
          className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Remove
        </button>
      ),
    },
  ];

  const lineRowsWithWarnings = lines.map((line, index) => ({ ...line, __index: index }));

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Create Purchase Order"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : lines.length > 1 ? `Create ${lines.length} POs` : "Create PO", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || loading },
      ]}
      notices={[
        ...(error ? [{ key: "po-create-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "po-create-notice", tone: "success", message: notice }] : []),
      ]}
    >
      {loading ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Loading procurement master data...
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="PO Header" title="Vendor, terms and basic details">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Company <span className="text-rose-500">*</span>
                <select
                  value={form.company_id}
                  onChange={(event) => updateHeaderField("company_id", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select company</option>
                  {companyOptions.map((entry) => (
                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Vendor <span className="text-rose-500">*</span>
                <ErpComboboxField
                  value={form.vendor_id}
                  onChange={(value) => updateHeaderField("vendor_id", value)}
                  options={vendorOptions}
                  blankLabel="Select vendor"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Delivery Type <span className="text-rose-500">*</span>
                <select
                  value={form.delivery_type}
                  onChange={(event) => updateHeaderField("delivery_type", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  {DELIVERY_TYPE_OPTIONS.map((entry) => (
                    <option key={entry} value={entry}>{entry}</option>
                  ))}
                </select>
              </label>
              {showIncoterm ? (
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Incoterm <span className="text-rose-500">*</span>
                  <input
                    value={form.incoterm}
                    onChange={(event) => updateHeaderField("incoterm", event.target.value.toUpperCase())}
                    placeholder="FOB / CIF / CFR / EXW / DAP / DDP"
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
              ) : null}
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Payment Term <span className="text-rose-500">*</span>
                <select
                  value={form.payment_term_id}
                  onChange={(event) => updateHeaderField("payment_term_id", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select payment term</option>
                  {paymentTerms.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.code || entry.name} | {entry.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Freight Term <span className="text-rose-500">*</span>
                <select
                  value={form.freight_term}
                  onChange={(event) => updateHeaderField("freight_term", event.target.value)}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  {FREIGHT_TERM_OPTIONS.map((entry) => (
                    <option key={entry} value={entry}>{entry}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2 xl:col-span-2">
                Remarks
                <textarea
                  rows={1}
                  value={form.remarks}
                  onChange={(event) => updateHeaderField("remarks", event.target.value)}
                  className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </label>
            </div>
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Materials"
            title="Order details — one PO per material"
            actions={[{ key: "add-line", label: "+ Add Material", tone: "primary", onClick: addLine }]}
          >
            <p className="mb-2 text-[11px] text-slate-500">
              RM/PM only — an Approved (active) Vendor-Material Info record is required per line (hard block).
            </p>
            <ErpDenseGrid
              columns={lineColumns}
              rows={lineRowsWithWarnings}
              rowKey={(row) => row.__index}
              maxHeight="420px"
              emptyMessage="No materials yet — click Add Material."
              summaryRow={{ label: "Total", values: { net_value: netTotal.toFixed(2) } }}
            />
            {lines.length > 1 && (
              <p className="mt-2 text-xs text-slate-500">
                These {lines.length} materials will be raised as {lines.length} separate Purchase
                Orders, grouped under one internal Order for approval — the vendor only ever sees
                individual PO numbers.
              </p>
            )}
            {lines.some((line) => line.aslWarning) && (
              <div className="mt-2 grid gap-1">
                {lines.map((line, index) =>
                  line.aslWarning ? (
                    <p key={index} className="text-xs font-semibold text-rose-700">Line {index + 1}: {line.aslWarning}</p>
                  ) : null
                )}
              </div>
            )}
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
