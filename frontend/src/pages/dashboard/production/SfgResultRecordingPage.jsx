import { Fragment, useEffect, useEffectEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import {
  createQaCategoryTestConfig,
  createQaTestMethod,
  deleteQaCategoryTestConfig,
  listQaCategoryTestConfig,
  listQaTestMethods,
  updateQaCategoryTestConfig,
} from "../procurement/procurementApi.js";
import {
  addSfgQaTestLine,
  getSfgQaDocument,
  listSfgQaDocuments,
  submitSfgQaDecision,
  updateSfgQaTestLine,
} from "./prodApi.js";

const LIMIT = 50;
const QA_MANAGER_ROLE_CODES = new Set(["SA", "DIRECTOR", "L4_MANAGER", "L3_MANAGER", "L2_MANAGER"]);

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "IN_PROGRESS":
      return "bg-sky-100 text-sky-800";
    case "DECISION_MADE":
      return "bg-emerald-100 text-emerald-800";
    case "PENDING":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function normalizeSearch(text) {
  return String(text || "").trim().toLowerCase();
}

function computePassFail(resultValue, lsl, usl) {
  const numericResult = Number(resultValue);
  const hasLimits = lsl !== null && lsl !== undefined || usl !== null && usl !== undefined;
  if (!String(resultValue ?? "").trim() || !Number.isFinite(numericResult) || !hasLimits) {
    return "PENDING";
  }
  const belowLsl = lsl !== null && lsl !== undefined && numericResult < Number(lsl);
  const aboveUsl = usl !== null && usl !== undefined && numericResult > Number(usl);
  return belowLsl || aboveUsl ? "FAIL" : "PASS";
}

export default function SfgResultRecordingPage() {
  const { runtimeContext, shellProfile } = useMenu();
  const isMulti = runtimeContext?.workspaceMode === "MULTI";
  const [selectedCompanyId, setSelectedCompanyId] = useState(runtimeContext?.selectedCompanyId || "");
  const companyId = isMulti ? selectedCompanyId : runtimeContext?.selectedCompanyId || "";
  const availableCompanies = Array.isArray(runtimeContext?.availableCompanies)
    ? runtimeContext.availableCompanies
    : [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [expandedRowId, setExpandedRowId] = useState("");
  const [error, setError] = useState("");

  const queueQuery = useQuery({
    queryKey: ["production", "sfg-qa-queue", companyId || null, statusFilter, dateFrom, dateTo],
    queryFn: () =>
      listSfgQaDocuments({
        company_id: companyId || undefined,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: 200,
      }),
    enabled: Boolean(companyId),
  });

  const rows = useMemo(() => (Array.isArray(queueQuery.data) ? queueQuery.data : []), [queueQuery.data]);
  const loading = queueQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void queueQuery.refetch(),
    },
  });

  const filteredRows = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) return rows;
    return rows.filter((row) => {
      const material = row.material || {};
      const haystack = [
        row.po_number,
        row.batch_number,
        material.material_name,
        material.pace_code,
        row.stroke_number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, search]);

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const safePage = Math.min(page, totalPages);
  const currentError = error || queueQuery.error?.message || "";
  const pageRows = useMemo(
    () => filteredRows.slice((safePage - 1) * LIMIT, safePage * LIMIT),
    [filteredRows, safePage],
  );
  const startIndex = total === 0 ? 0 : (safePage - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(safePage * LIMIT, total);

  function toggleExpand(rowId) {
    setExpandedRowId((current) => (current === rowId ? "" : rowId));
  }

  const columns = [
    { key: "po_number", label: "PO Number", width: "140px" },
    { key: "batch_number", label: "Batch Number", width: "150px" },
    { key: "prodshade", label: "Prodshade" },
    { key: "category", label: "Category", width: "180px" },
    { key: "stroke", label: "Stroke", width: "120px" },
    { key: "verified_at", label: "Verified Date", width: "150px" },
    { key: "status", label: "Recording Status", width: "150px" },
    { key: "expand", label: "", width: "40px" },
  ];

  return (
    <ErpMasterListTemplate
      eyebrow="Production"
      title="SFG Result Recording"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void queueQuery.refetch(),
        },
      ]}
      notices={[
        ...(currentError ? [{ key: "sfg-qa-queue-error", tone: "error", message: currentError }] : []),
      ]}
      filterSection={{
        eyebrow: "Queue Filters",
        title: "Verified Process POs pending or completed result recording",
        children: (
          <div className="flex flex-wrap items-end gap-3">
            {isMulti ? (
              <label className="grid w-56 gap-1 text-[11px] font-medium text-slate-600">
                Company
                <select
                  value={selectedCompanyId}
                  onChange={(event) => {
                    setSelectedCompanyId(event.target.value);
                    setPage(1);
                  }}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select company...</option>
                  {availableCompanies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.company_code} | {company.company_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <QuickFilterInput
              label="Search"
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              primaryFocus
              placeholder="Search PO, batch, prodshade or stroke"
              className="w-64"
            />
            <label className="grid w-40 gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="ALL">ALL</option>
                <option value="PENDING">PENDING</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="DECISION_MADE">DECISION_MADE</option>
              </select>
            </label>
            <label className="grid w-36 gap-1 text-[11px] font-medium text-slate-600">
              Verified From
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid w-36 gap-1 text-[11px] font-medium text-slate-600">
              Verified To
              <input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "Result Recording Queue",
        title: loading ? "Loading SFG QA queue" : `${total} verified batch row${total === 1 ? "" : "s"}`,
        children: !companyId ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            {isMulti ? "Select a company to load the SFG result recording queue." : "No company resolved for this session."}
          </div>
        ) : (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={safePage}
              setPage={setPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={total}
            />
            <div className="overflow-auto border border-slate-300 bg-white">
              <table className="min-w-full border-collapse text-[12px]">
                <thead className="bg-slate-100 text-left text-[10px] uppercase tracking-[0.08em] text-slate-600">
                  <tr>
                    {columns.map((column) => (
                      <th key={column.key} className="border-b border-slate-200 px-2 py-1.5 font-semibold" style={{ width: column.width }}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length} className="px-3 py-6 text-left text-sm text-slate-500">
                        {loading ? "Loading SFG result recording queue..." : "No verified Process PO matched the current filter."}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row) => {
                      const material = row.material || {};
                      const isExpanded = expandedRowId === row.id;
                      return (
                        <Fragment key={row.id}>
                          <tr
                            onClick={() => toggleExpand(row.id)}
                            className="cursor-pointer border-b border-slate-100 bg-white hover:bg-sky-50"
                          >
                            <td className="px-2 py-1.5 font-mono font-semibold text-sky-700">{row.po_number || "--"}</td>
                            <td className="px-2 py-1.5 font-mono text-slate-600">{row.batch_number || "--"}</td>
                            <td className="px-2 py-1.5">{material.material_name || material.pace_code || "--"}</td>
                            <td className="px-2 py-1.5">{material.material_category || "--"}</td>
                            <td className="px-2 py-1.5">{row.stroke_number || "--"}</td>
                            <td className="px-2 py-1.5">{row.verified_at ? String(row.verified_at).slice(0, 10) : "--"}</td>
                            <td className="px-2 py-1.5">
                              <span
                                className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusTone(row.public_status)}`}
                              >
                                {row.public_status}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-center text-slate-400">{isExpanded ? "^" : "v"}</td>
                          </tr>
                          {isExpanded ? (
                            <tr className="bg-slate-50">
                              <td colSpan={columns.length} className="border-t border-slate-200 p-0">
                                <SfgQaExpandedPanel
                                  row={row}
                                  companyId={companyId}
                                  roleCode={shellProfile?.roleCode || ""}
                                  onChanged={() => {
                                    void queueQuery.refetch();
                                  }}
                                  onCollapse={() => setExpandedRowId("")}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ),
      }}
    />
  );
}

function SfgQaExpandedPanel({ row, companyId, roleCode, onChanged, onCollapse }) {
  const queryClient = useQueryClient();
  const canManage = QA_MANAGER_ROLE_CODES.has(roleCode);
  const materialCategory = row.material?.material_category || "";

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resultDrafts, setResultDrafts] = useState({});
  const [limitDrafts, setLimitDrafts] = useState({});
  const [addMethodForm, setAddMethodForm] = useState({ group: "", mode: "existing", methodId: "", methodName: "", lsl: "", usl: "" });

  const detailQuery = useQuery({
    queryKey: ["production", "sfg-qa-detail", row.id],
    queryFn: () => getSfgQaDocument(row.id),
  });
  const categoryConfigQuery = useQuery({
    queryKey: ["production", "sfg-qa-category-config", companyId, materialCategory],
    queryFn: () => listQaCategoryTestConfig({ company_id: companyId, material_category: materialCategory }),
    enabled: Boolean(companyId && materialCategory),
  });
  const mctMethodsQuery = useQuery({
    queryKey: ["production", "sfg-qa-test-methods", companyId, "MCT"],
    queryFn: () => listQaTestMethods({ company_id: companyId, test_group: "MCT" }),
    enabled: Boolean(companyId),
  });
  const ctMethodsQuery = useQuery({
    queryKey: ["production", "sfg-qa-test-methods", companyId, "CT"],
    queryFn: () => listQaTestMethods({ company_id: companyId, test_group: "CT" }),
    enabled: Boolean(companyId),
  });
  const othrMethodsQuery = useQuery({
    queryKey: ["production", "sfg-qa-test-methods", companyId, "OTHR"],
    queryFn: () => listQaTestMethods({ company_id: companyId, test_group: "OTHR" }),
    enabled: Boolean(companyId),
  });

  const detail = detailQuery.data ?? null;
  const categoryConfigs = useMemo(
    () => (Array.isArray(categoryConfigQuery.data) ? categoryConfigQuery.data : []),
    [categoryConfigQuery.data],
  );
  const mctMethods = useMemo(
    () => (Array.isArray(mctMethodsQuery.data) ? mctMethodsQuery.data : []),
    [mctMethodsQuery.data],
  );
  const ctMethods = useMemo(
    () => (Array.isArray(ctMethodsQuery.data) ? ctMethodsQuery.data : []),
    [ctMethodsQuery.data],
  );
  const othrMethods = useMemo(
    () => (Array.isArray(othrMethodsQuery.data) ? othrMethodsQuery.data : []),
    [othrMethodsQuery.data],
  );

  const loading = detailQuery.isLoading;
  const storageLocationLabel = detail?.storage_location?.name
    || detail?.storage_location?.code
    || detail?.storage_location_id
    || "--";

  const testLines = Array.isArray(detail?.test_lines) ? detail.test_lines : [];
  const totalQty = Number(detail?.total_qty ?? row.total_qty ?? 0);
  const publicStatus = String(detail?.public_status ?? row.public_status ?? "").toUpperCase();
  const isMutable = ["PENDING", "IN_PROGRESS"].includes(publicStatus);

  const mctConfigs = useMemo(() => categoryConfigs.filter((c) => c.qa_test_method?.test_group === "MCT"), [categoryConfigs]);
  const ctConfigs = useMemo(() => categoryConfigs.filter((c) => c.qa_test_method?.test_group === "CT"), [categoryConfigs]);
  const othrConfigs = useMemo(() => categoryConfigs.filter((c) => c.qa_test_method?.test_group === "OTHR"), [categoryConfigs]);

  function testLineForMethod(methodId) {
    return testLines.find((line) => line.test_method_id === methodId);
  }

  function currentResultValue(methodId) {
    const draft = resultDrafts[methodId];
    if (draft !== undefined) return draft;
    return testLineForMethod(methodId)?.test_result ?? "";
  }

  const failedMctMethods = mctConfigs.filter(
    (cfg) => computePassFail(currentResultValue(cfg.test_method_id), cfg.lsl, cfg.usl) === "FAIL",
  );
  const allMctFilled = mctConfigs.every((cfg) => String(currentResultValue(cfg.test_method_id)).trim() !== "");

  function toast(msg, tone = "success") {
    if (tone === "error") setError(msg);
    else setNotice(msg);
    setTimeout(() => {
      setError("");
      setNotice("");
    }, 3500);
  }

  async function refreshDetail() {
    await queryClient.invalidateQueries({ queryKey: ["production", "sfg-qa-detail", row.id] });
    onChanged?.();
  }

  async function handleResultChange(config, value) {
    setResultDrafts((current) => ({ ...current, [config.test_method_id]: value }));
  }

  async function handleResultSave(config) {
    const value = resultDrafts[config.test_method_id];
    if (value === undefined) return;
    const existingLine = testLineForMethod(config.test_method_id);
    const testType = ["OTHR", "CT"].includes(config.qa_test_method?.test_group) ? "OTHER" : "MCT";
    setSaving(true);
    setError("");
    try {
      if (existingLine) {
        await updateSfgQaTestLine(row.id, existingLine.id, { result_value: value });
      } else {
        await addSfgQaTestLine(row.id, {
          test_type: testType,
          test_parameter: config.qa_test_method?.method_name || "",
          result_value: value,
          test_method_id: config.test_method_id,
          lsl: config.lsl,
          usl: config.usl,
        });
      }
      await refreshDetail();
    } catch (saveError) {
      toast(saveError instanceof Error ? saveError.message : "SFG_QA_TEST_SAVE_FAILED", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMethod(group) {
    const form = addMethodForm;
    if (form.group !== group) return;
    setSaving(true);
    setError("");
    try {
      let testMethodId = form.methodId;
      if (form.mode === "new") {
        if (!form.methodName.trim()) {
          throw new Error("Method name is required");
        }
        const created = await createQaTestMethod({ company_id: companyId, test_group: group, method_name: form.methodName.trim() });
        testMethodId = created?.id;
      }
      if (!testMethodId) {
        throw new Error("Select or name a method");
      }
      await createQaCategoryTestConfig({
        company_id: companyId,
        material_category: materialCategory,
        test_method_id: testMethodId,
        lsl: form.lsl === "" ? null : Number(form.lsl),
        usl: form.usl === "" ? null : Number(form.usl),
      });
      setAddMethodForm({ group: "", mode: "existing", methodId: "", methodName: "", lsl: "", usl: "" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["production", "sfg-qa-category-config", companyId, materialCategory] }),
        queryClient.invalidateQueries({ queryKey: ["production", "sfg-qa-test-methods", companyId, group] }),
      ]);
      toast(`Method added to ${materialCategory} (${group}).`);
    } catch (saveError) {
      toast(saveError instanceof Error ? saveError.message : "SFG_QA_METHOD_ADD_FAILED", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleLimitSave(config, field) {
    const draft = limitDrafts[config.id];
    if (!draft || draft[field] === undefined) return;
    setSaving(true);
    setError("");
    try {
      await updateQaCategoryTestConfig(config.id, { [field]: draft[field] === "" ? null : Number(draft[field]) });
      setLimitDrafts((current) => {
        const next = { ...current };
        delete next[config.id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["production", "sfg-qa-category-config", companyId, materialCategory] });
    } catch (saveError) {
      toast(saveError instanceof Error ? saveError.message : "SFG_QA_LIMIT_UPDATE_FAILED", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMethod(config) {
    const confirmed = await openActionConfirm({
      eyebrow: "Test Method Config",
      title: `Remove "${config.qa_test_method?.method_name}" from ${materialCategory}?`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await deleteQaCategoryTestConfig(config.id);
      await queryClient.invalidateQueries({ queryKey: ["production", "sfg-qa-category-config", companyId, materialCategory] });
      toast("Method removed from category.");
    } catch (deleteError) {
      toast(deleteError instanceof Error ? deleteError.message : "SFG_QA_METHOD_DELETE_FAILED", "error");
    } finally {
      setSaving(false);
    }
  }

  const resultSubmitDisabled =
    !isMutable ||
    saving ||
    !allMctFilled;

  async function handleSubmitDecision() {
    if (resultSubmitDisabled) return;

    if (failedMctMethods.length > 0) {
      const names = failedMctMethods.map((cfg) => cfg.qa_test_method?.method_name).filter(Boolean).join(", ");
      const proceedDespiteFailure = await openActionConfirm({
        eyebrow: "SFG Result Recording",
        title: `${failedMctMethods.length} mandatory test${failedMctMethods.length === 1 ? "" : "s"} failed`,
        message: `Failed: ${names}. Choose "Change Result" to go back and correct the value(s), or "Continue Anyway" to submit the result recording as entered.`,
        confirmLabel: "Continue Anyway",
        cancelLabel: "Change Result",
      });
      if (!proceedDespiteFailure) return;
    }

    const confirmed = await openActionConfirm({
      eyebrow: "SFG Result Recording",
      title: "Submit result recording?",
      message: "This records the SFG QA test result for the verified batch. It does not post a second stock movement.",
      confirmLabel: "Submit",
    });
    if (!confirmed) return;

    setSaving(true);
    setError("");
    try {
      await submitSfgQaDecision(row.id, {});
      await refreshDetail();
      toast("SFG QA result recorded.");
    } catch (submitError) {
      toast(submitError instanceof Error ? submitError.message : "SFG_QA_RESULT_FAILED", "error");
    } finally {
      setSaving(false);
    }
  }

  const canSaveMethodNow = Boolean(addMethodForm.group) && !saving;

  const handleExpandedPanelKeyDown = useEffectEvent((event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCollapse?.();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (canSaveMethodNow) {
        void handleAddMethod(addMethodForm.group);
      } else if (!resultSubmitDisabled) {
        void handleSubmitDecision();
      }
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleExpandedPanelKeyDown);
    return () => window.removeEventListener("keydown", handleExpandedPanelKeyDown);
  }, []);

  function renderMethodGroup(group, configs, methodPool) {
    const isAddingThisGroup = addMethodForm.group === group;
    return (
      <div className="grid gap-2 rounded border border-slate-200 bg-white p-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">
            {group === "MCT"
              ? "MCT (mandatory)"
              : group === "CT"
              ? "Concrete Trial (optional)"
              : "OTHR (optional)"}
          </span>
          <button
            type="button"
            onClick={() => setAddMethodForm(isAddingThisGroup ? { group: "", mode: "existing", methodId: "", methodName: "", lsl: "", usl: "" } : { group, mode: "existing", methodId: "", methodName: "", lsl: "", usl: "" })}
            className="text-[11px] font-semibold text-sky-700 hover:underline"
          >
            {isAddingThisGroup ? "Cancel" : "+ Add Method"}
          </button>
        </div>

        {configs.length === 0 ? (
          <p className="text-[11px] text-slate-400">No methods configured yet for this category.</p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
                <th className="py-1">Method</th>
                <th className="py-1">LSL</th>
                <th className="py-1">USL</th>
                <th className="py-1">Result</th>
                {canManage ? <th className="py-1"></th> : null}
              </tr>
            </thead>
            <tbody>
              {configs.map((cfg) => {
                const line = testLineForMethod(cfg.test_method_id);
                const draftValue = resultDrafts[cfg.test_method_id] ?? line?.test_result ?? "";
                const canDelete = canManage && group === "MCT" && !line?.test_result;
                return (
                  <tr key={cfg.id} className="border-t border-slate-100">
                    <td className="py-1 pr-2">{cfg.qa_test_method?.method_name}</td>
                    <td className="py-1 pr-2">
                      {canManage ? (
                        <input
                          type="number"
                          value={limitDrafts[cfg.id]?.lsl ?? cfg.lsl ?? ""}
                          onChange={(event) =>
                            setLimitDrafts((current) => ({ ...current, [cfg.id]: { ...current[cfg.id], lsl: event.target.value } }))
                          }
                          onBlur={() => void handleLimitSave(cfg, "lsl")}
                          className="h-7 w-16 border border-slate-300 bg-white px-1 text-[12px] outline-none focus:border-sky-500"
                        />
                      ) : (
                        cfg.lsl ?? "--"
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      {canManage ? (
                        <input
                          type="number"
                          value={limitDrafts[cfg.id]?.usl ?? cfg.usl ?? ""}
                          onChange={(event) =>
                            setLimitDrafts((current) => ({ ...current, [cfg.id]: { ...current[cfg.id], usl: event.target.value } }))
                          }
                          onBlur={() => void handleLimitSave(cfg, "usl")}
                          className="h-7 w-16 border border-slate-300 bg-white px-1 text-[12px] outline-none focus:border-sky-500"
                        />
                      ) : (
                        cfg.usl ?? "--"
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        value={draftValue}
                        disabled={!isMutable}
                        onChange={(event) => void handleResultChange(cfg, event.target.value)}
                        onBlur={() => void handleResultSave(cfg)}
                        className="h-7 w-24 border border-slate-300 bg-white px-1.5 text-[12px] text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-100"
                      />
                    </td>
                    {canManage ? (
                      <td className="py-1">
                        <button
                          type="button"
                          disabled={!canDelete}
                          onClick={() => void handleDeleteMethod(cfg)}
                          title={canDelete ? "Remove method" : "Only untested MCT methods can be removed"}
                          className="text-[11px] text-rose-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300"
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {isAddingThisGroup ? (
          <div className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-2 lg:grid-cols-5">
            <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
              Mode
              <select
                value={addMethodForm.mode}
                onChange={(event) => setAddMethodForm((c) => ({ ...c, mode: event.target.value }))}
                className="h-7 border border-slate-300 bg-white px-1.5 text-[12px]"
              >
                <option value="existing">Pick existing</option>
                <option value="new">Type new</option>
              </select>
            </label>
            {addMethodForm.mode === "existing" ? (
              <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
                Method
                <select
                  value={addMethodForm.methodId}
                  onChange={(event) => setAddMethodForm((c) => ({ ...c, methodId: event.target.value }))}
                  className="h-7 border border-slate-300 bg-white px-1.5 text-[12px]"
                >
                  <option value="">Select...</option>
                  {methodPool.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.method_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
                New Method Name
                <input
                  value={addMethodForm.methodName}
                  onChange={(event) => setAddMethodForm((c) => ({ ...c, methodName: event.target.value }))}
                  className="h-7 border border-slate-300 bg-white px-1.5 text-[12px]"
                />
              </label>
            )}
            <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
              LSL
              <input
                type="number"
                value={addMethodForm.lsl}
                onChange={(event) => setAddMethodForm((c) => ({ ...c, lsl: event.target.value }))}
                className="h-7 border border-slate-300 bg-white px-1.5 text-[12px]"
              />
            </label>
            <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
              USL
              <input
                type="number"
                value={addMethodForm.usl}
                onChange={(event) => setAddMethodForm((c) => ({ ...c, usl: event.target.value }))}
                className="h-7 border border-slate-300 bg-white px-1.5 text-[12px]"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleAddMethod(group)}
                className="h-7 border border-sky-300 bg-sky-50 px-2 text-[12px] font-semibold text-sky-900 disabled:opacity-50"
              >
                Save Method
              </button>
              <span className="text-[10px] uppercase tracking-[0.08em] text-slate-400">Ctrl+S</span>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3 bg-white p-3">
      {loading ? (
        <p className="p-4 text-center text-sm text-slate-400">Loading SFG QA detail...</p>
      ) : (
        <>
          <div className="text-[10px] uppercase tracking-[0.08em] text-slate-400">Ctrl+S Save | Esc Collapse</div>
          {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-1.5 text-[12px] text-rose-800">{error}</div> : null}
          {notice ? <div className="border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-800">{notice}</div> : null}

          <div className="grid gap-2 lg:grid-cols-4">
            <ErpDenseFormRow label="Storage Location (auto, read-only)">
              <div className="h-8 flex items-center px-1 text-[12px] text-slate-700">{storageLocationLabel}</div>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Total Qty">
              <div className="h-8 flex items-center px-1 text-[12px] text-slate-700">{totalQty} {row.uom_code || ""}</div>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Recording Status">
              <div className="h-8 flex items-center px-1 text-[12px] text-slate-700">{publicStatus || "--"}</div>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Verified Batch">
              <div className="h-8 flex items-center px-1 text-[12px] text-slate-700">{row.batch_number || "--"}</div>
            </ErpDenseFormRow>
          </div>

          <div className="grid gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Test Results - {materialCategory || "No category on material"}</p>
            {materialCategory ? (
              <div className="grid gap-2 lg:grid-cols-3">
                {renderMethodGroup("MCT", mctConfigs, mctMethods)}
                {renderMethodGroup("OTHR", othrConfigs, othrMethods)}
                {renderMethodGroup("CT", ctConfigs, ctMethods)}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">This prodshade has no material category set, so test config cannot be resolved.</p>
            )}
          </div>

          {isMutable ? (
            <div className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Result Recording</p>
              {!allMctFilled ? (
                <p className="text-[11px] font-medium text-amber-700">All mandatory MCT results must be filled before result recording can be submitted.</p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={resultSubmitDisabled}
                  onClick={() => void handleSubmitDecision()}
                  className="h-8 border border-sky-300 bg-sky-50 px-3 text-[12px] font-semibold text-sky-900 disabled:opacity-50"
                >
                  Submit Result
                </button>
                <span className="text-[10px] uppercase tracking-[0.08em] text-slate-400">Ctrl+S</span>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
