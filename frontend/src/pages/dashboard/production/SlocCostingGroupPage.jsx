import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { listStorageLocations } from "../om/omApi.js";
import {
  assignAc06CostingGroup,
  closeAc06Month,
  createAc06CostingGroup,
  createAc06SlocGroup,
  deleteAc06CostingGroup,
  deleteAc06SlocGroup,
  getAc06History,
  getAc06Report,
  getAc06Workspace,
  saveAc06Rates,
  unassignAc06CostingGroup,
  updateAc06CostingGroup,
  updateAc06SlocGroup,
  verifyAc06Rates,
} from "./prodApi.js";

const EMPTY = [];
const AC06_FIRST_MONTH = "2026-05";
const unwrap = (payload) => payload?.data ?? payload ?? {};

function Chip({ label, value, tone = "plain" }) {
  const colors = { plain: "border-slate-300 bg-white", ok: "border-emerald-300 bg-emerald-50", warn: "border-amber-300 bg-amber-50" };
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 ${colors[tone]}`}>{label}: {value}</span>;
}

export default function SlocCostingGroupPage() {
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const primaryFocusRef = useRef(null);
  const [companyId, setCompanyId] = useState("");
  const [month, setMonth] = useState(AC06_FIRST_MONTH);
  const [slocGroupId, setSlocGroupId] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [rateDraft, setRateDraft] = useState({});
  const [selectedForVerify, setSelectedForVerify] = useState([]);
  const [slocName, setSlocName] = useState("");
  const [slocLocations, setSlocLocations] = useState([]);
  const [editingSlocId, setEditingSlocId] = useState("");
  const [costingName, setCostingName] = useState("");
  const [editingCostingId, setEditingCostingId] = useState("");
  const [costingParentId, setCostingParentId] = useState("");
  const [targetCostingGroupId, setTargetCostingGroupId] = useState("");
  const [costingMemberIds, setCostingMemberIds] = useState([]);
  const [reportMonths, setReportMonths] = useState(AC06_FIRST_MONTH);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!companyId && runtimeContext?.selectedCompanyId) setCompanyId(String(runtimeContext.selectedCompanyId));
  }, [companyId, runtimeContext]);

  const reportMode = searchParams.get("report") === "1";
  const reportSlocId = searchParams.get("sloc_group_id") || slocGroupId;
  const reportMonthList = (searchParams.get("months") || reportMonths).split(",").map((value) => value.trim()).filter(Boolean);
  const workspaceQuery = useQuery({
    queryKey: ["ac06-v3", "workspace", companyId, month, slocGroupId],
    queryFn: () => getAc06Workspace({ company_id: companyId, rate_month: month, sloc_group_id: slocGroupId }),
    enabled: Boolean(companyId && month),
    select: unwrap,
  });
  const locationsQuery = useQuery({
    queryKey: ["ac06-v3", "locations", companyId],
    queryFn: () => listStorageLocations({ company_id: companyId, is_active: true }),
    enabled: Boolean(companyId),
    select: (payload) => Array.isArray(payload) ? payload : payload?.data ?? EMPTY,
  });
  const reportQuery = useQuery({
    queryKey: ["ac06-v3", "report", companyId, reportSlocId, reportMonthList.join(",")],
    queryFn: () => getAc06Report({ company_id: companyId, sloc_group_id: reportSlocId, months: reportMonthList.join(",") }),
    enabled: reportMode && Boolean(companyId && reportSlocId && reportMonthList.length),
    select: unwrap,
  });
  const historyQuery = useQuery({
    queryKey: ["ac06-v3", "history", companyId, month],
    queryFn: () => getAc06History({ company_id: companyId, rate_month: month }),
    enabled: tab === "history" && Boolean(companyId && month),
    select: unwrap,
  });

  const workspace = workspaceQuery.data ?? {};
  const rows = workspace.rows ?? EMPTY;
  const slocGroups = workspace.sloc_groups ?? EMPTY;
  const costingGroups = workspace.costing_groups ?? EMPTY;
  const summary = workspace.summary ?? {};
  const selectedSlocRows = rows.filter((row) => !slocGroupId || row.source_sloc_group_id === slocGroupId);
  const pendingIds = new Set(selectedSlocRows.filter((row) => row.verification_status === "PENDING" && (row.is_standalone || row.is_group_lead)).map((row) => row.id));
  const selectionValid = selectedForVerify.length > 0 && selectedForVerify.every((id) => pendingIds.has(id));
  const groupSetupRows = rows.filter((row) => String(row.source_sloc_group_id || "") === costingParentId);

  useEffect(() => {
    setRateDraft((current) => {
      const next = { ...current };
      rows.forEach((row) => { if (!(row.id in next)) next[row.id] = String(row.rate ?? "0"); });
      return next;
    });
  }, [rows]);

  async function refresh() { await queryClient.invalidateQueries({ queryKey: ["ac06-v3"] }); }
  function notice(message, tone = "success") { pushToast({ message, tone }); }
  function toggle(list, value, setter) { setter(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]); }

  async function withBusy(action) {
    setBusy(true);
    try { await action(); await refresh(); } catch (error) { notice(error?.message || "Request failed.", "error"); } finally { setBusy(false); }
  }

  function setGroupRate(row, value) {
    setRateDraft((current) => {
      const next = { ...current, [row.id]: value };
      if (row.costing_group_id) rows.filter((candidate) => candidate.costing_group_id === row.costing_group_id).forEach((candidate) => { next[candidate.id] = value; });
      return next;
    });
  }

  const tabs = [
    ["dashboard", "Costing Dashboard"], ["rate", "Monthly Costing Rate Input"], ["sloc", "SLOC Group Setup"],
    ["group", "Costing Group Setup"], ["history", "History / Archive"],
  ];

  useErpScreenHotkeys({ refresh: { disabled: !companyId, perform: () => { void refresh(); } }, focusPrimary: { disabled: false, perform: () => primaryFocusRef.current?.focus?.() } });

  if (reportMode) {
    const reportRows = reportQuery.data?.rows ?? EMPTY;
    return <ErpScreenScaffold title="Monthly Costing Rate Report" subtitle="AC06 full-page, multi-month comparison">
      <ErpSectionCard title="Report Scope"><div className="grid gap-3 md:grid-cols-3"><ErpFieldPreview label="Company" value={companyId || "-"} /><ErpFieldPreview label="SLOC Group" value={reportSlocId || "-"} /><ErpFieldPreview label="Months" value={reportMonthList.join(", ")} /></div></ErpSectionCard>
      <ErpDenseGrid columns={[{ key: "rate_month", label: "Month" }, { key: "pace_code", label: "Material", render: (row) => `${row.pace_code || "-"} | ${row.material_name || "-"}` }, { key: "costing_group_name_snapshot", label: "Costing Group", render: (row) => row.costing_group_name_snapshot || "Standalone" }, { key: "rate", label: "Rate" }, { key: "verification_status", label: "Verification" }, { key: "month_status", label: "Month Status" }]} rows={reportRows} rowKey={(row) => row.id} emptyMessage="No rate rows match this report scope." />
    </ErpScreenScaffold>;
  }

  return <ErpScreenScaffold title="Monthly Costing Rate Workspace" subtitle="AC06 | company-scoped Dispatch rate control" actions={[{ label: "Refresh", tone: "secondary", onClick: () => { void refresh(); } }, { label: "Close Month", tone: "danger", disabled: busy || workspace.month?.status === "CLOSED" || !companyId, onClick: () => { if (window.confirm(`Close ${month}? This creates an immutable archive.`)) void withBusy(() => closeAc06Month({ company_id: companyId, rate_month: month })); } }]}>
    <ErpSectionCard title="Header"><div className="grid gap-3 lg:grid-cols-[minmax(0,330px)_180px_minmax(0,280px)]"><TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" selectRef={primaryFocusRef} /><label className="grid gap-1 text-xs font-semibold text-slate-700">Month<input type="month" min={AC06_FIRST_MONTH} value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 border border-slate-300 px-3" /></label><label className="grid gap-1 text-xs font-semibold text-slate-700">SLOC Group<select value={slocGroupId} onChange={(event) => setSlocGroupId(event.target.value)} className="h-10 border border-slate-300 bg-white px-3"><option value="">All SLOC Groups</option>{slocGroups.map((group) => <option key={group.id} value={group.id}>{group.group_name}</option>)}</select></label></div></ErpSectionCard>
    <div className="flex flex-wrap gap-2"><Chip label="Month" value={workspace.month?.status || "OPEN"} tone={workspace.month?.status === "CLOSED" ? "plain" : "ok"} /><Chip label="Rows" value={summary.rows || 0} /><Chip label="Verified" value={summary.verified || 0} tone="ok" /><Chip label="Pending" value={summary.pending || 0} tone="warn" /><Chip label="Standalone" value={summary.standalone || 0} /></div>
    <div className="flex flex-wrap gap-1 border-b border-slate-200">{tabs.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`border px-3 py-2 text-sm font-semibold ${tab === id ? "border-sky-700 bg-sky-100 text-sky-950" : "border-slate-200 bg-white text-slate-600"}`}>{label}</button>)}</div>
    {tab === "dashboard" ? <ErpSectionCard title="Costing Dashboard"><div className="grid gap-4"><p className="text-sm text-slate-600">Choose Company, SLOC Group, and one or more months to open the full-page rate comparison. The report can be opened in a separate ERP window through Shift+F8.</p><div className="grid gap-3 md:grid-cols-[1fr_auto]"><input value={reportMonths} onChange={(event) => setReportMonths(event.target.value)} placeholder="2026-05,2026-06" className="h-10 border border-slate-300 px-3" /><button type="button" disabled={!companyId || !slocGroupId || !reportMonths} onClick={() => window.open(`/dashboard/production/sloc-costing-group?report=1&sloc_group_id=${encodeURIComponent(slocGroupId)}&months=${encodeURIComponent(reportMonths)}`, "_blank", "noopener,noreferrer")} className="border border-sky-700 bg-sky-100 px-4 text-sm font-semibold">Execute Full Report</button></div></div></ErpSectionCard> : null}
    {tab === "rate" ? <ErpSectionCard title="Monthly Costing Rate Input"><div className="mb-3 flex flex-wrap justify-between gap-2"><p className="text-xs text-slate-600">Changing a rate immediately makes its scope pending again. Only pending standalone rows and Costing Group lead rows can be verified.</p><div className="flex gap-2"><button type="button" disabled={busy || !selectionValid} onClick={() => void withBusy(() => verifyAc06Rates({ company_id: companyId, rate_month: month, line_ids: selectedForVerify }))} className="border border-emerald-700 bg-emerald-50 px-3 py-1 text-xs font-semibold disabled:opacity-40">Verify Selected</button><button type="button" disabled={busy || !selectedSlocRows.length} onClick={() => void withBusy(() => saveAc06Rates({ company_id: companyId, rate_month: month, updates: selectedSlocRows.filter((row) => row.is_standalone || row.is_group_lead).map((row) => ({ line_id: row.id, rate: rateDraft[row.id] ?? row.rate })) }))} className="border border-sky-700 bg-sky-100 px-3 py-1 text-xs font-semibold">Save Rates</button></div></div><ErpDenseGrid columns={[{ key: "verify", label: "Verify", render: (row) => <input type="checkbox" disabled={!pendingIds.has(row.id)} checked={selectedForVerify.includes(row.id)} onChange={() => toggle(selectedForVerify, row.id, setSelectedForVerify)} /> }, { key: "pace_code", label: "Material", render: (row) => `${row.pace_code || "-"} | ${row.material_name || "-"}` }, { key: "costing_group_name", label: "Costing Group", render: (row) => row.costing_group_name || "Standalone" }, { key: "rate", label: "Rate", render: (row) => row.is_standalone || row.is_group_lead ? <input value={rateDraft[row.id] ?? row.rate ?? "0"} onChange={(event) => setGroupRate(row, event.target.value)} inputMode="decimal" className="h-8 w-32 border border-slate-300 px-2 font-mono" /> : <span className="font-mono">{rateDraft[row.id] ?? row.rate ?? "0"}</span> }, { key: "verification_status", label: "Status" }, { key: "lead", label: "Entry", render: (row) => row.is_standalone ? "Standalone" : row.is_group_lead ? "Group Lead" : "Auto-filled" }]} rows={selectedSlocRows} rowKey={(row) => row.id} emptyMessage="Create a SLOC Group first, then select it to load eligible items." /></ErpSectionCard> : null}
    {tab === "sloc" ? <ErpSectionCard title="SLOC Group Setup"><div className="grid gap-4 lg:grid-cols-[360px_1fr]"><div className="grid gap-3 border border-slate-200 p-4"><label className="grid gap-1 text-xs font-semibold">Group Name<input value={slocName} onChange={(event) => setSlocName(event.target.value)} className="h-10 border border-slate-300 px-3" /></label><div className="max-h-72 overflow-auto border border-slate-200 p-2">{(locationsQuery.data ?? EMPTY).map((location) => <label key={location.id} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={slocLocations.includes(location.id)} onChange={() => toggle(slocLocations, location.id, setSlocLocations)} />{location.storage_location_code} | {location.storage_location_name}</label>)}</div><div className="flex gap-2"><button type="button" disabled={busy || !slocName || !slocLocations.length} onClick={() => void withBusy(async () => { if (editingSlocId) await updateAc06SlocGroup(editingSlocId, { company_id: companyId, group_name: slocName, storage_location_ids: slocLocations }); else await createAc06SlocGroup({ company_id: companyId, group_name: slocName, storage_location_ids: slocLocations }); setSlocName(""); setSlocLocations([]); setEditingSlocId(""); })} className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold">{editingSlocId ? "Save SLOC Group" : "Create SLOC Group"}</button>{editingSlocId ? <button type="button" onClick={() => { setEditingSlocId(""); setSlocName(""); setSlocLocations([]); }} className="border border-slate-300 px-3 py-2 text-sm">Cancel</button> : null}</div></div><ErpDenseGrid columns={[{ key: "group_name", label: "Existing SLOC Group" }, { key: "active", label: "Status", render: () => "Active" }, { key: "actions", label: "Action", render: (row) => <div className="flex gap-2"><button type="button" onClick={() => { setEditingSlocId(row.id); setSlocName(row.group_name); setSlocLocations((row.storage_location_ids || []).map(String)); }} className="text-xs font-semibold text-sky-800">Edit</button><button type="button" onClick={() => { if (window.confirm(`Delete ${row.group_name}?`)) void withBusy(() => deleteAc06SlocGroup(row.id, { company_id: companyId })); }} className="text-xs font-semibold text-rose-800">Delete</button></div> }]} rows={slocGroups} rowKey={(row) => row.id} emptyMessage="No SLOC Group exists for this company." /></div></ErpSectionCard> : null}
    {tab === "group" ? <ErpSectionCard title="Costing Group Setup"><div className="grid gap-4 border border-slate-200 p-4"><div className="grid gap-3 md:grid-cols-3"><label className="grid gap-1 text-xs font-semibold">Parent SLOC Group<select value={costingParentId} onChange={(event) => { setCostingParentId(event.target.value); setTargetCostingGroupId(""); setCostingMemberIds([]); }} className="h-10 border border-slate-300 bg-white px-3"><option value="">Select SLOC Group</option>{slocGroups.map((group) => <option key={group.id} value={group.id}>{group.group_name}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold">Costing Group Name<input value={costingName} onChange={(event) => setCostingName(event.target.value)} className="h-10 border border-slate-300 px-3" /></label><div className="mt-5 flex gap-2"><button type="button" disabled={busy || !costingParentId || !costingName} onClick={() => void withBusy(async () => { if (editingCostingId) await updateAc06CostingGroup(editingCostingId, { company_id: companyId, group_name: costingName }); else { const created = await createAc06CostingGroup({ company_id: companyId, sloc_group_id: costingParentId, group_name: costingName }); setTargetCostingGroupId(created?.id || ""); } setCostingName(""); setEditingCostingId(""); })} className="h-10 border border-sky-700 bg-sky-100 px-3 text-sm font-semibold">{editingCostingId ? "Save Costing Group" : "Create Costing Group"}</button>{editingCostingId ? <button type="button" onClick={() => { setEditingCostingId(""); setCostingName(""); }} className="h-10 border border-slate-300 px-3 text-sm">Cancel</button> : null}</div></div><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]"><label className="grid gap-1 text-xs font-semibold">Move selected eligible items to<select value={targetCostingGroupId} onChange={(event) => setTargetCostingGroupId(event.target.value)} className="h-10 border border-slate-300 bg-white px-3"><option value="">Select Costing Group</option>{costingGroups.filter((group) => group.sloc_group_id === costingParentId).map((group) => <option key={group.id} value={group.id}>{group.group_name}</option>)}</select></label><button type="button" disabled={busy || !targetCostingGroupId || !costingMemberIds.length || workspace.month?.status === "CLOSED"} onClick={() => void withBusy(async () => { await assignAc06CostingGroup({ company_id: companyId, rate_month: month, costing_group_id: targetCostingGroupId, material_ids: groupSetupRows.filter((row) => costingMemberIds.includes(row.id)).map((row) => row.material_id) }); setCostingMemberIds([]); })} className="mt-5 h-10 border border-sky-700 bg-sky-100 px-3 text-sm font-semibold">Map To Group</button><button type="button" disabled={busy || !costingMemberIds.length || workspace.month?.status === "CLOSED"} onClick={() => void withBusy(async () => { await unassignAc06CostingGroup({ company_id: companyId, rate_month: month, line_ids: costingMemberIds }); setCostingMemberIds([]); })} className="mt-5 h-10 border border-rose-700 bg-rose-50 px-3 text-sm font-semibold">Make Standalone</button></div><ErpDenseGrid columns={[{ key: "selected", label: "Select", render: (row) => <input type="checkbox" checked={costingMemberIds.includes(row.id)} onChange={() => toggle(costingMemberIds, row.id, setCostingMemberIds)} /> }, { key: "pace_code", label: "Eligible Item", render: (row) => `${row.pace_code || "-"} | ${row.material_name || "-"}` }, { key: "costing_group_name", label: "Current Costing Group", render: (row) => row.costing_group_name || "Standalone" }, { key: "verification_status", label: "Rate Status" }]} rows={groupSetupRows} rowKey={(row) => row.id} emptyMessage="Select a parent SLOC Group to manage its eligible items." /><ErpDenseGrid columns={[{ key: "group_name", label: "Costing Group" }, { key: "sloc_group_id", label: "Parent SLOC Group", render: (row) => slocGroups.find((group) => group.id === row.sloc_group_id)?.group_name || "-" }, { key: "actions", label: "Action", render: (row) => <div className="flex gap-2"><button type="button" onClick={() => { setEditingCostingId(row.id); setCostingParentId(row.sloc_group_id); setCostingName(row.group_name); }} className="text-xs font-semibold text-sky-800">Edit</button><button type="button" onClick={() => { if (window.confirm(`Delete ${row.group_name}? Its open-month items become standalone.`)) void withBusy(() => deleteAc06CostingGroup(row.id, { company_id: companyId })); }} className="text-xs font-semibold text-rose-800">Delete</button></div> }]} rows={costingGroups.filter((group) => !costingParentId || group.sloc_group_id === costingParentId)} rowKey={(row) => row.id} emptyMessage="No Costing Group exists yet." /></div></ErpSectionCard> : null}
    {tab === "history" ? <ErpSectionCard title="History / Archive"><p className="mb-3 text-sm text-slate-600">Closed snapshots are immutable. The selected month is shown below; open the full-page report to compare multiple months.</p><ErpDenseGrid columns={[{ key: "material_code_snapshot", label: "Material" }, { key: "costing_group_name_snapshot", label: "Costing Group", render: (row) => row.costing_group_name_snapshot || "Standalone" }, { key: "rate", label: "Rate" }, { key: "verification_status", label: "Verification" }]} rows={historyQuery.data?.rows ?? EMPTY} rowKey={(row) => row.id} emptyMessage={historyQuery.data?.archive ? "No archived rows." : "The selected month is still open or has no archive."} /></ErpSectionCard> : null}
  </ErpScreenScaffold>;
}
