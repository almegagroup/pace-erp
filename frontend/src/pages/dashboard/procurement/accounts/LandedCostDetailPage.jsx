import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { listCHAs } from "../procurementApi.js";
import {
  addLCLine,
  createLandedCost,
  deleteLCLine,
  getLandedCost,
  postLandedCost,
  updateLCLine,
} from "../procurementApi.js";

const COST_TYPES = [
  "FREIGHT",
  "INSURANCE",
  "CUSTOMS_DUTY",
  "CHA_CHARGES",
  "LOADING",
  "UNLOADING",
  "PORT_CHARGES",
  "OTHER",
];

function createEmptyLineForm() {
  return {
    lineId: "",
    cost_type: "FREIGHT",
    cha_id: "",
    bill_reference: "",
    bill_date: "",
    description: "",
    amount: "",
  };
}

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "POSTED":
      return "emerald";
    case "DRAFT":
    default:
      return "slate";
  }
}

export default function LandedCostDetailPage() {
  const { id = "" } = useParams();
  const { runtimeContext } = useMenu();
  const [detail, setDetail] = useState(null);
  const [chaRows, setChaRows] = useState([]);
  const [headerForm, setHeaderForm] = useState({
    grn_id: "",
    csn_id: "",
    vendor_id: "",
    lc_date: "",
    remarks: "",
  });
  const [lineForm, setLineForm] = useState(createEmptyLineForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isNew = id === "new";
  const isDraft = isNew || String(detail?.status || "").toUpperCase() === "DRAFT";

  const totalCost = useMemo(() => {
    const rows = Array.isArray(detail?.lines) ? detail.lines : [];
    return rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  }, [detail?.lines]);

  async function loadDetail() {
    setLoading(true);
    setError("");
    try {
      const chaData = await listCHAs({ limit: 200 });
      setChaRows(Array.isArray(chaData) ? chaData : Array.isArray(chaData?.items) ? chaData.items : []);
      if (isNew) {
        setDetail(null);
        setHeaderForm((current) => ({
          ...current,
          lc_date: current.lc_date || new Date().toISOString().slice(0, 10),
        }));
      } else {
        const lcData = await getLandedCost(id);
        setDetail(lcData);
        setHeaderForm({
          grn_id: lcData.grn_id || "",
          csn_id: lcData.csn_id || "",
          vendor_id: lcData.vendor_id || "",
          lc_date: lcData.lc_date || "",
          remarks: lcData.remarks || "",
        });
      }
    } catch (loadError) {
      setDetail(null);
      setChaRows([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_LC_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id]);

  async function handleCreateHeader() {
    if (!headerForm.vendor_id || (!headerForm.grn_id && !headerForm.csn_id)) {
      setError("Vendor and at least one of GRN ID or CSN ID are required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createLandedCost({
        company_id: runtimeContext?.selectedCompanyId || "",
        vendor_id: headerForm.vendor_id,
        grn_id: headerForm.grn_id || null,
        csn_id: headerForm.csn_id || null,
        lc_date: headerForm.lc_date || null,
        remarks: headerForm.remarks.trim() || null,
      });
      setDetail(created);
      setNotice("Landed cost draft created. You can now add lines.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_LC_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLine() {
    if (!detail?.id || !lineForm.bill_reference || !lineForm.bill_date || !lineForm.amount) {
      setError("Cost type, bill reference, bill date, and amount are required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (lineForm.lineId) {
        await updateLCLine(detail.id, lineForm.lineId, {
          cost_type: lineForm.cost_type,
          cha_id: lineForm.cost_type === "CHA_CHARGES" ? lineForm.cha_id || null : null,
          bill_reference: lineForm.bill_reference,
          bill_date: lineForm.bill_date,
          description: lineForm.description || null,
          amount: Number(lineForm.amount),
        });
        setNotice("Landed cost line updated.");
      } else {
        await addLCLine(detail.id, {
          cost_type: lineForm.cost_type,
          cha_id: lineForm.cost_type === "CHA_CHARGES" ? lineForm.cha_id || null : null,
          bill_reference: lineForm.bill_reference,
          bill_date: lineForm.bill_date,
          description: lineForm.description || null,
          amount: Number(lineForm.amount),
        });
        setNotice("Landed cost line added.");
      }
      setLineForm(createEmptyLineForm());
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_LC_LINE_SAVE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLine(lineId) {
    if (!detail?.id || !window.confirm("Delete this landed cost line?")) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await deleteLCLine(detail.id, lineId);
      setNotice("Landed cost line deleted.");
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_LC_LINE_DELETE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function handlePost() {
    if (!detail?.id) {
      return;
    }
    const confirmed = window.confirm("Post this landed cost document?");
    if (!confirmed) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await postLandedCost(detail.id);
      setNotice("Landed cost posted.");
      await loadDetail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "PROCUREMENT_LC_POST_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Accounts"
      title={isNew ? "Create Landed Cost" : "Landed Cost Detail"}
      notices={[
        ...(error ? [{ key: "lc-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "lc-detail-notice", tone: "success", message: notice }] : []),
        ...(isDraft
          ? [{
              key: "lc-retro-note",
              tone: "info",
              message: "Landed cost can be entered any time after GRN - retroactive entry is allowed.",
            }]
          : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        ...(isNew
          ? [{
              key: "create",
              label: saving ? "Creating..." : "Create Draft",
              tone: "primary",
              onClick: () => void handleCreateHeader(),
              disabled: saving,
            }]
          : []),
        ...(!isNew && isDraft
          ? [{
              key: "post",
              label: saving ? "Posting..." : "Post LC",
              tone: "primary",
              onClick: () => void handlePost(),
              disabled: saving,
            }]
          : []),
      ]}
    >
      {loading ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Loading landed cost detail...
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail?.lc_number || "New Landed Cost"}>
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
              <ErpDenseFormRow label="Vendor ID">
                <input
                  value={headerForm.vendor_id}
                  onChange={(event) => setHeaderForm((current) => ({ ...current, vendor_id: event.target.value }))}
                  readOnly={!isNew}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500 read-only:bg-slate-100"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="GRN ID">
                <input
                  value={headerForm.grn_id}
                  onChange={(event) => setHeaderForm((current) => ({ ...current, grn_id: event.target.value }))}
                  readOnly={!isNew}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500 read-only:bg-slate-100"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="CSN ID">
                <input
                  value={headerForm.csn_id}
                  onChange={(event) => setHeaderForm((current) => ({ ...current, csn_id: event.target.value }))}
                  readOnly={!isNew}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500 read-only:bg-slate-100"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="LC Date">
                <input
                  type="date"
                  value={headerForm.lc_date}
                  onChange={(event) => setHeaderForm((current) => ({ ...current, lc_date: event.target.value }))}
                  readOnly={!isNew}
                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500 read-only:bg-slate-100"
                />
              </ErpDenseFormRow>
              {!isNew ? (
                <ErpFieldPreview label="Status" value={detail?.status || "—"} tone={statusTone(detail?.status)} />
              ) : null}
            </div>
            <div className="mt-3">
              <ErpDenseFormRow label="Remarks">
                <textarea
                  rows={3}
                  value={headerForm.remarks}
                  onChange={(event) => setHeaderForm((current) => ({ ...current, remarks: event.target.value }))}
                  readOnly={!isNew}
                  className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 read-only:bg-slate-100"
                />
              </ErpDenseFormRow>
            </div>
          </ErpSectionCard>

          {!isNew ? (
            <>
              <ErpSectionCard eyebrow="Lines" title="Landed cost lines">
                <ErpDenseGrid
                  columns={[
                    { key: "line_number", label: "Line", width: "70px" },
                    { key: "cost_type", label: "Cost Type", width: "140px" },
                    { key: "cha_id", label: "CHA", width: "120px", render: (row) => row.cha_id || "—" },
                    { key: "bill_reference", label: "Bill Ref", width: "140px" },
                    { key: "bill_date", label: "Bill Date", width: "120px" },
                    { key: "amount", label: "Amount", width: "120px" },
                    { key: "description", label: "Description" },
                    {
                      key: "actions",
                      label: "Actions",
                      width: "160px",
                      render: (row) =>
                        isDraft ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setLineForm({
                                  lineId: row.id,
                                  cost_type: row.cost_type || "FREIGHT",
                                  cha_id: row.cha_id || "",
                                  bill_reference: row.bill_reference || "",
                                  bill_date: row.bill_date || "",
                                  description: row.description || "",
                                  amount: String(row.amount ?? ""),
                                })
                              }
                              className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-900"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteLine(row.id)}
                              className="border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-900"
                            >
                              Delete
                            </button>
                          </div>
                        ) : "—",
                    },
                  ]}
                  rows={detail?.lines ?? []}
                  rowKey={(row) => row.id}
                  emptyMessage="No landed cost lines found."
                />
                <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900">
                  Total Cost: <span className="font-semibold">{totalCost.toFixed(4)}</span>
                </div>
              </ErpSectionCard>

              {isDraft ? (
                <ErpSectionCard eyebrow="Add / Edit Line" title="Maintain landed cost lines">
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    <ErpDenseFormRow label="Cost Type">
                      <select
                        value={lineForm.cost_type}
                        onChange={(event) => setLineForm((current) => ({ ...current, cost_type: event.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      >
                        {COST_TYPES.map((entry) => (
                          <option key={entry} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </select>
                    </ErpDenseFormRow>
                    {lineForm.cost_type === "CHA_CHARGES" ? (
                      <ErpDenseFormRow label="CHA">
                        <select
                          value={lineForm.cha_id}
                          onChange={(event) => setLineForm((current) => ({ ...current, cha_id: event.target.value }))}
                          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        >
                          <option value="">Select CHA</option>
                          {chaRows.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.cha_code || entry.id} | {entry.name || ""}
                            </option>
                          ))}
                        </select>
                      </ErpDenseFormRow>
                    ) : null}
                    <ErpDenseFormRow label="Bill Reference">
                      <input
                        value={lineForm.bill_reference}
                        onChange={(event) => setLineForm((current) => ({ ...current, bill_reference: event.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Bill Date">
                      <input
                        type="date"
                        value={lineForm.bill_date}
                        onChange={(event) => setLineForm((current) => ({ ...current, bill_date: event.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Amount">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={lineForm.amount}
                        onChange={(event) => setLineForm((current) => ({ ...current, amount: event.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Description">
                      <input
                        value={lineForm.description}
                        onChange={(event) => setLineForm((current) => ({ ...current, description: event.target.value }))}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleSaveLine()}
                      className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                    >
                      {lineForm.lineId ? "Update Line" : "Add Line"}
                    </button>
                    {lineForm.lineId ? (
                      <button
                        type="button"
                        onClick={() => setLineForm(createEmptyLineForm())}
                        className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                      >
                        Cancel Edit
                      </button>
                    ) : null}
                  </div>
                </ErpSectionCard>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </ErpScreenScaffold>
  );
}
