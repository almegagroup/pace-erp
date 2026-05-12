import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { listMaterials, listStorageLocations, listVendors } from "../../om/omApi.js";
import {
  addQATestLine,
  assignQAOfficer,
  deleteQATestLine,
  getGRN,
  getQADocument,
  submitUsageDecision,
  updateQATestLine,
} from "../procurementApi.js";

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "DECISION_MADE":
      return "emerald";
    case "IN_PROGRESS":
      return "sky";
    case "PENDING":
    default:
      return "amber";
  }
}

function passFailTone(value) {
  switch (String(value || "").toUpperCase()) {
    case "PASS":
      return "bg-emerald-100 text-emerald-800";
    case "FAIL":
      return "bg-rose-100 text-rose-800";
    case "PENDING":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function buildBlankTestForm() {
  return {
    test_type: "VISUAL",
    test_parameter: "",
    result_value: "",
    pass_fail: "PENDING",
    remarks: "",
  };
}

function buildDecisionRow() {
  return {
    key:
      typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    quantity: "",
    usage_decision: "RELEASE",
    storage_location_id: "",
    remarks: "",
  };
}

export default function QADocumentPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const { runtimeContext, shellProfile } = useMenu();
  const [detail, setDetail] = useState(null);
  const [grn, setGrn] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [storageLocations, setStorageLocations] = useState([]);
  const [testForm, setTestForm] = useState(buildBlankTestForm());
  const [editingLineId, setEditingLineId] = useState("");
  const [editingLineForm, setEditingLineForm] = useState(buildBlankTestForm());
  const [decisionRows, setDecisionRows] = useState([buildDecisionRow()]);
  const [assignToUser, setAssignToUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const roleCode = shellProfile?.roleCode || "";
  const myAssignee = shellProfile?.userCode || "";
  const publicStatus = String(detail?.public_status || "").toUpperCase();
  const isMutable = publicStatus === "PENDING" || publicStatus === "IN_PROGRESS";
  const canAssign = publicStatus === "PENDING";
  const canSeeForReprocess = roleCode === "QA_MGR" || roleCode === "SA";
  const totalQty = Number(detail?.total_qty ?? 0);

  const materialMap = useMemo(
    () => new Map(materials.map((row) => [row.id, row])),
    [materials]
  );
  const vendorMap = useMemo(
    () => new Map(vendors.map((row) => [row.id, row])),
    [vendors]
  );
  const storageLocationMap = useMemo(
    () => new Map(storageLocations.map((row) => [row.id, row])),
    [storageLocations]
  );
  const allocatedQty = useMemo(
    () =>
      Number(
        decisionRows
          .reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)
          .toFixed(6)
      ),
    [decisionRows]
  );
  const remainingQty = Number((totalQty - allocatedQty).toFixed(6));
  const decisionSubmitDisabled =
    !isMutable ||
    saving ||
    decisionRows.length === 0 ||
    Number(allocatedQty.toFixed(6)) !== Number(totalQty.toFixed(6)) ||
    decisionRows.some(
      (row) =>
        !(Number(row.quantity) > 0) ||
        !String(row.usage_decision || "").trim() ||
        !String(row.storage_location_id || "").trim()
    );

  async function loadDetail() {
    if (!id) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const qaData = await getQADocument(id);
      const companyId = qaData?.company_id || runtimeContext?.selectedCompanyId || undefined;
      const [grnData, materialData, vendorData, storageData] = await Promise.all([
        qaData?.grn_id ? getGRN(qaData.grn_id).catch(() => null) : Promise.resolve(null),
        listMaterials({ limit: 200, offset: 0 }),
        listVendors({ limit: 200, offset: 0 }),
        listStorageLocations({ company_id: companyId }),
      ]);

      setDetail(qaData);
      setGrn(grnData);
      setMaterials(Array.isArray(materialData?.data) ? materialData.data : []);
      setVendors(Array.isArray(vendorData?.data) ? vendorData.data : []);
      setStorageLocations(Array.isArray(storageData) ? storageData : []);
      setAssignToUser(String(qaData?.assigned_to || ""));
      setDecisionRows([buildDecisionRow()]);
      setEditingLineId("");
      setEditingLineForm(buildBlankTestForm());
      setTestForm(buildBlankTestForm());
    } catch (loadError) {
      setDetail(null);
      setGrn(null);
      setMaterials([]);
      setVendors([]);
      setStorageLocations([]);
      setError(
        loadError instanceof Error ? loadError.message : "PROCUREMENT_QA_DOCUMENT_FAILED"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id, runtimeContext?.selectedCompanyId]);

  async function handleAssign(nextAssignedTo) {
    if (!detail?.id || !nextAssignedTo) {
      setError("Assignee is required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await assignQAOfficer(detail.id, { assigned_to: nextAssignedTo });
      setNotice("QA document assignment updated.");
      await loadDetail();
    } catch (assignError) {
      setError(
        assignError instanceof Error ? assignError.message : "PROCUREMENT_QA_ASSIGN_FAILED"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAddTestLine() {
    if (!detail?.id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await addQATestLine(detail.id, testForm);
      setTestForm(buildBlankTestForm());
      setNotice("QA test line added.");
      await loadDetail();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "PROCUREMENT_QA_TEST_CREATE_FAILED"
      );
    } finally {
      setSaving(false);
    }
  }

  function startEditingLine(line) {
    setEditingLineId(line.id);
    setEditingLineForm({
      test_type: line.test_type || "OTHER",
      test_parameter: line.test_parameter || "",
      result_value: line.test_result || "",
      pass_fail: line.pass_fail || "PENDING",
      remarks: line.remarks || "",
    });
  }

  async function handleSaveEditedLine() {
    if (!detail?.id || !editingLineId) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateQATestLine(detail.id, editingLineId, {
        result_value: editingLineForm.result_value,
        pass_fail: editingLineForm.pass_fail,
        remarks: editingLineForm.remarks,
      });
      setEditingLineId("");
      setEditingLineForm(buildBlankTestForm());
      setNotice("QA test line updated.");
      await loadDetail();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "PROCUREMENT_QA_TEST_UPDATE_FAILED"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLine(lineId) {
    if (!detail?.id || !window.confirm("Delete this test line?")) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await deleteQATestLine(detail.id, lineId);
      setNotice("QA test line deleted.");
      await loadDetail();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "PROCUREMENT_QA_TEST_DELETE_FAILED"
      );
    } finally {
      setSaving(false);
    }
  }

  function updateDecisionRow(key, patch) {
    setDecisionRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  }

  function addDecisionRow() {
    setDecisionRows((current) => [...current, buildDecisionRow()]);
  }

  function removeDecisionRow(key) {
    setDecisionRows((current) =>
      current.length === 1 ? current : current.filter((row) => row.key !== key)
    );
  }

  async function handleSubmitDecision() {
    if (!detail?.id || decisionSubmitDisabled) {
      return;
    }
    const confirmed = window.confirm(
      "This will post stock movements. Cannot be undone."
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await submitUsageDecision(detail.id, {
        decision_lines: decisionRows.map((row) => ({
          quantity: Number(row.quantity),
          usage_decision: row.usage_decision,
          storage_location_id: row.storage_location_id,
          remarks: row.remarks || undefined,
        })),
      });
      setDetail((current) =>
        current
          ? {
              ...current,
              ...(response?.qa_document ?? {}),
              decision_lines: response?.decision_lines ?? [],
              public_status:
                response?.qa_document?.public_status || "DECISION_MADE",
            }
          : current
      );
      setDecisionRows([]);
      setNotice("Usage decision posted successfully.");
      await loadDetail();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "PROCUREMENT_QA_DECISION_FAILED"
      );
    } finally {
      setSaving(false);
    }
  }

  const material = materialMap.get(detail?.material_id);
  const vendor = vendorMap.get(detail?.vendor_id);
  const primaryStorageLocation =
    storageLocationMap.get(grn?.lines?.[0]?.storage_location_id) ||
    storageLocationMap.get(detail?.storage_location_id);

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Inward QA Document"
      notices={[
        ...(error ? [{ key: "qa-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "qa-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "back",
          label: "Back",
          tone: "neutral",
          onClick: () => {
            try {
              popScreen();
            } catch {
              navigate("/dashboard/procurement/qa-queue");
            }
          },
        },
        ...(canAssign
          ? [
              {
                key: "assign-me",
                label: saving ? "Assigning..." : "Assign To Me",
                tone: "primary",
                onClick: () => void handleAssign(myAssignee),
                disabled: saving || !myAssignee,
              },
            ]
          : []),
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading QA document..." : "QA document is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={detail.qa_doc_number || "QA Document"}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="QA Status" value={detail.public_status} tone={statusTone(detail.public_status)} />
              <ErpFieldPreview label="GRN Number" value={grn?.grn_number || detail.grn_id || "—"} />
              <ErpFieldPreview label="Vendor" value={vendor?.vendor_name || vendor?.vendor_code || detail.vendor_id || "—"} />
              <ErpFieldPreview label="Material" value={material?.material_name || material?.material_code || detail.material_id || "—"} />
              <ErpFieldPreview label="Received Qty" value={`${detail.total_qty || 0} ${detail.uom_code || ""}`.trim()} />
              <ErpFieldPreview label="Assigned To" value={detail.assigned_to || "Unassigned"} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="GRN Summary" title="Receipt context">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <ErpFieldPreview label="Storage Location" value={primaryStorageLocation?.storage_location_name || primaryStorageLocation?.storage_location_code || grn?.lines?.[0]?.storage_location_id || "—"} />
              <ErpFieldPreview label="Stock Type" value={grn?.lines?.[0]?.target_stock_type || "QUALITY_INSPECTION"} />
              <ErpFieldPreview label="Plant" value={detail.plant_id || "—"} />
              <ErpFieldPreview label="GRN Posting Date" value={grn?.posting_date || "—"} />
              <ErpFieldPreview label="Created At" value={detail.created_at || "—"} />
            </div>
          </ErpSectionCard>

          {canAssign ? (
            <ErpSectionCard eyebrow="Assignment" title="Assign QA ownership">
              <div className="grid gap-3 lg:grid-cols-[220px_220px_auto]">
                <ErpDenseFormRow label="Assign To User">
                  <input
                    value={assignToUser}
                    onChange={(event) => setAssignToUser(event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    placeholder="User code"
                  />
                </ErpDenseFormRow>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={saving || !assignToUser.trim()}
                    onClick={() => void handleAssign(assignToUser.trim())}
                    className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50"
                  >
                    Assign To User
                  </button>
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={saving || !myAssignee}
                    onClick={() => void handleAssign(myAssignee)}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                  >
                    Assign To Me
                  </button>
                </div>
              </div>
            </ErpSectionCard>
          ) : null}

          <ErpSectionCard eyebrow="Test Lines" title="Inspection checks">
            <div className="grid gap-3">
              <ErpDenseGrid
                columns={[
                  { key: "line_number", label: "Line", width: "70px" },
                  { key: "test_type", label: "Type", width: "100px" },
                  { key: "test_parameter", label: "Parameter" },
                  { key: "test_result", label: "Result", width: "150px" },
                  {
                    key: "pass_fail",
                    label: "Pass/Fail",
                    width: "110px",
                    render: (row) => (
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${passFailTone(row.pass_fail)}`}
                      >
                        {row.pass_fail}
                      </span>
                    ),
                  },
                  { key: "remarks", label: "Remarks", width: "180px" },
                  {
                    key: "actions",
                    label: "Actions",
                    width: "170px",
                    render: (row) =>
                      isMutable ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => startEditingLine(row)}
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
                      ) : (
                        "—"
                      ),
                  },
                ]}
                rows={Array.isArray(detail.test_lines) ? detail.test_lines : []}
                rowKey={(row) => row.id}
                emptyMessage="No QA test lines recorded yet."
              />

              {isMutable ? (
                <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="text-sm font-semibold text-slate-900">
                    {editingLineId ? "Edit Test Line" : "Add Test Line"}
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <ErpDenseFormRow label="Test Type">
                      <select
                        value={editingLineId ? editingLineForm.test_type : testForm.test_type}
                        onChange={(event) =>
                          editingLineId
                            ? setEditingLineForm((current) => ({
                                ...current,
                                test_type: event.target.value,
                              }))
                            : setTestForm((current) => ({
                                ...current,
                                test_type: event.target.value,
                              }))
                        }
                        disabled={Boolean(editingLineId)}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100"
                      >
                        {["VISUAL", "MCT", "LAB", "OTHER"].map((entry) => (
                          <option key={entry} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </select>
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Test Parameter">
                      <input
                        value={
                          editingLineId
                            ? editingLineForm.test_parameter
                            : testForm.test_parameter
                        }
                        onChange={(event) =>
                          editingLineId
                            ? setEditingLineForm((current) => ({
                                ...current,
                                test_parameter: event.target.value,
                              }))
                            : setTestForm((current) => ({
                                ...current,
                                test_parameter: event.target.value,
                              }))
                        }
                        disabled={Boolean(editingLineId)}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Result Value">
                      <input
                        value={
                          editingLineId ? editingLineForm.result_value : testForm.result_value
                        }
                        onChange={(event) =>
                          editingLineId
                            ? setEditingLineForm((current) => ({
                                ...current,
                                result_value: event.target.value,
                              }))
                            : setTestForm((current) => ({
                                ...current,
                                result_value: event.target.value,
                              }))
                        }
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Pass / Fail">
                      <select
                        value={
                          editingLineId ? editingLineForm.pass_fail : testForm.pass_fail
                        }
                        onChange={(event) =>
                          editingLineId
                            ? setEditingLineForm((current) => ({
                                ...current,
                                pass_fail: event.target.value,
                              }))
                            : setTestForm((current) => ({
                                ...current,
                                pass_fail: event.target.value,
                              }))
                        }
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      >
                        {["PASS", "FAIL", "PENDING"].map((entry) => (
                          <option key={entry} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </select>
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Remarks">
                      <input
                        value={editingLineId ? editingLineForm.remarks : testForm.remarks}
                        onChange={(event) =>
                          editingLineId
                            ? setEditingLineForm((current) => ({
                                ...current,
                                remarks: event.target.value,
                              }))
                            : setTestForm((current) => ({
                                ...current,
                                remarks: event.target.value,
                              }))
                        }
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                  </div>
                  <div className="flex gap-2">
                    {editingLineId ? (
                      <>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleSaveEditedLine()}
                          className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                        >
                          Save Test Line
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLineId("");
                            setEditingLineForm(buildBlankTestForm());
                          }}
                          className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          saving ||
                          !String(testForm.test_parameter || "").trim()
                        }
                        onClick={() => void handleAddTestLine()}
                        className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                      >
                        Add Test
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </ErpSectionCard>

          {isMutable ? (
            <ErpSectionCard
              eyebrow="Usage Decision"
              title={`Usage Decision — Total Qty: ${totalQty} ${detail.uom_code || ""}`.trim()}
            >
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-semibold text-slate-900">
                    Allocated: {allocatedQty} / Total: {totalQty}
                  </span>
                  <span
                    className={
                      remainingQty === 0 ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"
                    }
                  >
                    Remaining: {remainingQty}
                  </span>
                </div>

                {decisionRows.map((row, index) => {
                  const isReject = String(row.usage_decision || "").toUpperCase() === "REJECT";
                  const decisionOptions = [
                    "RELEASE",
                    "BLOCK",
                    "REJECT",
                    "SCRAP",
                    ...(canSeeForReprocess ? ["FOR_REPROCESS"] : []),
                  ];
                  return (
                    <div
                      key={row.key}
                      className={`grid gap-3 rounded border p-3 ${
                        isReject
                          ? "border-amber-300 bg-amber-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">
                          Split {index + 1}
                        </div>
                        <button
                          type="button"
                          disabled={decisionRows.length === 1}
                          onClick={() => removeDecisionRow(row.key)}
                          className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-900 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <ErpDenseFormRow label="Quantity">
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={row.quantity}
                            onChange={(event) =>
                              updateDecisionRow(row.key, { quantity: event.target.value })
                            }
                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                        </ErpDenseFormRow>
                        <ErpDenseFormRow label="Usage Decision">
                          <select
                            value={row.usage_decision}
                            onChange={(event) =>
                              updateDecisionRow(row.key, {
                                usage_decision: event.target.value,
                              })
                            }
                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          >
                            {decisionOptions.map((entry) => (
                              <option key={entry} value={entry}>
                                {entry}
                              </option>
                            ))}
                          </select>
                        </ErpDenseFormRow>
                        <ErpDenseFormRow label="Storage Location">
                          <input
                            value={row.storage_location_id}
                            onChange={(event) =>
                              updateDecisionRow(row.key, {
                                storage_location_id: event.target.value,
                              })
                            }
                            list="qa-storage-location-options"
                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                        </ErpDenseFormRow>
                        <ErpDenseFormRow label="Remarks">
                          <input
                            value={row.remarks}
                            onChange={(event) =>
                              updateDecisionRow(row.key, { remarks: event.target.value })
                            }
                            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                          />
                        </ErpDenseFormRow>
                      </div>
                      {isReject ? (
                        <div className="text-sm font-medium text-amber-900">
                          Stock will be blocked. Available for RTV.
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                <datalist id="qa-storage-location-options">
                  {storageLocations.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.storage_location_code || row.storage_location_name || row.id}
                    </option>
                  ))}
                </datalist>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={addDecisionRow}
                    className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  >
                    Add Split
                  </button>
                  <button
                    type="button"
                    disabled={decisionSubmitDisabled}
                    onClick={() => void handleSubmitDecision()}
                    className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-50"
                  >
                    Submit Decision
                  </button>
                </div>
              </div>
            </ErpSectionCard>
          ) : (
            <ErpSectionCard eyebrow="Decision Result" title="Posted stock movement summary">
              <ErpDenseGrid
                columns={[
                  { key: "decision_line_number", label: "Line", width: "70px" },
                  { key: "usage_decision", label: "Decision", width: "140px" },
                  { key: "decision_qty", label: "Quantity", width: "120px" },
                  { key: "movement_type_code", label: "Movement", width: "120px" },
                  { key: "posting_status", label: "Posting", width: "110px" },
                  { key: "remarks", label: "Remarks" },
                ]}
                rows={Array.isArray(detail.decision_lines) ? detail.decision_lines : []}
                rowKey={(row) => row.id}
                getRowProps={(row) => ({
                  className:
                    String(row.usage_decision || "").toUpperCase() === "REJECT"
                      ? "bg-amber-50"
                      : undefined,
                })}
                emptyMessage="No decision lines found."
              />
            </ErpSectionCard>
          )}
        </div>
      )}
    </ErpScreenScaffold>
  );
}
