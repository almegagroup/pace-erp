import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import {
  addQATestLine,
  createQaCategoryTestConfig,
  createQaTestMethod,
  deleteQaCategoryTestConfig,
  getGRN,
  getQADocument,
  listGRNs,
  listQaCategoryTestConfig,
  listQaTestMethods,
  listQADocuments,
  submitUsageDecision,
  updateQaCategoryTestConfig,
  updateQATestLine,
} from "../procurementApi.js";
import DocumentFlowSection from "../DocumentFlowSection.jsx";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import {
  useMaterialOptionsQuery,
  useStorageLocationOptionsQuery,
} from "../../../../hooks/queries/useOmMasterQueries.js";

const LIMIT = 50;
const QA_MANAGER_ROLE_CODES = new Set(["SA", "DIRECTOR", "PROCUREMENT_HEAD", "STORE_MANAGER"]);

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

function passFailTone(value) {
  switch (String(value || "").toUpperCase()) {
    case "PASS":
      return "bg-emerald-100 text-emerald-800";
    case "FAIL":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function normalizeSearch(text) {
  return String(text || "").trim().toLowerCase();
}

function newDecisionRow(defaultDecision) {
  return {
    key:
      typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    quantity: "",
    usage_decision: defaultDecision || "RELEASE",
    remarks: "",
  };
}

export default function QAQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkQaId = searchParams.get("qa_id") || "";
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
    queryKey: ["procurement", "qa-queue", companyId || null, statusFilter, dateFrom, dateTo],
    queryFn: () =>
      listQADocuments({
        company_id: companyId || undefined,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: 200,
      }),
    enabled: Boolean(companyId),
  });
  const grnsQuery = useQuery({
    queryKey: ["procurement", "qa-queue-grns", companyId || null],
    queryFn: () => listGRNs({ company_id: companyId || undefined, limit: 200, offset: 0 }),
    enabled: Boolean(companyId),
  });
  const materialQuery = useMaterialOptionsQuery({ limit: 200, offset: 0 });

  const rows = useMemo(() => (Array.isArray(queueQuery.data) ? queueQuery.data : []), [queueQuery.data]);
  const grns = useMemo(
    () => (Array.isArray(grnsQuery.data?.items) ? grnsQuery.data.items : []),
    [grnsQuery.data],
  );
  const materials = materialQuery.materials;
  const loading = queueQuery.isLoading || grnsQuery.isLoading || materialQuery.isLoading;

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    const nextError = queueQuery.error?.message || grnsQuery.error?.message || materialQuery.error?.message || "";
    setError(nextError);
  }, [grnsQuery.error, materialQuery.error, queueQuery.error]);

  // Deep-link support: other detail pages' Document Flow chain link here with ?qa_id=
  // since QA no longer has its own standalone detail route — expand the matching row.
  useEffect(() => {
    if (!deepLinkQaId || rows.length === 0) return;
    if (rows.some((row) => row.id === deepLinkQaId)) {
      setExpandedRowId(deepLinkQaId);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("qa_id");
        return next;
      }, { replace: true });
    }
  }, [deepLinkQaId, rows, setSearchParams]);

  const grnMap = useMemo(() => new Map(grns.map((row) => [row.id, row])), [grns]);
  const materialMap = useMemo(() => new Map(materials.map((row) => [row.id, row])), [materials]);

  const filteredRows = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) {
      return rows;
    }

    return rows.filter((row) => {
      const grn = grnMap.get(row.grn_id);
      const material = materialMap.get(row.material_id);
      const haystack = [row.qa_doc_number, grn?.grn_number, material?.material_name, material?.material_code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [grnMap, materialMap, rows, search]);

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const safePage = Math.min(page, totalPages);
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
    { key: "grn_number", label: "GRN Number", width: "140px" },
    { key: "material", label: "Material" },
    { key: "category", label: "Category", width: "140px" },
    { key: "qty", label: "Quantity", width: "170px" },
    { key: "status", label: "Status", width: "130px" },
    { key: "expand", label: "", width: "40px" },
  ];

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Inward QA Queue"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void Promise.all([queueQuery.refetch(), grnsQuery.refetch(), materialQuery.refetch()]),
        },
      ]}
      notices={[
        ...(error ? [{ key: "qa-queue-error", tone: "error", message: error }] : []),
      ]}
      filterSection={{
        eyebrow: "Queue Filters",
        title: "Pending and in-progress QA work",
        children: (
          <div className="flex flex-wrap items-end gap-3">
            {isMulti ? (
              <label className="grid w-56 gap-1 text-[11px] font-medium text-slate-600">
                Company
                <select
                  value={selectedCompanyId}
                  onChange={(event) => setSelectedCompanyId(event.target.value)}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">Select company…</option>
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
              onChange={setSearch}
              primaryFocus
              placeholder="Search QA, GRN or material"
              className="w-64"
            />
            <label className="grid w-40 gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="ALL">ALL</option>
                <option value="PENDING">PENDING</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="DECISION_MADE">DECISION_MADE</option>
              </select>
            </label>
            <label className="grid w-36 gap-1 text-[11px] font-medium text-slate-600">
              GRN Date From
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid w-36 gap-1 text-[11px] font-medium text-slate-600">
              GRN Date To
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "QA Work Queue",
        title: loading ? "Loading QA queue" : `${total} QA document row${total === 1 ? "" : "s"}`,
        children: !companyId ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            {isMulti ? "Select a company to load the QA queue." : "No company resolved for this session."}
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
                        {loading ? "Loading QA queue..." : "No QA document matched the current filter."}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row) => {
                      const grn = grnMap.get(row.grn_id);
                      const material = materialMap.get(row.material_id);
                      const isExpanded = expandedRowId === row.id;
                      const remaining = Number(row.remaining_qty ?? row.total_qty ?? 0);
                      return (
                        <Fragment key={row.id}>
                          <tr
                            onClick={() => toggleExpand(row.id)}
                            className="cursor-pointer border-b border-slate-100 bg-white hover:bg-sky-50"
                          >
                            <td className="px-2 py-1.5 font-mono font-semibold text-sky-700">
                              {grn?.grn_number || row.grn_id || "—"}
                            </td>
                            <td className="px-2 py-1.5">
                              {material?.material_name || material?.material_code || row.material_id || "—"}
                            </td>
                            <td className="px-2 py-1.5">{material?.material_category || "—"}</td>
                            <td className="px-2 py-1.5">
                              {Number(row.total_qty ?? 0).toLocaleString()} {row.uom_code || ""}
                              {remaining > 0 && remaining !== Number(row.total_qty ?? 0) ? (
                                <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                  {remaining} pending
                                </span>
                              ) : null}
                            </td>
                            <td className="px-2 py-1.5">
                              <span
                                className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusTone(row.public_status)}`}
                              >
                                {row.public_status}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-center text-slate-400">{isExpanded ? "▲" : "▼"}</td>
                          </tr>
                          {isExpanded ? (
                            <tr className="bg-slate-50">
                              <td colSpan={columns.length} className="border-t border-slate-200 p-0">
                                <QaExpandedPanel
                                  row={row}
                                  material={material}
                                  companyId={companyId}
                                  roleCode={shellProfile?.roleCode || ""}
                                  onChanged={() => {
                                    void queueQuery.refetch();
                                  }}
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

function QaExpandedPanel({ row, material, companyId, roleCode, onChanged }) {
  const queryClient = useQueryClient();
  const canManage = QA_MANAGER_ROLE_CODES.has(roleCode);
  const materialCategory = material?.material_category || "";

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resultDrafts, setResultDrafts] = useState({});
  const [limitDrafts, setLimitDrafts] = useState({});
  const [decisionRows, setDecisionRows] = useState([]);
  const [addMethodForm, setAddMethodForm] = useState({ group: "", mode: "existing", methodId: "", methodName: "", lsl: "", usl: "" });

  const detailQuery = useQuery({
    queryKey: ["procurement", "qa-detail", row.id],
    queryFn: () => getQADocument(row.id),
  });
  const grnQuery = useQuery({
    queryKey: ["procurement", "qa-grn-detail", row.grn_id],
    queryFn: () => getGRN(row.grn_id),
    enabled: Boolean(row.grn_id),
  });
  const storageLocationQuery = useStorageLocationOptionsQuery({ company_id: companyId }, { enabled: Boolean(companyId) });
  const categoryConfigQuery = useQuery({
    queryKey: ["procurement", "qa-category-config", companyId, materialCategory],
    queryFn: () => listQaCategoryTestConfig({ company_id: companyId, material_category: materialCategory }),
    enabled: Boolean(companyId && materialCategory),
  });
  const mctMethodsQuery = useQuery({
    queryKey: ["procurement", "qa-test-methods", companyId, "MCT"],
    queryFn: () => listQaTestMethods({ company_id: companyId, test_group: "MCT" }),
    enabled: Boolean(companyId),
  });
  const othrMethodsQuery = useQuery({
    queryKey: ["procurement", "qa-test-methods", companyId, "OTHR"],
    queryFn: () => listQaTestMethods({ company_id: companyId, test_group: "OTHR" }),
    enabled: Boolean(companyId),
  });

  const detail = detailQuery.data ?? null;
  const grn = grnQuery.data ?? null;
  const storageLocations = storageLocationQuery.storageLocations;
  const categoryConfigs = useMemo(
    () => (Array.isArray(categoryConfigQuery.data) ? categoryConfigQuery.data : []),
    [categoryConfigQuery.data],
  );
  const mctMethods = useMemo(
    () => (Array.isArray(mctMethodsQuery.data) ? mctMethodsQuery.data : []),
    [mctMethodsQuery.data],
  );
  const othrMethods = useMemo(
    () => (Array.isArray(othrMethodsQuery.data) ? othrMethodsQuery.data : []),
    [othrMethodsQuery.data],
  );

  const loading = detailQuery.isLoading || grnQuery.isLoading;
  const grnLine = (grn?.lines ?? []).find((line) => line.id === row.grn_line_id) || grn?.lines?.[0] || null;
  const storageLocationLabel = useMemo(() => {
    const loc = storageLocations.find((entry) => entry.id === grnLine?.storage_location_id);
    return loc?.storage_location_name || loc?.storage_location_code || grnLine?.storage_location_id || "—";
  }, [grnLine?.storage_location_id, storageLocations]);

  const testLines = Array.isArray(detail?.test_lines) ? detail.test_lines : [];
  const decisionLines = Array.isArray(detail?.decision_lines) ? detail.decision_lines : [];
  const totalQty = Number(detail?.total_qty ?? row.total_qty ?? 0);
  const remainingQty = Number(detail?.remaining_qty ?? row.remaining_qty ?? totalQty);
  const publicStatus = String(detail?.public_status ?? row.public_status ?? "").toUpperCase();
  const isMutable = remainingQty > 0.000001 && ["PENDING", "IN_PROGRESS"].includes(publicStatus);

  const mctConfigs = useMemo(() => categoryConfigs.filter((c) => c.qa_test_method?.test_group === "MCT"), [categoryConfigs]);
  const othrConfigs = useMemo(() => categoryConfigs.filter((c) => c.qa_test_method?.test_group === "OTHR"), [categoryConfigs]);

  function testLineForMethod(methodId) {
    return testLines.find((line) => line.test_method_id === methodId);
  }

  const anyMctFail = mctConfigs.some((cfg) => testLineForMethod(cfg.test_method_id)?.pass_fail === "FAIL");
  const allMctFilled = mctConfigs.every((cfg) => {
    const line = testLineForMethod(cfg.test_method_id);
    return line && String(line.test_result ?? "").trim() !== "";
  });

  useEffect(() => {
    if (decisionRows.length === 0 && isMutable) {
      setDecisionRows([newDecisionRow(anyMctFail ? "BLOCK" : "RELEASE")]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMutable, mctConfigs.length]);

  function toast(msg, tone = "success") {
    if (tone === "error") setError(msg);
    else setNotice(msg);
    setTimeout(() => {
      setError("");
      setNotice("");
    }, 3500);
  }

  async function refreshDetail() {
    await queryClient.invalidateQueries({ queryKey: ["procurement", "qa-detail", row.id] });
    onChanged?.();
  }

  async function handleResultChange(config, value) {
    setResultDrafts((current) => ({ ...current, [config.test_method_id]: value }));
  }

  async function handleResultSave(config) {
    const value = resultDrafts[config.test_method_id];
    if (value === undefined) return;
    const existingLine = testLineForMethod(config.test_method_id);
    const testType = config.qa_test_method?.test_group === "OTHR" ? "OTHER" : "MCT";
    setSaving(true);
    setError("");
    try {
      if (existingLine) {
        await updateQATestLine(row.id, existingLine.id, { result_value: value });
      } else {
        await addQATestLine(row.id, {
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
      toast(saveError instanceof Error ? saveError.message : "PROCUREMENT_QA_TEST_SAVE_FAILED", "error");
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
        queryClient.invalidateQueries({ queryKey: ["procurement", "qa-category-config", companyId, materialCategory] }),
        queryClient.invalidateQueries({ queryKey: ["procurement", "qa-test-methods", companyId, group] }),
      ]);
      toast(`Method added to ${materialCategory} (${group}).`);
    } catch (saveError) {
      toast(saveError instanceof Error ? saveError.message : "PROCUREMENT_QA_METHOD_ADD_FAILED", "error");
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
      await queryClient.invalidateQueries({ queryKey: ["procurement", "qa-category-config", companyId, materialCategory] });
    } catch (saveError) {
      toast(saveError instanceof Error ? saveError.message : "PROCUREMENT_QA_LIMIT_UPDATE_FAILED", "error");
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
      await queryClient.invalidateQueries({ queryKey: ["procurement", "qa-category-config", companyId, materialCategory] });
      toast("Method removed from category.");
    } catch (deleteError) {
      toast(deleteError instanceof Error ? deleteError.message : "PROCUREMENT_QA_METHOD_DELETE_FAILED", "error");
    } finally {
      setSaving(false);
    }
  }

  function updateDecisionRow(key, patch) {
    setDecisionRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addSplitRow() {
    setDecisionRows((current) => [...current, newDecisionRow(anyMctFail ? "BLOCK" : "RELEASE")]);
  }

  function removeSplitRow(key) {
    setDecisionRows((current) => (current.length === 1 ? current : current.filter((r) => r.key !== key)));
  }

  const allocatedQty = decisionRows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const decisionSubmitDisabled =
    !isMutable ||
    saving ||
    !allMctFilled ||
    decisionRows.length === 0 ||
    !(allocatedQty > 0) ||
    allocatedQty - remainingQty > 0.000001 ||
    decisionRows.some((r) => !(Number(r.quantity) > 0) || !String(r.usage_decision || "").trim());

  async function handleSubmitDecision() {
    if (decisionSubmitDisabled) return;
    const confirmed = await openActionConfirm({
      eyebrow: "QA Decision",
      title: "Submit usage decision?",
      message: "This will post stock movement(s). Posted decisions cannot be edited from this page.",
      confirmLabel: "Submit",
    });
    if (!confirmed) return;

    setSaving(true);
    setError("");
    try {
      await submitUsageDecision(row.id, {
        decision_lines: decisionRows.map((r) => ({
          quantity: Number(r.quantity),
          usage_decision: r.usage_decision,
          remarks: r.remarks || undefined,
        })),
      });
      setDecisionRows([]);
      await refreshDetail();
      toast("Usage decision posted.");
    } catch (submitError) {
      toast(submitError instanceof Error ? submitError.message : "PROCUREMENT_QA_DECISION_FAILED", "error");
    } finally {
      setSaving(false);
    }
  }

  function renderMethodGroup(group, configs, methodPool) {
    const isAddingThisGroup = addMethodForm.group === group;
    return (
      <div className="grid gap-2 rounded border border-slate-200 bg-white p-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">
            {group === "MCT" ? "MCT (mandatory)" : "OTHR (optional)"}
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
                <th className="py-1">Pass/Fail</th>
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
                        cfg.lsl ?? "—"
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
                        cfg.usl ?? "—"
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
                    <td className="py-1 pr-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${passFailTone(line?.pass_fail)}`}>
                        {line?.pass_fail || "PENDING"}
                      </span>
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
                  <option value="">Select…</option>
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
            <div className="flex items-end">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleAddMethod(group)}
                className="h-7 border border-sky-300 bg-sky-50 px-2 text-[12px] font-semibold text-sky-900 disabled:opacity-50"
              >
                Save Method
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3 bg-white p-3">
      {loading ? (
        <p className="p-4 text-center text-sm text-slate-400">Loading QA detail...</p>
      ) : (
        <>
          {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-1.5 text-[12px] text-rose-800">{error}</div> : null}
          {notice ? <div className="border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-800">{notice}</div> : null}

          <div className="grid gap-2 lg:grid-cols-4">
            <ErpDenseFormRow label="Storage Location (auto, read-only)">
              <div className="h-8 flex items-center px-1 text-[12px] text-slate-700">{storageLocationLabel}</div>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Total Qty">
              <div className="h-8 flex items-center px-1 text-[12px] text-slate-700">{totalQty} {row.uom_code || ""}</div>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Decided Qty">
              <div className="h-8 flex items-center px-1 text-[12px] text-slate-700">{Number(detail?.decided_qty ?? row.decided_qty ?? 0)}</div>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Remaining Qty">
              <div className={`h-8 flex items-center px-1 text-[12px] font-semibold ${remainingQty > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                {remainingQty}
              </div>
            </ErpDenseFormRow>
          </div>

          <div className="grid gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Test Results — {materialCategory || "No category on material"}</p>
            {materialCategory ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {renderMethodGroup("MCT", mctConfigs, mctMethods)}
                {renderMethodGroup("OTHR", othrConfigs, othrMethods)}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">This material has no category set on the material master — test config cannot be resolved.</p>
            )}
          </div>

          {isMutable ? (
            <div className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Usage Decision</p>
              {!allMctFilled ? (
                <p className="text-[11px] font-medium text-amber-700">All mandatory MCT results must be filled before a decision can be submitted.</p>
              ) : null}
              {decisionRows.map((r) => {
                const showForReprocess = canManage;
                return (
                  <div key={r.key} className="grid items-end gap-2 lg:grid-cols-[120px_180px_1fr_auto]">
                    <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
                      Quantity
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={r.quantity}
                        onChange={(event) => updateDecisionRow(r.key, { quantity: event.target.value })}
                        className="h-8 border border-slate-300 bg-white px-1.5 text-[12px]"
                      />
                    </label>
                    <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
                      Decision
                      <select
                        value={r.usage_decision}
                        onChange={(event) => updateDecisionRow(r.key, { usage_decision: event.target.value })}
                        className="h-8 border border-slate-300 bg-white px-1.5 text-[12px]"
                      >
                        {["RELEASE", "BLOCK", "REJECT", "SCRAP", ...(showForReprocess ? ["FOR_REPROCESS"] : [])].map((entry) => (
                          <option key={entry} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-0.5 text-[10px] font-medium text-slate-600">
                      Remarks
                      <input
                        value={r.remarks}
                        onChange={(event) => updateDecisionRow(r.key, { remarks: event.target.value })}
                        className="h-8 border border-slate-300 bg-white px-1.5 text-[12px]"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={decisionRows.length === 1}
                      onClick={() => removeSplitRow(r.key)}
                      className="h-8 border border-slate-300 bg-white px-2 text-[11px] disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <button type="button" onClick={addSplitRow} className="h-8 border border-slate-300 bg-white px-2 text-[12px] font-semibold">
                    + Add Split
                  </button>
                  <button
                    type="button"
                    disabled={decisionSubmitDisabled}
                    onClick={() => void handleSubmitDecision()}
                    className="h-8 border border-sky-300 bg-sky-50 px-3 text-[12px] font-semibold text-sky-900 disabled:opacity-50"
                  >
                    Submit Decision
                  </button>
                </div>
                <span className="text-[11px] text-slate-500">
                  Allocating {allocatedQty || 0} of {remainingQty} remaining
                </span>
              </div>
            </div>
          ) : null}

          {decisionLines.length > 0 ? (
            <div className="grid gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Posted Decisions</p>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
                    <th className="py-1">Decision</th>
                    <th className="py-1">Qty</th>
                    <th className="py-1">Movement</th>
                    <th className="py-1">Status</th>
                    <th className="py-1">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {decisionLines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="py-1 pr-2 font-medium">{line.usage_decision}</td>
                      <td className="py-1 pr-2">{line.decision_qty}</td>
                      <td className="py-1 pr-2 font-mono">{line.movement_type_code}</td>
                      <td className="py-1 pr-2">{line.posting_status}</td>
                      <td className="py-1 pr-2 text-slate-500">{line.remarks || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <DocumentFlowSection docType="QA" docId={row.id} />
        </>
      )}
    </div>
  );
}
