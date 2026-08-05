import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpCompanySelector from "../../../../components/inputs/ErpCompanySelector.jsx";
import { buildTransactionCompanyList, resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useCostCentersQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { usePaymentTermOptionsQuery, usePortOptionsQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreenWithContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { getVendorMaterialInfo } from "../../om/omApi.js";
import {
  createPurchaseOrder,
  getPoFilterOptions,
} from "../procurementApi.js";

const DELIVERY_TYPE_OPTIONS = ["STANDARD", "BULK", "TANKER"];
const FREIGHT_TERM_OPTIONS = [
  { value: "FOR", label: "FOR" },
  { value: "FREIGHT_SEPARATE", label: "Freight Separate" },
  { value: "FREIGHT_AT_ACTUALS", label: "Freight at Actuals" },
];
const GST_TERM_OPTIONS = [
  { value: "INCLUSIVE", label: "GST Inclusive" },
  { value: "EXCLUSIVE", label: "GST Exclusive" },
];
const CURRENCY_OPTIONS = ["INR", "USD"];
const REBATE_BASIS_OPTIONS = [
  { value: "BASE_UOM", label: "Base UOM" },
  { value: "PO_UOM", label: "PO UOM" },
];
const SHIPMENT_MODE_OPTIONS = [
  { value: "FCL", label: "Sea — FCL (Full Container Load)" },
  { value: "LCL", label: "Sea — LCL (Less than Container Load)" },
  { value: "AIR", label: "Air Freight" },
  { value: "COURIER", label: "Courier / Express" },
];
const IMPORT_TRADE_TYPE_OPTIONS = [
  { value: "DIRECT_IMPORT", label: "Direct Import" },
  { value: "HIGH_SEA_SALE", label: "High Sea Sale (HSS)" },
];
const CUSTOMS_MOVEMENT_TYPE_OPTIONS = [
  { value: "DPD", label: "DPD — Direct Port Delivery" },
  { value: "CFS", label: "CFS — Container Freight Station" },
  { value: "ICD", label: "ICD — Inland Container Depot" },
];

function createEmptyLine(defaultPaymentTermId = "") {
  return {
    material_id: "",
    quantity: "",
    uom_code: "",
    uomOptions: [],
    rate: "",
    currency_code: "INR",
    delivery_date: "",
    payment_term_id: defaultPaymentTermId,
    freight_term: "FOR",
    gst_terms: "",
    remarks: "",
    has_rebate: false,
    rebate_rate: "",
    rebate_rate_uom_basis: "BASE_UOM",
    rebate_remarks: "",
    aslWarning: "",
    aslChecked: false,
  };
}

function LineMoreDrawer({ line, visible, onClose, onChange }) {
  if (!line) {
    return null;
  }

  return (
    <DrawerBase
      visible={visible}
      title="Material Line Details"
      onEscape={onClose}
      onClose={onClose}
      width="min(480px, calc(100vw - 24px))"
      actions={
        <button
          type="button"
          onClick={onClose}
          className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950"
        >
          Done
        </button>
      }
    >
      <div className="grid gap-4">
        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          GST Terms
          <select
            value={line.gst_terms}
            onChange={(event) => onChange({ gst_terms: event.target.value })}
            className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
          >
            <option value="">Select GST terms</option>
            {GST_TERM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          Remarks
          <textarea
            rows={4}
            value={line.remarks}
            onChange={(event) => onChange({ remarks: event.target.value })}
            className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
          />
        </label>

        <div className="grid gap-1 text-xs font-semibold text-slate-700">
          <span>Has Rebate</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                onChange({
                  has_rebate: true,
                  rebate_rate_uom_basis: line.rebate_rate_uom_basis || "BASE_UOM",
                })
              }
              className={`px-3 py-2 text-xs font-semibold ${
                line.has_rebate
                  ? "border border-emerald-700 bg-emerald-100 text-emerald-900"
                  : "border border-slate-300 bg-white text-slate-700"
              }`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() =>
                onChange({
                  has_rebate: false,
                  rebate_rate: "",
                  rebate_rate_uom_basis: "BASE_UOM",
                  rebate_remarks: "",
                })
              }
              className={`px-3 py-2 text-xs font-semibold ${
                !line.has_rebate
                  ? "border border-slate-700 bg-slate-200 text-slate-950"
                  : "border border-slate-300 bg-white text-slate-700"
              }`}
            >
              No
            </button>
          </div>
        </div>

        {line.has_rebate ? (
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Rebate Rate
              <input
                type="number"
                min="0"
                step="0.0001"
                value={line.rebate_rate}
                onChange={(event) => onChange({ rebate_rate: event.target.value })}
                className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Basis
              <select
                value={line.rebate_rate_uom_basis}
                onChange={(event) => onChange({ rebate_rate_uom_basis: event.target.value })}
                className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                {REBATE_BASIS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Rebate Remarks
              <textarea
                rows={4}
                value={line.rebate_remarks}
                onChange={(event) => onChange({ rebate_remarks: event.target.value })}
                className="w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
          </div>
        ) : null}
      </div>
    </DrawerBase>
  );
}

export default function POCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const runtimeCompanyList = buildTransactionCompanyList(runtimeContext);
  const runtimeDefaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const companyReadOnly = String(runtimeContext?.workspaceMode ?? "").toUpperCase() !== "MULTI" || runtimeCompanyList.length <= 1;
  // Company/Vendor/Material cross-filter each other no matter which one is
  // picked first — picking just a Material narrows Company+Vendor to ones
  // with an approved link to it, picking Company+Vendor narrows Material, etc.
  // Once a vendor is picked, a later Material change can narrow the vendor
  // list without invalidating the already-selected vendor.
  const vendorDetailCacheRef = useRef(new Map());
  const [form, setForm] = useState({
    // Seed from the already-known runtime company instead of waiting on the
    // filter-options round trip to resolve a default — lets Cost Center
    // start loading in parallel with everything else on first mount.
    company_id: runtimeDefaultCompanyId,
    vendor_id: "",
    delivery_type: "STANDARD",
    incoterm: "",
    destination_port_id: "",
    shipment_mode: "",
    import_trade_type: "",
    customs_movement_type: "",
    cost_center_id: "",
    extra_fields: [],
  });
  const [lines, setLines] = useState([createEmptyLine()]);
  const [lineMoreIndex, setLineMoreIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const availableCompanyIds = useMemo(
    () => new Set((runtimeContext?.availableCompanies ?? []).map((entry) => entry.id)),
    [runtimeContext?.availableCompanies]
  );
  const primaryMaterialId = lines[0]?.material_id || "";
  const paymentTermQuery = usePaymentTermOptionsQuery({ is_active: true });
  const filterOptionsQuery = useQuery({
    queryKey: ["procurement", "po-filter-options", {
      company_id: form.company_id || undefined,
      vendor_id: form.vendor_id || undefined,
      material_id: primaryMaterialId || undefined,
    }],
    queryFn: () =>
      getPoFilterOptions({
        company_id: form.company_id || undefined,
        vendor_id: form.vendor_id || undefined,
        material_id: primaryMaterialId || undefined,
      }),
    // Cross-filtering (company/vendor/material) changes the queryKey on every
    // selection. Without this, each selection would blank the whole form back
    // to the "Loading procurement master data..." placeholder instead of just
    // refreshing the dropdown options in place.
    placeholderData: keepPreviousData,
  });
  const costCenterQuery = useCostCentersQuery(
    { company_id: form.company_id, active: true },
    { enabled: Boolean(form.company_id) }
  );
  const paymentTerms = paymentTermQuery.paymentTerms;
  const costCenters = useMemo(
    () => (Array.isArray(costCenterQuery.data?.data) ? costCenterQuery.data.data : []),
    [costCenterQuery.data?.data]
  );
  const filterOptions = useMemo(
    () => ({
      companies: Array.isArray(filterOptionsQuery.data?.companies) ? filterOptionsQuery.data.companies : [],
      vendors: Array.isArray(filterOptionsQuery.data?.vendors) ? filterOptionsQuery.data.vendors : [],
      materials: Array.isArray(filterOptionsQuery.data?.materials) ? filterOptionsQuery.data.materials : [],
    }),
    [filterOptionsQuery.data]
  );
  const companyOptions = useMemo(
    () =>
      filterOptions.companies
        .filter((entry) => availableCompanyIds.size === 0 || availableCompanyIds.has(entry.id))
        .map((entry) => ({ value: entry.id, label: entry.company_name || entry.company_code || entry.id })),
    [filterOptions.companies, availableCompanyIds]
  );
  const vendorOptions = useMemo(
    () =>
      filterOptions.vendors.map((entry) => ({
        value: entry.id,
        label: `${entry.vendor_code || ""} ${entry.vendor_name || ""}`.trim(),
      })),
    [filterOptions.vendors]
  );
  const materialOptions = useMemo(
    () =>
      filterOptions.materials.map((entry) => ({
        value: entry.id,
        label: `${entry.pace_code || ""} ${entry.material_name || ""}`.trim(),
      })),
    [filterOptions.materials]
  );
  const costCenterOptions = useMemo(
    () =>
      costCenters.map((entry) => ({
        value: entry.id,
        label: `${entry.cost_center_code || entry.id} | ${entry.cost_center_name || entry.name || ""}`,
      })),
    [costCenters]
  );
  const paymentTermOptions = useMemo(
    () =>
      paymentTerms.map((entry) => ({
        value: entry.id,
        label: `${entry.code || entry.name} | ${entry.name}`,
      })),
    [paymentTerms]
  );
  const defaultPaymentTermId = paymentTerms[0]?.id || "";

  const selectedVendor = useMemo(() => vendorDetailCacheRef.current.get(form.vendor_id) ?? null, [form.vendor_id]);
  const showIncoterm = useMemo(
    () => String(selectedVendor?.vendor_type || "").toUpperCase() === "IMPORT",
    [selectedVendor]
  );
  const deliveryDateLabel = showIncoterm ? "ETA to Port" : "ETD";
  const portQuery = usePortOptionsQuery(
    { company_id: form.company_id || undefined, is_active: true },
    { enabled: showIncoterm && Boolean(form.company_id) }
  );
  const portOptions = useMemo(
    () =>
      portQuery.ports.map((entry) => ({
        value: entry.id,
        label: `${entry.port_code || ""} ${entry.port_name || ""}`.trim(),
      })),
    [portQuery.ports]
  );

  useEffect(() => {
    if (!defaultPaymentTermId) {
      return;
    }
    setLines((current) =>
      current.map((line) => (
        line.payment_term_id ? line : { ...line, payment_term_id: defaultPaymentTermId }
      ))
    );
  }, [defaultPaymentTermId]);

  // Cost centers are company-scoped — the same code (e.g. "ADMIN") exists
  // once per company, so this must be filtered by the selected Company.
  useEffect(() => {
    if (!form.cost_center_id) {
      return;
    }
    if (costCenterOptions.some((entry) => entry.value === form.cost_center_id)) {
      return;
    }
    setForm((current) => ({ ...current, cost_center_id: "" }));
  }, [costCenterOptions, form.cost_center_id]);

  useEffect(() => {
    filterOptions.vendors.forEach((row) => vendorDetailCacheRef.current.set(row.id, row));
  }, [filterOptions.vendors]);

  useEffect(() => {
    const nextError =
      paymentTermQuery.error?.message ||
      costCenterQuery.error?.message ||
      filterOptionsQuery.error?.message ||
      "";
    if (nextError) {
      setError(nextError);
    }
  }, [costCenterQuery.error?.message, filterOptionsQuery.error?.message, paymentTermQuery.error?.message]);

  useEffect(() => {
    if (form.company_id || companyOptions.length === 0) {
      return;
    }
    const defaultCompanyId = runtimeDefaultCompanyId && companyOptions.some((entry) => entry.value === runtimeDefaultCompanyId)
      ? runtimeDefaultCompanyId
      : companyOptions[0].value;
    setForm((current) => (current.company_id ? current : { ...current, company_id: defaultCompanyId }));
  }, [companyOptions, form.company_id, runtimeDefaultCompanyId]);

  function updateHeaderField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLine(index, patch) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, createEmptyLine(defaultPaymentTermId)]);
  }

  function removeLine(index) {
    setLines((current) => (current.length === 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));
    setLineMoreIndex((current) => (current === index ? null : current != null && current > index ? current - 1 : current));
  }

  function addExtraField() {
    setForm((current) => ({ ...current, extra_fields: [...current.extra_fields, ""] }));
  }

  function removeExtraField(index) {
    setForm((current) => ({
      ...current,
      extra_fields: current.extra_fields.filter((_entry, entryIndex) => entryIndex !== index),
    }));
  }

  function updateExtraField(index, value) {
    setForm((current) => ({
      ...current,
      extra_fields: current.extra_fields.map((entry, entryIndex) => (entryIndex === index ? value : entry)),
    }));
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

  async function checkApprovedAsl(index, materialIdOverride) {
    const line = lines[index];
    const materialId = materialIdOverride ?? line?.material_id;
    if (!form.vendor_id || !materialId) {
      return;
    }
    try {
      // Exact vendor+material pair lookup (per 85.2.4 hard-block rule) —
      // not the search-only list endpoint, which ignores vendor_id/material_id.
      const vmi = (await getVendorMaterialInfo({ vendor_id: form.vendor_id, material_id: materialId }))?.data;
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
    if (!form.company_id || !form.vendor_id) {
      setError("Company and vendor are required.");
      return;
    }
    if (!form.cost_center_id) {
      setError("Cost center is required.");
      return;
    }
    if (showIncoterm && !form.incoterm.trim()) {
      setError("Incoterm is required for import purchase orders.");
      return;
    }
    if (showIncoterm && !form.destination_port_id) {
      setError("Destination port is required for import purchase orders.");
      return;
    }
    if (showIncoterm && (!form.shipment_mode || !form.import_trade_type || !form.customs_movement_type)) {
      setError("Shipment mode, import trade type, and customs movement type are required for import purchase orders.");
      return;
    }
    if (lines.some((line) => !line.material_id || !line.quantity || !line.rate || !line.payment_term_id || !line.freight_term)) {
      setError("Each PO line requires material, quantity, rate, payment term, and freight term.");
      return;
    }
    if (lines.some((line) => line.aslWarning)) {
      setError("One or more lines have no approved VMI record for this vendor — this is a hard block per design. Fix or remove those lines before saving.");
      return;
    }
    if (lines.some((line) => line.has_rebate && (!line.rebate_rate || !line.rebate_rate_uom_basis))) {
      setError("Each rebate-enabled line requires a rebate rate and basis.");
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
        destination_port_id: showIncoterm ? form.destination_port_id : null,
        shipment_mode: showIncoterm ? form.shipment_mode : null,
        import_trade_type: showIncoterm ? form.import_trade_type : null,
        customs_movement_type: showIncoterm ? form.customs_movement_type : null,
        cost_center_id: form.cost_center_id,
        extra_fields: form.extra_fields.map((entry) => entry.trim()).filter(Boolean),
        // Per feasibility doc 87.12A: each material becomes its own PO, all
        // grouped under one internal Order ID — never one multi-line PO.
        materials: lines.map((line) => ({
          material_id: line.material_id,
          ordered_qty: Number(line.quantity),
          po_uom_code: line.uom_code || null,
          unit_rate: Number(line.rate),
          currency_code: line.currency_code || "INR",
          payment_term_id: line.payment_term_id,
          freight_term: line.freight_term,
          gst_terms: line.gst_terms || null,
          delivery_date: line.delivery_date || null,
          remarks: line.remarks.trim() || null,
          has_rebate: line.has_rebate,
          rebate_remarks: line.has_rebate ? line.rebate_remarks.trim() || null : null,
          rebate_rate: line.has_rebate && line.rebate_rate !== "" ? Number(line.rebate_rate) : null,
          rebate_rate_uom_basis: line.has_rebate ? line.rebate_rate_uom_basis || null : null,
        })),
      };
      const created = await createPurchaseOrder(payload);
      const groupId = created?.order_group?.id;
      const poCount = Array.isArray(created?.purchase_orders) ? created.purchase_orders.length : 1;
      setNotice(`${poCount} purchase order${poCount === 1 ? "" : "s"} created.`);
      if (groupId) {
        openScreenWithContext(
          OPERATION_SCREENS.PROC_PO_ORDER_DETAIL.screen_code,
          { id: groupId, refreshOnReturn: true }
        );
        navigate(`/dashboard/procurement/po-order-groups/${encodeURIComponent(groupId)}`);
      } else {
        openScreenWithContext(
          OPERATION_SCREENS.PROC_PO_DETAIL.screen_code,
          { id: created?.id, refreshOnReturn: true }
        );
        navigate(`/dashboard/procurement/purchase-orders/${encodeURIComponent(created?.id)}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_PO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const netTotal = lines.reduce((sum, line) => sum + (Number(line.quantity || 0) || 0) * (Number(line.rate || 0) || 0), 0);
  const activeLineForDrawer = lineMoreIndex != null ? lines[lineMoreIndex] : null;
  const loading =
    paymentTermQuery.isLoading ||
    (filterOptionsQuery.isLoading && !filterOptionsQuery.data) ||
    (Boolean(form.company_id) && costCenterQuery.isLoading);
  const initialFilterLoaded = Boolean(filterOptionsQuery.data) || filterOptionsQuery.isFetched;

  const lineColumns = [
    {
      key: "material_id",
      label: "Material",
      width: "260px",
      render: (_row, index) => (
        <ErpComboboxField
          value={lines[index].material_id}
          onChange={(value) => {
            updateLine(index, { material_id: value, aslWarning: "", aslChecked: false });
            // Fire the VMI/UOM lookup immediately instead of waiting for blur —
            // the combobox deliberately keeps focus on the field after a
            // selection, so onBlur alone left UOM feeling delayed.
            void checkApprovedAsl(index, value);
          }}
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
          type="number"
          min="0"
          step="0.0001"
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
          type="number"
          min="0"
          step="0.0001"
          value={lines[index].rate}
          onChange={(event) => updateLine(index, { rate: event.target.value })}
          className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
        />
      ),
    },
    {
      key: "currency_code",
      label: "Curr",
      width: "90px",
      render: (_row, index) => (
        <select
          value={lines[index].currency_code || "INR"}
          onChange={(event) => updateLine(index, { currency_code: event.target.value })}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
        >
          {CURRENCY_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ),
    },
    {
      key: "payment_term_id",
      label: "Payment Term",
      width: "180px",
      render: (_row, index) => (
        <select
          value={lines[index].payment_term_id}
          onChange={(event) => updateLine(index, { payment_term_id: event.target.value })}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
        >
          <option value="">Select payment term</option>
          {paymentTermOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ),
    },
    {
      key: "freight_term",
      label: "Freight Term",
      width: "160px",
      render: (_row, index) => (
        <select
          value={lines[index].freight_term}
          onChange={(event) => updateLine(index, { freight_term: event.target.value })}
          className="h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
        >
          {FREIGHT_TERM_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ),
    },
    {
      key: "delivery_date",
      label: deliveryDateLabel,
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
      width: "150px",
      render: (_row, index) => (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setLineMoreIndex(index)}
            className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
          >
            More
          </button>
          <button
            type="button"
            onClick={() => removeLine(index)}
            disabled={lines.length === 1}
            className="border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      ),
    },
  ];

  const lineRowsWithWarnings = lines.map((line, index) => ({ ...line, __index: index }));

  return (
    <>
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
        {loading || !initialFilterLoaded ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading procurement master data...
          </div>
        ) : (
          <div className="grid gap-4">
            <ErpSectionCard eyebrow="PO Header" title="Vendor and dispatch basics">
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Company <span className="text-rose-500">*</span>
                  <ErpCompanySelector
                    companies={companyOptions.map((entry) => ({
                      id: entry.value,
                      company_code: entry.label.split("|")[0]?.trim() || entry.value,
                      company_name: entry.label.split("|").slice(1).join("|").trim() || entry.label,
                    }))}
                    value={form.company_id}
                    onChange={(value) => updateHeaderField("company_id", value)}
                    mode="required"
                    label=""
                    readOnly={companyReadOnly}
                  />
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
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Cost Center <span className="text-rose-500">*</span>
                  <ErpComboboxField
                    value={form.cost_center_id}
                    onChange={(value) => updateHeaderField("cost_center_id", value)}
                    options={costCenterOptions}
                    blankLabel="Select cost center"
                  />
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
                {showIncoterm ? (
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Destination Port <span className="text-rose-500">*</span>
                    <ErpComboboxField
                      value={form.destination_port_id}
                      onChange={(value) => updateHeaderField("destination_port_id", value)}
                      options={portOptions}
                      blankLabel={portQuery.isLoading ? "Loading ports…" : "Select port"}
                    />
                  </label>
                ) : null}
                {showIncoterm ? (
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Shipment Mode <span className="text-rose-500">*</span>
                    <select
                      value={form.shipment_mode}
                      onChange={(event) => updateHeaderField("shipment_mode", event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select shipment mode</option>
                      {SHIPMENT_MODE_OPTIONS.map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {showIncoterm ? (
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Import Trade Type <span className="text-rose-500">*</span>
                    <select
                      value={form.import_trade_type}
                      onChange={(event) => updateHeaderField("import_trade_type", event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select trade type</option>
                      {IMPORT_TRADE_TYPE_OPTIONS.map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {showIncoterm ? (
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Customs Movement Type <span className="text-rose-500">*</span>
                    <select
                      value={form.customs_movement_type}
                      onChange={(event) => updateHeaderField("customs_movement_type", event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="">Select movement type</option>
                      {CUSTOMS_MOVEMENT_TYPE_OPTIONS.map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            </ErpSectionCard>

            <ErpSectionCard
              eyebrow="Materials"
              title="Order details — one PO per material"
              actions={[
                { key: "add-line", label: "+ Add Material", tone: "primary", onClick: addLine },
                { key: "add-field", label: "+ Add Field", tone: "neutral", onClick: addExtraField },
              ]}
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
              <div className="mt-4 grid gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-700">Extra Fields</p>
                  <p className="text-[11px] text-slate-500">Add optional order-level text rows.</p>
                </div>
                {form.extra_fields.length === 0 ? (
                  <div className="border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    No extra fields added.
                  </div>
                ) : (
                  form.extra_fields.map((value, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <input
                        value={value}
                        onChange={(event) => updateExtraField(index, event.target.value)}
                        className="h-9 w-full border border-slate-300 bg-[#fffef7] px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => removeExtraField(index)}
                        className="border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
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

      <LineMoreDrawer
        line={activeLineForDrawer}
        visible={lineMoreIndex != null}
        onClose={() => setLineMoreIndex(null)}
        onChange={(patch) => {
          if (lineMoreIndex != null) {
            updateLine(lineMoreIndex, patch);
          }
        }}
      />

    </>
  );
}
