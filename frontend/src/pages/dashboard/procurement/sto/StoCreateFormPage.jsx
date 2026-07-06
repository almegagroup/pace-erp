import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useCostCentersQuery, useMaterialOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { usePaymentTermOptionsQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  confirmSTO,
  createSTO,
  getLastStoPaymentTerm,
  listAvailableSubCsnsForSto,
} from "../procurementApi.js";

const STO_TYPE_OPTIONS = ["CONSIGNMENT_DISTRIBUTION", "INTER_PLANT"];
const MATERIAL_TYPES = ["RM", "PM", "INT", "SFG", "FG", "TRA", "CONS"];
const DELIVERY_TYPE_OPTIONS = ["STANDARD", "BULK", "TANKER"];
const CURRENCY_OPTIONS = ["INR", "USD"];
const FREIGHT_TERM_OPTIONS = [
  { value: "FOR", label: "FOR" },
  { value: "FREIGHT_SEPARATE", label: "Freight Separate" },
  { value: "FREIGHT_AT_ACTUALS", label: "Freight at Actuals" },
];
const GST_TERM_OPTIONS = [
  { value: "INCLUSIVE", label: "GST Inclusive" },
  { value: "EXCLUSIVE", label: "GST Exclusive" },
];
const REBATE_BASIS_OPTIONS = [
  { value: "BASE_UOM", label: "Base UOM" },
  { value: "PO_UOM", label: "PO UOM" },
];

function createEmptyLine(defaultPaymentTermId = "") {
  return {
    material_id: "",
    source_csn_id: "",
    quantity: "",
    uom_code: "",
    rate: "",
    currency_code: "INR",
    payment_term_id: defaultPaymentTermId,
    freight_term: "FOR",
    gst_terms: "",
    remarks: "",
    has_rebate: false,
    rebate_rate: "",
    rebate_rate_uom_basis: "BASE_UOM",
    rebate_remarks: "",
    expected_delivery_date: "",
  };
}

function LineMoreDrawer({ line, visible, onClose, onChange }) {
  if (!line) return null;

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

export default function StoCreateFormPage({ openingMode = false }) {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [form, setForm] = useState({
    sto_type: openingMode ? "INTER_PLANT" : "CONSIGNMENT_DISTRIBUTION",
    sending_company_id: runtimeContext?.selectedCompanyId || "",
    receiving_company_id: "",
    sending_cost_center_id: "",
    receiving_cost_center_id: "",
    delivery_type: "STANDARD",
    sto_number: "",
    sto_date: new Date().toISOString().slice(0, 10),
    remarks: "",
  });
  const [materialType, setMaterialType] = useState("");
  const [lines, setLines] = useState([createEmptyLine()]);
  const [lineMoreIndex, setLineMoreIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pickerIndex, setPickerIndex] = useState(null);

  const companies = useMemo(() => runtimeContext?.availableCompanies ?? [], [runtimeContext?.availableCompanies]);
  const paymentTermQuery = usePaymentTermOptionsQuery({ is_active: true });
  const materialQuery = useMaterialOptionsQuery({
    material_type: materialType || undefined,
    limit: 200,
    offset: 0,
  });
  const sendingCostCenterQuery = useCostCentersQuery(
    { company_id: form.sending_company_id, active: true },
    { enabled: Boolean(form.sending_company_id) }
  );
  const receivingCostCenterQuery = useCostCentersQuery(
    { company_id: form.receiving_company_id, active: true },
    { enabled: Boolean(form.receiving_company_id) }
  );
  const lastPaymentTermQuery = useQuery({
    queryKey: ["procurement", "sto-last-payment-term", form.sending_company_id, form.receiving_company_id],
    queryFn: () =>
      getLastStoPaymentTerm({
        sending_company_id: form.sending_company_id,
        receiving_company_id: form.receiving_company_id,
      }),
    enabled: Boolean(form.sending_company_id && form.receiving_company_id),
  });

  const materials = materialQuery.materials;
  const paymentTerms = paymentTermQuery.paymentTerms;
  const sendingCostCenters = useMemo(
    () => (Array.isArray(sendingCostCenterQuery.data?.data) ? sendingCostCenterQuery.data.data : []),
    [sendingCostCenterQuery.data?.data]
  );
  const receivingCostCenters = useMemo(
    () => (Array.isArray(receivingCostCenterQuery.data?.data) ? receivingCostCenterQuery.data.data : []),
    [receivingCostCenterQuery.data?.data]
  );
  const isConsignmentSto = !openingMode && form.sto_type === "CONSIGNMENT_DISTRIBUTION";
  const defaultPaymentTermId = String(lastPaymentTermQuery.data?.payment_term_id || "");

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
  const paymentTermOptions = useMemo(
    () =>
      paymentTerms.map((entry) => ({
        value: entry.id,
        label: `${entry.code || entry.name} | ${entry.name}`,
      })),
    [paymentTerms]
  );
  const sendingCostCenterOptions = useMemo(
    () =>
      sendingCostCenters.map((entry) => ({
        value: entry.id,
        label: `${entry.cost_center_code || entry.id} | ${entry.cost_center_name || entry.name || ""}`,
      })),
    [sendingCostCenters]
  );
  const receivingCostCenterOptions = useMemo(
    () =>
      receivingCostCenters.map((entry) => ({
        value: entry.id,
        label: `${entry.cost_center_code || entry.id} | ${entry.cost_center_name || entry.name || ""}`,
      })),
    [receivingCostCenters]
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
        enabled: isConsignmentSto && Boolean(form.sending_company_id) && Boolean(form.receiving_company_id) && Boolean(line.material_id),
      };
    }),
  });

  const loading =
    materialQuery.isLoading ||
    paymentTermQuery.isLoading ||
    (Boolean(form.sending_company_id) && sendingCostCenterQuery.isLoading) ||
    (Boolean(form.receiving_company_id) && receivingCostCenterQuery.isLoading);

  useEffect(() => {
    const nextError =
      materialQuery.error?.message ||
      paymentTermQuery.error?.message ||
      sendingCostCenterQuery.error?.message ||
      receivingCostCenterQuery.error?.message ||
      lastPaymentTermQuery.error?.message ||
      "";
    if (nextError) {
      setError(nextError);
    }
  }, [
    lastPaymentTermQuery.error?.message,
    materialQuery.error?.message,
    paymentTermQuery.error?.message,
    receivingCostCenterQuery.error?.message,
    sendingCostCenterQuery.error?.message,
  ]);

  useEffect(() => {
    if (companies.length === 0) return;
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
  }, [companies, runtimeContext?.selectedCompanyId]);

  useEffect(() => {
    if (!defaultPaymentTermId) return;
    setLines((current) =>
      current.map((line) => (line.payment_term_id ? line : { ...line, payment_term_id: defaultPaymentTermId }))
    );
  }, [defaultPaymentTermId]);

  useEffect(() => {
    if (!form.sending_cost_center_id) return;
    if (sendingCostCenterOptions.some((entry) => entry.value === form.sending_cost_center_id)) return;
    setForm((current) => ({ ...current, sending_cost_center_id: "" }));
  }, [form.sending_cost_center_id, sendingCostCenterOptions]);

  useEffect(() => {
    if (!form.receiving_cost_center_id) return;
    if (receivingCostCenterOptions.some((entry) => entry.value === form.receiving_cost_center_id)) return;
    setForm((current) => ({ ...current, receiving_cost_center_id: "" }));
  }, [form.receiving_cost_center_id, receivingCostCenterOptions]);

  function updateHeaderField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "sto_type" || key === "sending_company_id" || key === "receiving_company_id") {
      setLines((current) =>
        current.map((line) => ({
          ...line,
          source_csn_id: "",
          ...(key !== "sto_type" ? { payment_term_id: "" } : {}),
        }))
      );
      setPickerIndex(null);
    }
  }

  function updateLine(index, patch) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const nextLine = { ...line, ...patch };
        if (patch.material_id !== undefined && patch.material_id !== line.material_id) {
          nextLine.source_csn_id = "";
          const material = materials.find((entry) => entry.id === patch.material_id);
          nextLine.uom_code = material?.base_uom_code || "";
          if (isConsignmentSto) {
            nextLine.quantity = "";
          }
        }
        return nextLine;
      })
    );
  }

  function addLine() {
    setLines((current) => [...current, createEmptyLine(defaultPaymentTermId)]);
  }

  function removeLine(index) {
    setLines((current) => (current.length === 1 ? current : current.filter((_line, lineIndex) => lineIndex !== index)));
    setLineMoreIndex((current) => (current === index ? null : current != null && current > index ? current - 1 : current));
    setPickerIndex((current) => (current === index ? null : current));
  }

  function getSubCsnRows(index) {
    const query = subCsnQueries[index];
    return Array.isArray(query?.data?.data) ? query.data.data : Array.isArray(query?.data) ? query.data : [];
  }

  function selectSubCsn(index, row) {
    updateLine(index, {
      source_csn_id: row.id,
      material_id: row.material_id,
      quantity: String(row.dispatch_qty ?? row.po_qty ?? ""),
      uom_code: row.po_uom_code || "",
      rate: row.transfer_price != null ? String(row.transfer_price) : "",
      currency_code: row.currency_code || "INR",
      payment_term_id: row.payment_term_id || defaultPaymentTermId || "",
      freight_term: row.freight_term || "FOR",
      gst_terms: row.gst_terms || "",
      expected_delivery_date: row.expected_delivery_date || "",
      has_rebate: row.has_rebate === true,
      rebate_rate: row.rebate_rate != null ? String(row.rebate_rate) : "",
      rebate_rate_uom_basis: row.rebate_rate_uom_basis || "BASE_UOM",
      rebate_remarks: row.rebate_remarks || "",
    });
    setPickerIndex(null);
  }

  async function handleSubmit() {
    if (!form.sending_company_id || !form.receiving_company_id) {
      setError("Sending company and receiving company are required.");
      return;
    }
    if (!form.sending_cost_center_id || !form.receiving_cost_center_id) {
      setError("Sending and receiving cost centers are required.");
      return;
    }
    if (openingMode && !form.sto_number.trim()) {
      setError("Legacy STO Number is required.");
      return;
    }
    if (lines.some((line) => !line.material_id || !line.quantity || !line.rate || !line.payment_term_id || !line.freight_term)) {
      setError("Each STO line requires material, quantity, rate, payment term, and freight term.");
      return;
    }
    if (lines.some((line) => !line.uom_code)) {
      setError("Each STO line requires a UOM code.");
      return;
    }
    if (isConsignmentSto && lines.some((line) => !line.source_csn_id)) {
      setError("Each consignment STO line requires a selected source sub-CSN.");
      return;
    }
    if (lines.some((line) => line.has_rebate && (!line.rebate_rate || !line.rebate_rate_uom_basis))) {
      setError("Each rebate-enabled STO line requires a rebate rate and basis.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        sto_type: openingMode ? "INTER_PLANT" : form.sto_type,
        ...(openingMode ? { sto_number: form.sto_number.trim(), sto_date: form.sto_date || null, is_opening_sto: true } : {}),
        sending_company_id: form.sending_company_id,
        receiving_company_id: form.receiving_company_id,
        sending_cost_center_id: form.sending_cost_center_id,
        receiving_cost_center_id: form.receiving_cost_center_id,
        remarks: form.remarks.trim() || null,
        delivery_type: form.delivery_type,
        lines: lines.map((line) => ({
          material_id: line.material_id,
          source_csn_id: line.source_csn_id || null,
          quantity: Number(line.quantity),
          uom_code: line.uom_code || null,
          transfer_price: Number(line.rate),
          currency_code: line.currency_code || "INR",
          payment_term_id: line.payment_term_id,
          freight_term: line.freight_term,
          gst_terms: line.gst_terms || null,
          remarks: line.remarks.trim() || null,
          has_rebate: line.has_rebate,
          rebate_rate: line.has_rebate && line.rebate_rate !== "" ? Number(line.rebate_rate) : null,
          rebate_rate_uom_basis: line.has_rebate ? line.rebate_rate_uom_basis || null : null,
          rebate_remarks: line.has_rebate ? line.rebate_remarks.trim() || null : null,
          expected_delivery_date: line.expected_delivery_date || null,
        })),
      };
      const created = await createSTO(payload);

      if (openingMode) {
        await confirmSTO(created?.id, { approval_required: false });
        setNotice(`Opening STO ${created?.sto_number || form.sto_number.trim()} created and confirmed.`);
        openScreen(OPERATION_SCREENS.PROC_STO_LIST.screen_code);
        navigate("/dashboard/procurement/stos");
        return;
      }

      if (form.sto_type === "INTER_PLANT") {
        await confirmSTO(created?.id, { approval_required: true });
      }

      openScreen(OPERATION_SCREENS.PROC_STO_DETAIL.screen_code);
      navigate(`/dashboard/procurement/stos/${encodeURIComponent(created?.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_STO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const netTotal = lines.reduce((sum, line) => sum + (Number(line.quantity || 0) || 0) * (Number(line.rate || 0) || 0), 0);
  const activeLineForDrawer = lineMoreIndex != null ? lines[lineMoreIndex] : null;
  const lineRows = lines.map((line, index) => ({ ...line, __index: index }));

  const lineColumns = [
    {
      key: "material_id",
      label: "Material",
      width: "260px",
      render: (_row, index) => (
        <ErpComboboxField
          value={lines[index].material_id}
          onChange={(value) => updateLine(index, { material_id: value })}
          options={materialOptions}
          blankLabel="Select material"
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
      render: (_row, index) => (
        <input
          value={lines[index].uom_code}
          readOnly
          className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-xs text-slate-700 outline-none"
        />
      ),
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
      key: "expected_delivery_date",
      label: "Expected Delivery Date",
      width: "160px",
      render: (_row, index) => (
        <input
          type="date"
          value={lines[index].expected_delivery_date}
          onChange={(event) => updateLine(index, { expected_delivery_date: event.target.value })}
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
      width: isConsignmentSto ? "210px" : "150px",
      render: (_row, index) => (
        <div className="flex gap-2">
          {isConsignmentSto ? (
            <button
              type="button"
              onClick={() => setPickerIndex((current) => (current === index ? null : index))}
              className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
            >
              Sub-CSN
            </button>
          ) : null}
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

  return (
    <>
      <ErpScreenScaffold
        eyebrow="Procurement"
        title={openingMode ? "Create Opening / Legacy Stock Transfer Order" : "Create Stock Transfer Order"}
        actions={[
          { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
          {
            key: "save",
            label: saving
              ? "Saving..."
              : openingMode
                ? "Create Opening STO"
                : "Create STO",
            tone: "primary",
            onClick: () => void handleSubmit(),
            disabled: saving || loading,
          },
        ]}
        notices={[
          ...(error ? [{ key: "sto-create-error", tone: "error", message: error }] : []),
          ...(notice ? [{ key: "sto-create-notice", tone: "success", message: notice }] : []),
        ]}
      >
        {loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading STO master data...
          </div>
        ) : (
          <div className="grid gap-4">
            <ErpSectionCard eyebrow="STO Header" title={openingMode ? "Legacy transfer basics" : "Transfer basics"}>
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                {openingMode ? (
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Legacy STO Number <span className="text-rose-500">*</span>
                    <input
                      value={form.sto_number}
                      onChange={(event) => updateHeaderField("sto_number", event.target.value.toUpperCase())}
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </label>
                ) : (
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    STO Type <span className="text-rose-500">*</span>
                    <select
                      value={form.sto_type}
                      onChange={(event) => updateHeaderField("sto_type", event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      {STO_TYPE_OPTIONS.map((entry) => (
                        <option key={entry} value={entry}>{entry}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Sending Company <span className="text-rose-500">*</span>
                  <select
                    value={form.sending_company_id}
                    onChange={(event) => updateHeaderField("sending_company_id", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select company</option>
                    {companyOptions.map((entry) => (
                      <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Receiving Company <span className="text-rose-500">*</span>
                  <select
                    value={form.receiving_company_id}
                    onChange={(event) => updateHeaderField("receiving_company_id", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select company</option>
                    {companyOptions.map((entry) => (
                      <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Sending Cost Center <span className="text-rose-500">*</span>
                  <ErpComboboxField
                    value={form.sending_cost_center_id}
                    onChange={(value) => updateHeaderField("sending_cost_center_id", value)}
                    options={sendingCostCenterOptions}
                    blankLabel="Select cost center"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  Receiving Cost Center <span className="text-rose-500">*</span>
                  <ErpComboboxField
                    value={form.receiving_cost_center_id}
                    onChange={(value) => updateHeaderField("receiving_cost_center_id", value)}
                    options={receivingCostCenterOptions}
                    blankLabel="Select cost center"
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
                  Material Type
                  <select
                    value={materialType}
                    onChange={(event) => {
                      setMaterialType(event.target.value);
                      setLines((current) =>
                        current.map((line) => ({
                          ...line,
                          material_id: "",
                          source_csn_id: "",
                        }))
                      );
                    }}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">All types</option>
                    {MATERIAL_TYPES.map((entry) => (
                      <option key={entry} value={entry}>{entry}</option>
                    ))}
                  </select>
                </label>
                {openingMode ? (
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    STO Date <span className="text-rose-500">*</span>
                    <input
                      type="date"
                      value={form.sto_date}
                      onChange={(event) => updateHeaderField("sto_date", event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </label>
                ) : null}
                <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-3 xl:col-span-4">
                  Remarks
                  <textarea
                    rows={3}
                    value={form.remarks}
                    onChange={(event) => updateHeaderField("remarks", event.target.value)}
                    className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </label>
              </div>
            </ErpSectionCard>

            <ErpSectionCard
              eyebrow="Materials"
              title={openingMode ? "Transfer details" : "Transfer details"}
              actions={[{ key: "add-line", label: "+ Add Material", tone: "primary", onClick: addLine }]}
            >
              <ErpDenseGrid
                columns={lineColumns}
                rows={lineRows}
                rowKey={(row) => row.__index}
                maxHeight="420px"
                emptyMessage="No materials yet - click Add Material."
                summaryRow={{ label: "Total", values: { net_value: netTotal.toFixed(2) } }}
              />

              {isConsignmentSto ? (
                <div className="mt-4 grid gap-3">
                  {lines.map((line, index) => {
                    const subCsnRows = getSubCsnRows(index);
                    const selectedSubCsn = subCsnRows.find((row) => row.id === line.source_csn_id) || null;
                    const subCsnError = subCsnQueries[index]?.error?.message || "";
                    return (
                      <div key={`sub-csn-line-${index}`} className="rounded border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Line {index + 1} Source Sub-CSN</div>
                            <div className="text-sm text-slate-700">
                              {selectedSubCsn
                                ? `${selectedSubCsn.mother_po_number || "PO ?"} | ${selectedSubCsn.invoice_or_boe_reference || "No invoice/BOE"} | Qty ${selectedSubCsn.dispatch_qty ?? selectedSubCsn.po_qty ?? "-"}`
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
                        {subCsnError ? <div className="mt-2 text-xs text-rose-700">{subCsnError}</div> : null}
                        {pickerIndex === index ? (
                          <div className="mt-3 max-h-56 overflow-auto border border-slate-200 bg-white">
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
                                  <div className="text-xs text-slate-600">Invoice / BOE: {row.invoice_or_boe_reference || "-"}</div>
                                  <div className="text-xs text-slate-600">Allotted Qty: {row.dispatch_qty ?? row.po_qty ?? "-"} {row.po_uom_code || ""}</div>
                                  <div className="text-xs text-slate-500">CSN Status: {row.status}</div>
                                </button>
                              ))
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
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
