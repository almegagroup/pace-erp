import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import {
  createSubCSN,
  deleteSubCSN,
  getCSN,
  listCSNs,
  markCSNArrived,
  markCSNInTransit,
  updateCSN,
} from "../procurementApi.js";

function buildForm(detail) {
  return {
    dispatch_qty: detail?.dispatch_qty ?? "",
    port_of_loading: detail?.port_of_loading ?? "",
    port_of_discharge_id: detail?.port_of_discharge_id ?? "",
    vessel_name: detail?.vessel_name ?? "",
    voyage_number: detail?.voyage_number ?? "",
    bl_number: detail?.bl_number ?? "",
    boe_number: detail?.boe_number ?? "",
    cha_id: detail?.cha_id ?? "",
    cha_name_freetext: detail?.cha_name_freetext ?? "",
    scheduled_eta_to_port: detail?.scheduled_eta_to_port ?? "",
    etd: detail?.etd ?? "",
    bl_date: detail?.bl_date ?? "",
    eta_at_port: detail?.eta_at_port ?? "",
    ata_at_port: detail?.ata_at_port ?? "",
    post_clearance_lr_date: detail?.post_clearance_lr_date ?? "",
    transporter_id: detail?.transporter_id ?? "",
    transporter_name_freetext: detail?.transporter_name_freetext ?? "",
    lr_number_port_to_plant: detail?.lr_number_port_to_plant ?? "",
    vehicle_number_port_to_plant: detail?.vehicle_number_port_to_plant ?? "",
    lc_opened_date: detail?.lc_opened_date ?? "",
    lc_number: detail?.lc_number ?? "",
    vessel_booking_confirmed_date: detail?.vessel_booking_confirmed_date ?? "",
    lr_date: detail?.lr_date ?? "",
    lr_number: detail?.lr_number ?? "",
    vehicle_number: detail?.vehicle_number ?? "",
    domestic_transporter_id: detail?.domestic_transporter_id ?? "",
    domestic_transporter_freetext: detail?.domestic_transporter_freetext ?? "",
    vendor_indent_number: detail?.vendor_indent_number ?? "",
    gate_entry_date: detail?.gate_entry_date ?? "",
    grn_date: detail?.grn_date ?? "",
    received_qty: detail?.received_qty ?? "",
    invoice_number: detail?.invoice_number ?? "",
    remarks: detail?.remarks ?? "",
  };
}

function toPayload(form) {
  const payload = {};
  Object.entries(form).forEach(([key, value]) => {
    payload[key] = value === "" ? null : value;
  });
  return payload;
}

function getTone(value) {
  switch (String(value || "").toUpperCase()) {
    case "IN_TRANSIT":
      return "amber";
    case "ARRIVED":
      return "emerald";
    case "GRN_DONE":
    case "CLOSED":
      return "slate";
    case "IMPORT":
      return "sky";
    case "DOMESTIC":
      return "emerald";
    case "BULK":
      return "violet";
    default:
      return "slate";
  }
}

export default function CSNDetailPage() {
  const { id = "" } = useParams();
  const { runtimeContext } = useMenu();
  const [detail, setDetail] = useState(null);
  const [relatedCsns, setRelatedCsns] = useState([]);
  const [form, setForm] = useState(buildForm(null));
  const [subDispatchQty, setSubDispatchQty] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const subCsns = useMemo(
    () => relatedCsns.filter((row) => row.mother_csn_id === detail?.id),
    [detail?.id, relatedCsns]
  );
  const motherCsn = useMemo(
    () =>
      detail?.mother_csn_id
        ? relatedCsns.find((row) => row.id === detail.mother_csn_id) ?? null
        : null,
    [detail?.mother_csn_id, relatedCsns]
  );

  async function loadDetail() {
    if (!id) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const fetched = await getCSN(id);
      const data = fetched?.data ?? fetched;
      setDetail(data);
      setForm(buildForm(data));

      const scopedCompanyId = data?.company_id || runtimeContext?.selectedCompanyId || "";
      const siblingRows = data?.po_id
        ? await listCSNs({
            company_id: scopedCompanyId,
            po_id: data.po_id,
            limit: 200,
            offset: 0,
          })
        : { data: [] };
      setRelatedCsns(Array.isArray(siblingRows?.data) ? siblingRows.data : []);
    } catch (loadError) {
      setDetail(null);
      setRelatedCsns([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_CSN_DETAIL_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id, runtimeContext?.selectedCompanyId]);

  function patchField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    if (!detail?.id || !detail?.company_id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateCSN(detail.id, {
        company_id: detail.company_id,
        ...toPayload(form),
      });
      setNotice("CSN detail updated.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_CSN_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSubCsn() {
    if (!detail?.id || !detail?.company_id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createSubCSN(detail.id, {
        company_id: detail.company_id,
        dispatch_qty: subDispatchQty ? Number(subDispatchQty) : undefined,
      });
      setSubDispatchQty("");
      setNotice("Sub CSN created.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_SUB_CSN_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSubCsn(subId) {
    if (!detail?.id || !window.confirm("Delete this sub CSN?")) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await deleteSubCSN(detail.id, subId);
      setNotice("Sub CSN deleted.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_SUB_CSN_DELETE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkInTransit() {
    if (!detail?.id || !detail?.company_id) {
      return;
    }
    const actualEtd = window.prompt("Actual ETD (YYYY-MM-DD)", form.etd || "");
    if (actualEtd === null) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await markCSNInTransit(detail.id, {
        company_id: detail.company_id,
        actual_etd: actualEtd || undefined,
      });
      setNotice("CSN marked in transit.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_CSN_MARK_IN_TRANSIT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkArrived() {
    if (!detail?.id || !detail?.company_id) {
      return;
    }
    const arrivalDate = window.prompt("Arrival date (YYYY-MM-DD)", "");
    if (arrivalDate === null) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await markCSNArrived(detail.id, {
        company_id: detail.company_id,
        actual_arrival_date: arrivalDate || undefined,
      });
      setNotice("CSN marked arrived.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_CSN_MARK_ARRIVED_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Consignment Detail"
      notices={[
        ...(error ? [{ key: "csn-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "csn-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Save CSN", tone: "primary", onClick: () => void handleSave(), disabled: saving || loading || !detail },
        ...(detail?.status === "ORDERED"
          ? [{ key: "mark-transit", label: "Mark In Transit", tone: "neutral", onClick: () => void handleMarkInTransit(), disabled: saving }]
          : []),
        ...(detail?.status === "IN_TRANSIT"
          ? [{ key: "mark-arrived", label: "Mark Arrived", tone: "neutral", onClick: () => void handleMarkArrived(), disabled: saving }]
          : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading consignment detail..." : "Consignment detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          {detail.mother_csn_id ? (
            <div className="border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Sub CSN of {motherCsn?.csn_number || detail.mother_csn_id}
            </div>
          ) : null}

          <ErpSectionCard eyebrow="Header" title={detail.csn_number || "CSN"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="CSN Type" value={detail.csn_type} tone={getTone(detail.csn_type)} />
              <ErpFieldPreview label="Status" value={detail.status} tone={getTone(detail.status)} />
              <ErpFieldPreview
                label="Linked PO"
                value={
                  detail.po_id ? (
                    <Link
                      to={`/dashboard/procurement/purchase-orders/${encodeURIComponent(detail.po_id)}`}
                      className="text-sky-700 underline underline-offset-2"
                    >
                      {detail.po_number || detail.po_id}
                    </Link>
                  ) : "—"
                }
              />
              <ErpFieldPreview
                label="Linked GE"
                value={
                  Array.isArray(detail.gate_entries) && detail.gate_entries.length > 0
                    ? detail.gate_entries.map((entry) => entry.ge_number || entry.id).join(", ")
                    : "—"
                }
              />
              <ErpFieldPreview label="Linked GRN" value={detail.grn?.grn_number || detail.grn?.id || "—"} />
              <ErpFieldPreview label="ETA Plant" value={detail.eta_to_plant_calculated || "—"} />
            </div>
          </ErpSectionCard>

          {detail.csn_type === "IMPORT" ? (
            <ErpSectionCard eyebrow="Import Fields" title="Import leg planning">
              <div className="grid gap-3 lg:grid-cols-2">
                <ErpDenseFormRow label="Port Of Loading">
                  <input value={form.port_of_loading} onChange={(event) => patchField("port_of_loading", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Discharge Port ID">
                  <input value={form.port_of_discharge_id} onChange={(event) => patchField("port_of_discharge_id", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Vessel Name">
                  <input value={form.vessel_name} onChange={(event) => patchField("vessel_name", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="BL Number">
                  <input value={form.bl_number} onChange={(event) => patchField("bl_number", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="ETD Origin">
                  <input type="date" value={form.etd || ""} onChange={(event) => patchField("etd", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="ETA Destination Port">
                  <input type="date" value={form.eta_at_port || ""} onChange={(event) => patchField("eta_at_port", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Scheduled ETA Port">
                  <input type="date" value={form.scheduled_eta_to_port || ""} onChange={(event) => patchField("scheduled_eta_to_port", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="LC Required">
                  <div className="text-sm text-slate-700">{detail.lc_required ? "Yes" : "No"}</div>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="LC Number">
                  <input value={form.lc_number} onChange={(event) => patchField("lc_number", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="LC Opened Date">
                  <input type="date" value={form.lc_opened_date || ""} onChange={(event) => patchField("lc_opened_date", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
              </div>
            </ErpSectionCard>
          ) : null}

          {detail.csn_type === "DOMESTIC" ? (
            <ErpSectionCard eyebrow="Domestic Fields" title="Domestic dispatch">
              <div className="grid gap-3 lg:grid-cols-2">
                <ErpDenseFormRow label="LR Date">
                  <input type="date" value={form.lr_date || ""} onChange={(event) => patchField("lr_date", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="LR Number">
                  <input value={form.lr_number} onChange={(event) => patchField("lr_number", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Transporter ID">
                  <input value={form.domestic_transporter_id} onChange={(event) => patchField("domestic_transporter_id", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Transporter Name">
                  <input value={form.domestic_transporter_freetext} onChange={(event) => patchField("domestic_transporter_freetext", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
              </div>
            </ErpSectionCard>
          ) : null}

          {detail.csn_type === "BULK" ? (
            <ErpSectionCard eyebrow="Bulk Fields" title="Bulk receiving">
              <div className="grid gap-3 lg:grid-cols-2">
                <ErpDenseFormRow label="Gate Entry Date">
                  <input type="date" value={form.gate_entry_date || ""} onChange={(event) => patchField("gate_entry_date", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Received Qty">
                  <input type="number" min="0" step="0.0001" value={form.received_qty || ""} onChange={(event) => patchField("received_qty", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Invoice Number">
                  <input value={form.invoice_number} onChange={(event) => patchField("invoice_number", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Remarks">
                  <input value={form.remarks} onChange={(event) => patchField("remarks", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
              </div>
            </ErpSectionCard>
          ) : null}

          <ErpSectionCard eyebrow="Sub CSNs" title="Split dispatch management">
            <div className="grid gap-3">
              <div className="grid gap-3 lg:grid-cols-[220px_auto]">
                <ErpDenseFormRow label="Dispatch Qty">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={subDispatchQty}
                    onChange={(event) => setSubDispatchQty(event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => void handleCreateSubCsn()}
                    disabled={saving}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                  >
                    Add Sub CSN
                  </button>
                </div>
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "csn_number", label: "Sub CSN", width: "140px" },
                  { key: "dispatch_qty", label: "Dispatch Qty", width: "120px" },
                  { key: "status", label: "Status", width: "120px" },
                  {
                    key: "gate_entry_id",
                    label: "Linked GE",
                    width: "140px",
                    render: (row) => row.gate_entry_id || "—",
                  },
                  {
                    key: "actions",
                    label: "Actions",
                    width: "120px",
                    render: (row) =>
                      !row.gate_entry_id ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteSubCsn(row.id)}
                          className="border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-900"
                        >
                          Delete
                        </button>
                      ) : (
                        "—"
                      ),
                  },
                ]}
                rows={subCsns}
                rowKey={(row) => row.id}
                emptyMessage="No sub CSNs linked to this record."
              />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Receiving" title="Gate entry and GRN linkage">
            <ErpDenseGrid
              columns={[
                { key: "id", label: "Gate Entry Line", width: "150px" },
                { key: "gate_entry_id", label: "Gate Entry", width: "150px" },
                { key: "received_qty", label: "Received Qty", width: "120px" },
                { key: "net_weight_received", label: "Net Weight", width: "120px" },
              ]}
              rows={detail.gate_entry_lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No gate entry lines linked yet."
            />
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
