import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import {
  useMaterialOptionsQuery,
  useVendorOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { addIVLine, createIVDraft, getGRN, listGRNs } from "../procurementApi.js";

function createLineEntry(grnId, grnLine) {
  return {
    key: `${grnId}-${grnLine.id}`,
    grn_id: grnId,
    grn_line_id: grnLine.id,
    material_id: grnLine.material_id,
    grn_qty: grnLine.received_qty ?? "",
    po_rate: grnLine.grn_rate ?? "",
    uom_code: grnLine.uom_code || "",
    invoice_qty: "",
    invoice_rate: "",
    gst_rate: "",
    invoice_gst_amount: "",
  };
}

export default function IVCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const defaultCompanyId = resolveDefaultTransactionCompanyId(runtimeContext);
  const [lineEntries, setLineEntries] = useState([]);
  const [form, setForm] = useState({
    company_id: defaultCompanyId,
    vendor_id: "",
    vendor_invoice_number: "",
    vendor_invoice_date: "",
    remarks: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const vendorQuery = useVendorOptionsQuery({ limit: 200, offset: 0 });
  const materialQuery = useMaterialOptionsQuery({ limit: 200, offset: 0 });

  useEffect(() => {
    setForm((current) => ({
      ...current,
      company_id: current.company_id || defaultCompanyId || "",
    }));
  }, [defaultCompanyId]);

  const grnQuery = useQuery({
    queryKey: ["procurement", "iv-create-grns", { company_id: form.company_id || undefined, vendor_id: form.vendor_id || undefined }],
    enabled: Boolean(form.vendor_id),
    queryFn: async () => {
      const list = await listGRNs({
        company_id: form.company_id || undefined,
        vendor_id: form.vendor_id,
        status: "POSTED",
        limit: 200,
      });
      const items = Array.isArray(list?.items) ? list.items : [];
      const details = await Promise.all(
        items.map(async (row) => {
          try {
            return await getGRN(row.id);
          } catch {
            return null;
          }
        })
      );
      return details.filter(Boolean);
    },
    // Changing vendor/company re-keys this query — keep the previous GRN
    // list on screen instead of blanking the whole form while it refetches.
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const grns = Array.isArray(grnQuery.data) ? grnQuery.data : [];
    if (!form.vendor_id) {
      setLineEntries([]);
      return;
    }
    setLineEntries(
      grns.flatMap((grn) =>
        Array.isArray(grn.lines)
          ? grn.lines.map((line) => createLineEntry(grn.id, line))
          : []
      )
    );
  }, [form.vendor_id, grnQuery.data]);

  useEffect(() => {
    const nextError =
      vendorQuery.error?.message ||
      materialQuery.error?.message ||
      grnQuery.error?.message ||
      "";
    if (nextError) {
      setError(nextError);
    } else if (!saving) {
      setError("");
    }
  }, [grnQuery.error?.message, materialQuery.error?.message, saving, vendorQuery.error?.message]);

  const vendors = vendorQuery.vendors;
  const materials = materialQuery.materials;
  const grns = useMemo(
    () => (Array.isArray(grnQuery.data) ? grnQuery.data : []),
    [grnQuery.data],
  );
  const loading =
    vendorQuery.isLoading ||
    materialQuery.isLoading ||
    (grnQuery.isLoading && !grnQuery.data);

  useEffect(() => {
    if (!form.vendor_id) {
      return;
    }
    if (grnQuery.isSuccess) {
      return;
    }
    if (!grnQuery.isFetching) {
      setLineEntries([]);
    }
  }, [form.vendor_id, grnQuery.isFetching, grnQuery.isSuccess]);

  const materialMap = useMemo(
    () => new Map(materials.map((entry) => [entry.id, entry])),
    [materials]
  );
  const grnMap = useMemo(
    () => new Map(grns.map((entry) => [entry.id, entry])),
    [grns]
  );

  function updateLine(key, patch) {
    setLineEntries((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  async function handleSubmit() {
    if (!form.company_id || !form.vendor_id || !form.vendor_invoice_number || !form.vendor_invoice_date) {
      setError("Company, vendor, vendor invoice number, and invoice date are required.");
      return;
    }
    const validLines = lineEntries.filter((line) => Number(line.invoice_qty) > 0 && Number(line.invoice_rate) > 0);
    if (validLines.length === 0) {
      setError("Enter at least one invoice line.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const created = await createIVDraft({
        company_id: form.company_id,
        vendor_id: form.vendor_id,
        vendor_invoice_number: form.vendor_invoice_number.trim(),
        vendor_invoice_date: form.vendor_invoice_date,
        remarks: form.remarks.trim() || null,
      });
      for (const line of validLines) {
        await addIVLine(created.id, {
          grn_line_id: line.grn_line_id,
          invoice_qty: Number(line.invoice_qty),
          invoice_rate: Number(line.invoice_rate),
          gst_rate: line.gst_rate ? Number(line.gst_rate) : null,
          invoice_gst_amount: line.invoice_gst_amount ? Number(line.invoice_gst_amount) : 0,
        });
      }
      openScreen(OPERATION_SCREENS.PROC_IV_DETAIL.screen_code);
      navigate(`/dashboard/procurement/accounts/invoice-verifications/${encodeURIComponent(created.id)}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_IV_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="Procurement Accounts"
      title="Create Invoice Verification"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Create IV", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || loading },
      ]}
      notices={error ? [{ key: "iv-create-error", tone: "error", message: error }] : []}
      formEyebrow="IV Header"
      formTitle="Create an invoice verification draft"
      formContent={
        loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading invoice verification setup...
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <ErpDenseFormRow label="Company" required>
                <TransactionCompanySelector
                  runtimeContext={runtimeContext}
                  value={form.company_id}
                  onChange={(value) => setForm((current) => ({ ...current, company_id: value, vendor_id: "" }))}
                  label="Company"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Vendor" required>
                <select
                  value={form.vendor_id}
                  onChange={(event) => setForm((current) => ({ ...current, vendor_id: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select vendor</option>
                  {vendors.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.vendor_code || entry.id} | {entry.vendor_name || ""}
                    </option>
                  ))}
                </select>
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Vendor Invoice Number" required>
                <input
                  value={form.vendor_invoice_number}
                  onChange={(event) => setForm((current) => ({ ...current, vendor_invoice_number: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Vendor Invoice Date" required>
                <input
                  type="date"
                  value={form.vendor_invoice_date}
                  onChange={(event) => setForm((current) => ({ ...current, vendor_invoice_date: event.target.value }))}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
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

            <div className="grid gap-3 border-t border-slate-300 pt-3">
              <div className="text-sm font-semibold text-slate-900">GRN Lines</div>
              {lineEntries.length === 0 ? (
                <div className="text-sm text-slate-500">
                  Select a vendor to load posted GRN lines for invoice verification.
                </div>
              ) : (
                lineEntries.map((line) => {
                  const grn = grnMap.get(line.grn_id);
                  return (
                    <div key={line.key} className="grid gap-3 border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                        {grn?.grn_number || line.grn_id} | {materialMap.get(line.material_id)?.material_name || materialMap.get(line.material_id)?.material_code || line.material_id}
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                        <ErpDenseFormRow label="GRN Qty">
                          <input
                            value={line.grn_qty}
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
                        <ErpDenseFormRow label="Invoice Qty">
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={line.invoice_qty}
                            onChange={(event) => updateLine(line.key, { invoice_qty: event.target.value })}
                            className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                        </ErpDenseFormRow>
                        <ErpDenseFormRow label="Invoice Rate">
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={line.invoice_rate}
                            onChange={(event) => updateLine(line.key, { invoice_rate: event.target.value })}
                            className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                        </ErpDenseFormRow>
                        <ErpDenseFormRow label="GST Rate">
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={line.gst_rate}
                            onChange={(event) => updateLine(line.key, { gst_rate: event.target.value })}
                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                        </ErpDenseFormRow>
                        <ErpDenseFormRow label="Invoice GST Amount">
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={line.invoice_gst_amount}
                            onChange={(event) => updateLine(line.key, { invoice_gst_amount: event.target.value })}
                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                        </ErpDenseFormRow>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )
      }
    />
  );
}
