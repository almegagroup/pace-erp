import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { listStorageLocations } from "../om/omApi.js";
import {
  addCostingGroupMembers,
  addSlocGroupMember,
  approveCostingRate,
  createCostingGroup,
  createSlocGroup,
  listCostingGroups,
  listCostingRateMaterials,
  listDraftCostingRateDetail,
  listPendingCostingDrafts,
  listSlocGroups,
  removeCostingGroupMember,
  removeSlocGroupMember,
  saveCostingRateDraft,
} from "./prodApi.js";

const EMPTY_ROWS = [];

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function noticeFor(error) {
  return error?.message || "Request failed.";
}

function buildEditableMaterialSet(rows) {
  const seenGroups = new Set();
  const editable = new Set();
  for (const row of rows) {
    if (!row.group_id) {
      editable.add(row.material_id);
      continue;
    }
    if (!seenGroups.has(row.group_id)) {
      editable.add(row.material_id);
      seenGroups.add(row.group_id);
    }
  }
  return editable;
}

function toggleInList(current, value) {
  return current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
}

function seedRates(current, rows) {
  const next = { ...current };
  let changed = false;
  for (const row of rows) {
    if (!(row.material_id in next) && row.rate != null) {
      next[row.material_id] = String(row.rate);
      changed = true;
    }
  }
  return changed ? next : current;
}

function updateGroupedRate(setter, rows, materialId, nextValue, groupId) {
  setter((current) => {
    const next = { ...current, [materialId]: nextValue };
    if (groupId) {
      for (const row of rows) {
        if (row.group_id === groupId) next[row.material_id] = nextValue;
      }
    }
    return next;
  });
}

export default function SlocCostingGroupPage() {
  const { runtimeContext } = useMenu();
  const qc = useQueryClient();
  const primaryFocusRef = useRef(null);

  const [companyId, setCompanyId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [slocGroupId, setSlocGroupId] = useState("");
  const [tab, setTab] = useState("entry");
  const [submitting, setSubmitting] = useState(false);

  const [costingDrawerOpen, setCostingDrawerOpen] = useState(false);
  const [costingDrawerMode, setCostingDrawerMode] = useState("create");
  const [selectedCostingGroupId, setSelectedCostingGroupId] = useState("");
  const [newCostingGroupName, setNewCostingGroupName] = useState("");
  const [drawerSlocGroupId, setDrawerSlocGroupId] = useState("");
  const [selectedMaterialIds, setSelectedMaterialIds] = useState([]);

  const [slocManageOpen, setSlocManageOpen] = useState(false);
  const [newSlocGroupName, setNewSlocGroupName] = useState("");
  const [newSlocGroupLocationIds, setNewSlocGroupLocationIds] = useState([]);
  const [managedSlocGroupId, setManagedSlocGroupId] = useState("");
  const [managedAddLocationIds, setManagedAddLocationIds] = useState([]);

  const [entryRates, setEntryRates] = useState({});
  const [approveMonth, setApproveMonth] = useState("");
  const [approvalDrawerOpen, setApprovalDrawerOpen] = useState(false);
  const [approvalRates, setApprovalRates] = useState({});

  useEffect(() => {
    if (!companyId) {
      const defaultCompany = String(runtimeContext?.selectedCompanyId ?? "").trim();
      if (defaultCompany) setCompanyId(defaultCompany);
    }
  }, [companyId, runtimeContext]);

  useEffect(() => {
    setSlocGroupId("");
    setDrawerSlocGroupId("");
    setSelectedCostingGroupId("");
    setManagedSlocGroupId("");
    setApproveMonth("");
    setApprovalDrawerOpen(false);
    setSelectedMaterialIds([]);
    setEntryRates({});
    setApprovalRates({});
  }, [companyId]);

  function pushNotice(message, tone = "success") {
    pushToast({ message, tone });
  }

  const storageLocationsQuery = useQuery({
    queryKey: ["ac06", "storage-locations", companyId],
    queryFn: () => listStorageLocations({ company_id: companyId, is_active: true }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const slocGroupsQuery = useQuery({
    queryKey: ["ac06", "sloc-groups", companyId],
    queryFn: () => listSlocGroups({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const costingGroupsQuery = useQuery({
    queryKey: ["ac06", "costing-groups", companyId],
    queryFn: () => listCostingGroups({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const browseMaterialsQuery = useQuery({
    queryKey: ["ac06", "browse-materials", companyId, drawerSlocGroupId, selectedMonth],
    queryFn: () => listCostingRateMaterials({ company_id: companyId, sloc_group_id: drawerSlocGroupId, rate_month: selectedMonth }),
    enabled: Boolean(companyId && drawerSlocGroupId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const rateMaterialsQuery = useQuery({
    queryKey: ["ac06", "rate-materials", companyId, slocGroupId, selectedMonth],
    queryFn: () => listCostingRateMaterials({ company_id: companyId, sloc_group_id: slocGroupId, rate_month: selectedMonth }),
    enabled: Boolean(companyId && slocGroupId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const pendingDraftsQuery = useQuery({
    queryKey: ["ac06", "pending-drafts", companyId],
    queryFn: () => listPendingCostingDrafts({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const draftDetailQuery = useQuery({
    queryKey: ["ac06", "draft-detail", companyId, approveMonth],
    queryFn: () => listDraftCostingRateDetail({ company_id: companyId, rate_month: approveMonth }),
    enabled: Boolean(companyId && approveMonth && approvalDrawerOpen),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const storageLocations = storageLocationsQuery.data ?? EMPTY_ROWS;
  const slocGroups = slocGroupsQuery.data ?? EMPTY_ROWS;
  const costingGroups = costingGroupsQuery.data ?? EMPTY_ROWS;
  const browseMaterials = browseMaterialsQuery.data ?? EMPTY_ROWS;
  const rateMaterials = rateMaterialsQuery.data ?? EMPTY_ROWS;
  const pendingDrafts = pendingDraftsQuery.data ?? EMPTY_ROWS;
  const draftDetailRows = draftDetailQuery.data ?? EMPTY_ROWS;

  const selectedCostingGroup = costingGroups.find((entry) => entry.id === selectedCostingGroupId) ?? null;
  const managedSlocGroup = slocGroups.find((entry) => entry.id === managedSlocGroupId) ?? null;
  const entryEditableMaterials = buildEditableMaterialSet(rateMaterials);
  const approvalEditableMaterials = buildEditableMaterialSet(draftDetailRows);

  useEffect(() => {
    setEntryRates((current) => seedRates(current, rateMaterials));
  }, [rateMaterials]);

  useEffect(() => {
    setApprovalRates((current) => seedRates(current, draftDetailRows));
  }, [draftDetailRows]);

  async function refreshAc06() {
    await qc.invalidateQueries({ queryKey: ["ac06"] });
  }

  async function submitSlocGroupCreate() {
    if (!companyId) return pushNotice("Select a company first.", "error");
    if (!newSlocGroupName.trim() || newSlocGroupLocationIds.length === 0) {
      return pushNotice("SLoc Group name and at least one storage location are required.", "error");
    }
    setSubmitting(true);
    try {
      const created = await createSlocGroup({
        company_id: companyId,
        name: newSlocGroupName,
        storage_location_ids: newSlocGroupLocationIds,
      });
      setNewSlocGroupName("");
      setNewSlocGroupLocationIds([]);
      setManagedSlocGroupId(created.id);
      pushNotice("SLoc Group created.");
      await refreshAc06();
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSlocGroupMembers() {
    if (!managedSlocGroupId || managedAddLocationIds.length === 0) {
      return pushNotice("Pick an SLoc Group and at least one storage location.", "error");
    }
    setSubmitting(true);
    try {
      await addSlocGroupMember(managedSlocGroupId, { storage_location_ids: managedAddLocationIds });
      setManagedAddLocationIds([]);
      pushNotice("SLoc Group members saved.");
      await refreshAc06();
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteSlocGroupMember(groupId, memberId) {
    setSubmitting(true);
    try {
      await removeSlocGroupMember(groupId, memberId);
      pushNotice("SLoc Group member removed.");
      await refreshAc06();
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCostingGroupFlow() {
    if (!companyId) return pushNotice("Select a company first.", "error");
    if (!drawerSlocGroupId) return pushNotice("Pick an SLoc Group first.", "error");
    if (selectedMaterialIds.length === 0) return pushNotice("Select at least one material.", "error");
    setSubmitting(true);
    try {
      let groupId = selectedCostingGroupId;
      if (costingDrawerMode === "create") {
        if (!newCostingGroupName.trim()) {
          pushNotice("Costing group name is required.", "error");
          setSubmitting(false);
          return;
        }
        const created = await createCostingGroup({ company_id: companyId, name: newCostingGroupName });
        groupId = created.id;
      }
      await addCostingGroupMembers(groupId, { material_ids: selectedMaterialIds });
      setCostingDrawerOpen(false);
      setSelectedMaterialIds([]);
      setNewCostingGroupName("");
      setSelectedCostingGroupId(groupId);
      pushNotice("Costing group members saved.");
      await refreshAc06();
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteCostingGroupMember(groupId, memberId) {
    setSubmitting(true);
    try {
      await removeCostingGroupMember(groupId, memberId);
      pushNotice("Costing group member unmapped.");
      await refreshAc06();
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEntryDraft() {
    const lines = rateMaterials
      .map((row) => ({
        material_id: row.material_id,
        rate: Number(entryRates[row.material_id] ?? row.rate ?? 0),
      }))
      .filter((row) => Number.isFinite(row.rate));
    if (!companyId || !selectedMonth || lines.length === 0) {
      return pushNotice("Company, month, and at least one row are required.", "error");
    }
    setSubmitting(true);
    try {
      await saveCostingRateDraft({ company_id: companyId, rate_month: selectedMonth, lines });
      pushNotice("Costing draft saved.");
      await refreshAc06();
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveApprovalDraft() {
    const lines = draftDetailRows
      .map((row) => ({
        material_id: row.material_id,
        rate: Number(approvalRates[row.material_id] ?? row.rate ?? 0),
      }))
      .filter((row) => Number.isFinite(row.rate));
    if (!companyId || !approveMonth || lines.length === 0) {
      return pushNotice("Draft month detail is empty.", "error");
    }
    setSubmitting(true);
    try {
      await saveCostingRateDraft({ company_id: companyId, rate_month: approveMonth, lines });
      pushNotice("Draft detail saved.");
      await refreshAc06();
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function unmapDraftDetailRow(row) {
    if (!row.current_group_id || !row.current_group_member_id) {
      return pushNotice("This material is not currently mapped to a costing group.", "error");
    }
    setSubmitting(true);
    try {
      await removeCostingGroupMember(row.current_group_id, row.current_group_member_id);
      pushNotice("Material unmapped. Save draft to refresh the month snapshot.");
      await refreshAc06();
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function approveDraftMonth() {
    if (!companyId || !approveMonth) return pushNotice("Select a draft month first.", "error");
    setSubmitting(true);
    try {
      await approveCostingRate({ company_id: companyId, rate_month: approveMonth });
      setApprovalDrawerOpen(false);
      pushNotice("Costing month approved.");
      await refreshAc06();
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  useErpScreenHotkeys({
    refresh: {
      disabled: !companyId,
      perform: () => { void refreshAc06(); },
    },
    focusPrimary: {
      disabled: false,
      perform: () => primaryFocusRef.current?.focus?.(),
    },
  });

  const managedAvailableLocations = storageLocations.filter((location) => !managedSlocGroup?.members?.some((member) => member.storage_location_id === location.id));

  return (
    <ErpScreenScaffold
      title="SLoc Costing Group"
      subtitle="AC06 v2 - material-level costing groups and month-wise rate drafting, browsed by SLoc Group."
      actions={[
        {
          label: "Manage SLoc Groups",
          tone: "secondary",
          onClick: () => setSlocManageOpen(true),
        },
        {
          label: "New Costing Group",
          tone: "primary",
          onClick: () => {
            setCostingDrawerOpen(true);
            setCostingDrawerMode("create");
            setSelectedMaterialIds([]);
            setNewCostingGroupName("");
            setDrawerSlocGroupId(slocGroupId);
          },
        },
      ]}
    >
      <ErpSectionCard title="Header">
        <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,320px)_180px]">
          <TransactionCompanySelector
            runtimeContext={runtimeContext}
            value={companyId}
            onChange={setCompanyId}
            label="Company"
            selectRef={primaryFocusRef}
          />
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            SLoc Group
            <select
              value={slocGroupId}
              onChange={(event) => setSlocGroupId(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="">Select SLoc Group</option>
              {slocGroups.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} | {entry.member_count}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Month
            <input
              type="month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-sm"
            />
          </label>
        </div>
      </ErpSectionCard>

      <div className="flex gap-2">
        <button type="button" onClick={() => setTab("entry")} className={`px-3 py-2 text-sm ${tab === "entry" ? "bg-sky-100 border-sky-700" : "bg-white border-slate-300"} border`}>
          Rate Entry
        </button>
        <button type="button" onClick={() => setTab("approve")} className={`px-3 py-2 text-sm ${tab === "approve" ? "bg-sky-100 border-sky-700" : "bg-white border-slate-300"} border`}>
          Draft Approval
        </button>
      </div>

      {tab === "entry" ? (
        <>
          <ErpSectionCard title="Current Costing Groups">
            <ErpDenseGrid
              columns={[
                { key: "name", label: "Group", render: (row) => row.name },
                { key: "member_count", label: "Members", render: (row) => row.member_count },
                {
                  key: "member_preview",
                  label: "Member Preview",
                  render: (row) => (row.members ?? []).slice(0, 3).map((member) => member.pace_code).join(", ") || "-",
                },
                {
                  key: "action",
                  label: "Action",
                  render: (row) => (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCostingGroupId(row.id);
                        setCostingDrawerOpen(true);
                        setCostingDrawerMode("existing");
                        setSelectedMaterialIds([]);
                        setDrawerSlocGroupId(slocGroupId);
                      }}
                      className="border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      Add Members
                    </button>
                  ),
                },
              ]}
              rows={costingGroups}
              rowKey={(row) => row.id}
              emptyMessage="No costing groups yet."
            />
            {selectedCostingGroup ? (
              <div className="mt-4">
                <SectionMembers group={selectedCostingGroup} onRemove={deleteCostingGroupMember} busy={submitting} />
              </div>
            ) : null}
          </ErpSectionCard>

          <ErpSectionCard title="Rate Chart Entry">
            <div className="mb-4 flex justify-between gap-3">
              <div className="grid gap-3 md:grid-cols-3">
                <ErpFieldPreview label="Visible Materials" value={String(rateMaterials.length)} />
                <ErpFieldPreview label="Grouped Materials" value={String(rateMaterials.filter((row) => row.group_id).length)} />
                <ErpFieldPreview label="Ungrouped Materials" value={String(rateMaterials.filter((row) => !row.group_id).length)} />
              </div>
              <button
                type="button"
                onClick={() => void saveEntryDraft()}
                disabled={submitting || rateMaterials.length === 0}
                className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950"
              >
                {submitting ? "Saving..." : "Save Draft"}
              </button>
            </div>
            <ErpDenseGrid
              columns={[
                { key: "pace_code", label: "Material", render: (row) => `${row.pace_code} | ${row.material_name}` },
                { key: "group_name", label: "Costing Group", render: (row) => row.group_name || "-" },
                {
                  key: "rate",
                  label: "Rate",
                  render: (row) => (
                    entryEditableMaterials.has(row.material_id) ? (
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={entryRates[row.material_id] ?? row.rate ?? ""}
                        onChange={(event) => updateGroupedRate(setEntryRates, rateMaterials, row.material_id, event.target.value, row.group_id)}
                        className="h-8 w-28 border border-slate-300 px-2 text-sm"
                      />
                    ) : (
                      <span className="text-sm text-slate-700">{entryRates[row.material_id] ?? row.rate ?? "-"}</span>
                    )
                  ),
                },
                {
                  key: "edit_rule",
                  label: "Edit Rule",
                  render: (row) => (row.group_id ? (entryEditableMaterials.has(row.material_id) ? "Lead Row" : "Auto") : "Direct"),
                },
                { key: "status", label: "Status", render: (row) => row.status || "NEW" },
              ]}
              rows={rateMaterials}
              rowKey={(row) => row.material_id}
              emptyMessage="Select company, SLoc Group, and month to load materials."
            />
          </ErpSectionCard>
        </>
      ) : (
        <ErpSectionCard title="Pending Draft Months">
          <ErpDenseGrid
            columns={[
              { key: "rate_month", label: "Month" },
              { key: "line_count", label: "Drafted Rows" },
              { key: "filled_count", label: "Rate > 0" },
              {
                key: "action",
                label: "Action",
                render: (row) => (
                  <button
                    type="button"
                    onClick={() => {
                      setApproveMonth(row.rate_month);
                      setApprovalDrawerOpen(true);
                    }}
                    className="border border-slate-300 bg-white px-2 py-1 text-xs"
                  >
                    Open Detail
                  </button>
                ),
              },
            ]}
            rows={pendingDrafts}
            rowKey={(row) => row.rate_month}
            emptyMessage="No pending draft months."
          />
        </ErpSectionCard>
      )}

      <DrawerBase
        visible={costingDrawerOpen}
        title={costingDrawerMode === "create" ? "Create Costing Group" : "Add To Existing Costing Group"}
        onClose={() => setCostingDrawerOpen(false)}
        width="min(920px, calc(100vw - 24px))"
      >
        <div className="grid gap-4 p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Mode
              <select value={costingDrawerMode} onChange={(event) => setCostingDrawerMode(event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm">
                <option value="create">Create New Group</option>
                <option value="existing">Select Existing Group</option>
              </select>
            </label>
            {costingDrawerMode === "create" ? (
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Costing Group Name
                <input value={newCostingGroupName} onChange={(event) => setNewCostingGroupName(event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm" />
              </label>
            ) : (
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Costing Group
                <select value={selectedCostingGroupId} onChange={(event) => setSelectedCostingGroupId(event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm">
                  <option value="">Select costing group</option>
                  {costingGroups.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} | {entry.member_count}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Browse SLoc Group
              <select value={drawerSlocGroupId} onChange={(event) => setDrawerSlocGroupId(event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm">
                <option value="">Select SLoc Group</option>
                {slocGroups.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} | {entry.member_count}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ErpDenseGrid
            columns={[
              {
                key: "pick",
                label: "Pick",
                render: (row) => (
                  <input
                    type="checkbox"
                    checked={selectedMaterialIds.includes(row.material_id)}
                    onChange={() => setSelectedMaterialIds((current) => toggleInList(current, row.material_id))}
                  />
                ),
              },
              { key: "pace_code", label: "Material", render: (row) => `${row.pace_code} | ${row.material_name}` },
              { key: "group_name", label: "Current Group", render: (row) => row.group_name || "-" },
              { key: "rate", label: "Current Rate", render: (row) => row.rate ?? "-" },
            ]}
            rows={browseMaterials}
            rowKey={(row) => row.material_id}
            emptyMessage="Pick a browse SLoc Group to load materials."
          />

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setCostingDrawerOpen(false)} className="border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">
              Cancel
            </button>
            <button type="button" onClick={() => void submitCostingGroupFlow()} disabled={submitting} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
              {submitting ? "Saving..." : "Save Members"}
            </button>
          </div>
        </div>
      </DrawerBase>

      <DrawerBase
        visible={slocManageOpen}
        title="Manage SLoc Groups"
        onClose={() => setSlocManageOpen(false)}
        width="min(1120px, calc(100vw - 24px))"
      >
        <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <div className="grid gap-4">
            <ErpSectionCard title="Create SLoc Group">
              <div className="grid gap-3">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  SLoc Group Name
                  <input value={newSlocGroupName} onChange={(event) => setNewSlocGroupName(event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm" />
                </label>
                <div className="grid gap-2">
                  <div className="text-xs font-semibold text-slate-700">Storage Locations</div>
                  <div className="max-h-64 overflow-auto border border-slate-200 p-2">
                    {storageLocations.map((entry) => (
                      <label key={entry.id} className="flex items-center gap-2 py-1 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={newSlocGroupLocationIds.includes(entry.id)}
                          onChange={() => setNewSlocGroupLocationIds((current) => toggleInList(current, entry.id))}
                        />
                        <span>{entry.storage_location_code} | {entry.storage_location_name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={() => void submitSlocGroupCreate()} disabled={submitting} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
                  {submitting ? "Saving..." : "Create SLoc Group"}
                </button>
              </div>
            </ErpSectionCard>

            <ErpSectionCard title="Existing SLoc Groups">
              <ErpDenseGrid
                columns={[
                  { key: "name", label: "Group", render: (row) => row.name },
                  { key: "member_count", label: "Members", render: (row) => row.member_count },
                  {
                    key: "action",
                    label: "Action",
                    render: (row) => (
                      <button type="button" onClick={() => setManagedSlocGroupId(row.id)} className="border border-slate-300 bg-white px-2 py-1 text-xs">
                        Manage
                      </button>
                    ),
                  },
                ]}
                rows={slocGroups}
                rowKey={(row) => row.id}
                emptyMessage="No SLoc Groups yet."
              />
            </ErpSectionCard>
          </div>

          <ErpSectionCard title={managedSlocGroup ? `Members - ${managedSlocGroup.name}` : "Members"}>
            {managedSlocGroup ? (
              <div className="grid gap-4">
                <ErpDenseGrid
                  columns={[
                    {
                      key: "storage_location",
                      label: "Storage Location",
                      render: (row) => `${row.storage_location_code} | ${row.storage_location_name}`,
                    },
                    {
                      key: "action",
                      label: "Action",
                      render: (row) => (
                        <button
                          type="button"
                          onClick={() => void deleteSlocGroupMember(managedSlocGroup.id, row.id)}
                          disabled={submitting}
                          className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700"
                        >
                          Remove
                        </button>
                      ),
                    },
                  ]}
                  rows={managedSlocGroup.members ?? []}
                  rowKey={(row) => row.id}
                  emptyMessage="No members yet."
                />

                <div className="grid gap-2">
                  <div className="text-xs font-semibold text-slate-700">Add More Storage Locations</div>
                  <div className="max-h-64 overflow-auto border border-slate-200 p-2">
                    {managedAvailableLocations.map((entry) => (
                      <label key={entry.id} className="flex items-center gap-2 py-1 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={managedAddLocationIds.includes(entry.id)}
                          onChange={() => setManagedAddLocationIds((current) => toggleInList(current, entry.id))}
                        />
                        <span>{entry.storage_location_code} | {entry.storage_location_name}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <button type="button" onClick={() => void submitSlocGroupMembers()} disabled={submitting} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
                      {submitting ? "Saving..." : "Add Locations"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">Select an SLoc Group to manage its members.</div>
            )}
          </ErpSectionCard>
        </div>
      </DrawerBase>

      <DrawerBase
        visible={approvalDrawerOpen}
        title={approveMonth ? `Draft Detail - ${approveMonth}` : "Draft Detail"}
        onClose={() => setApprovalDrawerOpen(false)}
        width="min(1080px, calc(100vw - 24px))"
      >
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div className="grid gap-3 md:grid-cols-3">
              <ErpFieldPreview label="Month" value={approveMonth || "-"} />
              <ErpFieldPreview label="Draft Rows" value={String(draftDetailRows.length)} />
              <ErpFieldPreview label="Lead Editable Rows" value={String(approvalEditableMaterials.size)} />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => void saveApprovalDraft()} disabled={submitting || draftDetailRows.length === 0} className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                {submitting ? "Saving..." : "Save Draft"}
              </button>
              <button type="button" onClick={() => void approveDraftMonth()} disabled={submitting || draftDetailRows.length === 0} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
                {submitting ? "Approving..." : "Approve Month"}
              </button>
            </div>
          </div>

          <ErpDenseGrid
            columns={[
              { key: "pace_code", label: "Material", render: (row) => `${row.pace_code} | ${row.material_name}` },
              { key: "group_name", label: "Snapshot Group", render: (row) => row.group_name || "-" },
              {
                key: "rate",
                label: "Rate",
                render: (row) => (
                  approvalEditableMaterials.has(row.material_id) ? (
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={approvalRates[row.material_id] ?? row.rate ?? ""}
                      onChange={(event) => updateGroupedRate(setApprovalRates, draftDetailRows, row.material_id, event.target.value, row.group_id)}
                      className="h-8 w-28 border border-slate-300 px-2 text-sm"
                    />
                  ) : (
                    <span className="text-sm text-slate-700">{approvalRates[row.material_id] ?? row.rate ?? "-"}</span>
                  )
                ),
              },
              {
                key: "current_group_name",
                label: "Current Group",
                render: (row) => row.current_group_name || "-",
              },
              {
                key: "action",
                label: "Unmap",
                render: (row) => (
                  row.current_group_member_id ? (
                    <button
                      type="button"
                      onClick={() => void unmapDraftDetailRow(row)}
                      disabled={submitting}
                      className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700"
                    >
                      Unmap
                    </button>
                  ) : "-"
                ),
              },
            ]}
            rows={draftDetailRows}
            rowKey={(row) => row.id}
            emptyMessage="No drafted rows found for this month."
          />
        </div>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}

function SectionMembers({ group, onRemove, busy }) {
  return (
    <ErpSectionCard title={`Members - ${group.name}`}>
      <ErpDenseGrid
        columns={[
          { key: "pace_code", label: "Material", render: (row) => `${row.pace_code} | ${row.material_name}` },
          {
            key: "action",
            label: "Action",
            render: (row) => (
              <button type="button" onClick={() => void onRemove(group.id, row.id)} disabled={busy} className="border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                Unmap
              </button>
            ),
          },
        ]}
        rows={group.members ?? []}
        rowKey={(row) => row.id}
        emptyMessage="No members in this group."
      />
    </ErpSectionCard>
  );
}
