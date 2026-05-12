import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { listMaterials, listVendors } from "../../om/omApi.js";
import {
  acknowledgeDebitNote,
  createDebitNote,
  createExchangeRef,
  getGRN,
  getRTV,
  linkReplacementGRN,
  markDebitNoteSent,
  postRTV,
  settleDebitNote,
} from "../procurementApi.js";

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "DISPATCHED":
      return "sky";
    case "SETTLED":
      return "emerald";
    case "CANCELLED":
      return "rose";
    case "CREATED":
    default:
      return "amber";
  }
}

function settlementTone(mode) {
  switch (String(mode || "").toUpperCase()) {
    case "DEBIT_NOTE":
      return "sky";
    case "EXCHANGE":
      return "violet";
    case "NEXT_INVOICE_ADJUST":
    default:
      return "amber";
  }
}

function dnTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "SENT":
      return "sky";
    case "ACKNOWLEDGED":
      return "amber";
    case "SETTLED":
      return "emerald";
    case "DRAFT":
    default:
      return "slate";
  }
}

export default function RTVDetailPage() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState(null);
  const [grn, setGrn] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [replacementGrnId, setReplacementGrnId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const vendorMap = useMemo(
    () => new Map(vendors.map((entry) => [entry.id, entry])),
    [vendors]
  );
  const materialMap = useMemo(
    () => new Map(materials.map((entry) => [entry.id, entry])),
    [materials]
  );

  const debitNote = Array.isArray(detail?.debit_notes) ? detail.debit_notes[0] : null;
  const exchangeRef = Array.isArray(detail?.exchange_references)
    ? detail.exchange_references[0]
    : null;
  const gateExitNumber = detail?.gate_exit_outbound?.[0]?.exit_number || detail?.gate_exit_number || "";
  const settlementMode = String(detail?.settlement_mode || "").toUpperCase();
  const status = String(detail?.status || "").toUpperCase();

  async function loadDetail() {
    if (!id) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [rtvData, vendorData, materialData] = await Promise.all([
        getRTV(id),
        listVendors({ limit: 200, offset: 0 }),
        listMaterials({ limit: 200, offset: 0 }),
      ]);
      const grnData = rtvData?.grn_id ? await getGRN(rtvData.grn_id).catch(() => null) : null;
      setDetail(rtvData);
      setGrn(grnData);
      setVendors(Array.isArray(vendorData?.data) ? vendorData.data : []);
      setMaterials(Array.isArray(materialData?.data) ? materialData.data : []);
      setReplacementGrnId("");
    } catch (loadError) {
      setDetail(null);
      setGrn(null);
      setVendors([]);
      setMaterials([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_RTV_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id]);

  async function runAction(action, successMessage) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_RTV_ACTION_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handlePostRTV() {
    const confirmed = window.confirm("Stock will be returned to vendor (P122 movement).");
    if (!confirmed) {
      return;
    }
    await runAction(() => postRTV(id, {}), "RTV posted successfully.");
  }

  const materialValue = Number(debitNote?.material_value ?? 0);
  const freightValue = Number(debitNote?.freight_amount ?? 0);
  const otherLcValue = Number(
    (Number(debitNote?.insurance_amount ?? 0) +
      Number(debitNote?.customs_duty_amount ?? 0) +
      Number(debitNote?.cha_charges_amount ?? 0) +
      Number(debitNote?.loading_charges ?? 0) +
      Number(debitNote?.unloading_charges ?? 0) +
      Number(debitNote?.other_charges ?? 0)).toFixed(4)
  );

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Return To Vendor Detail"
      notices={[
        ...(error ? [{ key: "rtv-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "rtv-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(status === "CREATED"
          ? [
              {
                key: "post",
                label: saving ? "Posting..." : "Post RTV",
                tone: "primary",
                onClick: () => void handlePostRTV(),
                disabled: saving,
              },
            ]
          : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading RTV detail..." : "RTV detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail.rtv_number || "RTV"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="Status" value={detail.status || "—"} tone={statusTone(detail.status)} />
              <ErpFieldPreview label="Vendor" value={vendorMap.get(detail.vendor_id)?.vendor_name || vendorMap.get(detail.vendor_id)?.vendor_code || detail.vendor_id || "—"} />
              <ErpFieldPreview label="GRN" value={grn?.grn_number || detail.grn_id || "—"} />
              <ErpFieldPreview label="Reason" value={detail.reason_category || "—"} />
              <ErpFieldPreview label="Settlement" value={detail.settlement_mode || "—"} tone={settlementTone(detail.settlement_mode)} />
              <ErpFieldPreview label="RTV Date" value={detail.rtv_date || "—"} />
            </div>
          </ErpSectionCard>

          {gateExitNumber ? (
            <div className="rounded border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              Gate Exit {gateExitNumber} created.
            </div>
          ) : null}

          <ErpSectionCard eyebrow="Lines" title="Return lines">
            <ErpDenseGrid
              columns={[
                { key: "line_number", label: "Line", width: "70px" },
                {
                  key: "material_id",
                  label: "Material",
                  render: (row) =>
                    materialMap.get(row.material_id)?.material_name ||
                    materialMap.get(row.material_id)?.material_code ||
                    row.material_id ||
                    "—",
                },
                { key: "return_qty", label: "Return Qty", width: "110px" },
                { key: "uom_code", label: "UOM", width: "90px" },
                { key: "grn_rate", label: "PO Rate", width: "110px" },
              ]}
              rows={detail.lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No RTV lines found."
            />
          </ErpSectionCard>

          {["DISPATCHED", "SETTLED"].includes(status) && settlementMode === "DEBIT_NOTE" ? (
            <ErpSectionCard eyebrow="Debit Note" title="Debit note settlement">
              {debitNote ? (
                <div className="grid gap-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <ErpFieldPreview label="DN Number" value={debitNote.dn_number || "—"} />
                    <ErpFieldPreview label="Status" value={debitNote.status || "—"} tone={dnTone(debitNote.status)} />
                    <ErpFieldPreview label="Material Value" value={materialValue.toFixed(4)} />
                    <ErpFieldPreview label="Freight Value" value={freightValue.toFixed(4)} />
                    <ErpFieldPreview label="Other LC Value" value={otherLcValue.toFixed(4)} />
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900">
                    Total Value:{" "}
                    <span className="font-semibold">
                      {(materialValue + freightValue + otherLcValue).toFixed(4)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {String(debitNote.status || "").toUpperCase() === "DRAFT" ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void runAction(() => markDebitNoteSent(debitNote.id), "Debit note marked sent.")}
                        className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                      >
                        Mark Sent
                      </button>
                    ) : null}
                    {String(debitNote.status || "").toUpperCase() === "SENT" ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void runAction(() => acknowledgeDebitNote(debitNote.id), "Debit note acknowledged.")}
                        className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
                      >
                        Acknowledge
                      </button>
                    ) : null}
                    {String(debitNote.status || "").toUpperCase() === "ACKNOWLEDGED" ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void runAction(() => settleDebitNote(debitNote.id), "Debit note settled.")}
                        className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 disabled:opacity-50"
                      >
                        Settle
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void runAction(() => createDebitNote({ rtv_id: id }), "Debit note created.")}
                  className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                >
                  Create Debit Note
                </button>
              )}
            </ErpSectionCard>
          ) : null}

          {["DISPATCHED", "SETTLED"].includes(status) && settlementMode === "EXCHANGE" ? (
            <ErpSectionCard eyebrow="Exchange Reference" title="Replacement tracking">
              {exchangeRef ? (
                <div className="grid gap-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <ErpFieldPreview label="Exchange Ref Number" value={exchangeRef.exchange_ref_number || "—"} />
                    <ErpFieldPreview
                      label="Status"
                      value={
                        String(exchangeRef.status || "").toUpperCase() === "RETURN_DISPATCHED"
                          ? "PENDING"
                          : exchangeRef.status || "—"
                      }
                    />
                    <ErpFieldPreview label="Replacement GRN" value={exchangeRef.replacement_grn_id || "—"} />
                  </div>
                  {String(exchangeRef.status || "").toUpperCase() === "RETURN_DISPATCHED" ? (
                    <div className="grid gap-3 lg:grid-cols-[220px_auto]">
                      <ErpDenseFormRow label="Replacement GRN ID">
                        <input
                          value={replacementGrnId}
                          onChange={(event) => setReplacementGrnId(event.target.value)}
                          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      </ErpDenseFormRow>
                      <div className="flex items-end">
                        <button
                          type="button"
                          disabled={saving || !replacementGrnId.trim()}
                          onClick={() =>
                            void runAction(
                              () =>
                                linkReplacementGRN(exchangeRef.id, {
                                  replacement_grn_id: replacementGrnId.trim(),
                                }),
                              "Replacement GRN linked."
                            )
                          }
                          className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                        >
                          Link Replacement GRN
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void runAction(() => createExchangeRef({ rtv_id: id }), "Exchange reference created.")}
                  className="border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-900 disabled:opacity-50"
                >
                  Create Exchange Reference
                </button>
              )}
            </ErpSectionCard>
          ) : null}

          {["DISPATCHED", "SETTLED"].includes(status) && settlementMode === "NEXT_INVOICE_ADJUST" ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Pending credit tracked on vendor&apos;s next Invoice Verification. No action needed here.
            </div>
          ) : null}
        </div>
      )}
    </ErpScreenScaffold>
  );
}
