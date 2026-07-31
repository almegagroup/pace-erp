import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { listStorageLocations } from "../om/omApi.js";
import {
  addCostingGroupMembers,
  approveCostingRate,
  createCostingGroup,
  listCostingGroups,
  listCostingRateMaterials,
  listPendingCostingDrafts,
  removeCostingGroupMember,
  saveCostingRateDraft,
} from "./prodApi.js";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function noticeFor(error) {
  return error?.message || "Request failed.";
}

export default function SlocCostingGroupPage() {
  const { runtimeContext } = useMenu();
  const qc = useQueryClient();
  const primaryFocusRef = useRef(null);
  const [companyId, setCompanyId] = useState("");
  const [storageLocationId, setStorageLocationId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [approveMonth, setApproveMonth] = useState("");
  const [tab, setTab] = useState("entry");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [groupMode, setGroupMode] = useState("create");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [drawerStorageLocationId, setDrawerStorageLocationId] = useState("");
  const [selectedMaterialIds, setSelectedMaterialIds] = useState([]);
  const [rates, setRates] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState({ message: "", tone: "success" });

  useEffect(() => {
    if (!companyId) {
      const defaultCompany = String(runtimeContext?.selectedCompanyId ?? "").trim();
      if (defaultCompany) setCompanyId(defaultCompany);
    }
  }, [companyId, runtimeContext]);

  function pushNotice(message, tone = "success") {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice({ message: "", tone: "success" }), 4500);
  }

  const storageLocationsQuery = useQuery({
    queryKey: ["ac06", "storage-locations", companyId],
    queryFn: () => listStorageLocations({ company_id: companyId, is_active: true }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const groupsQuery = useQuery({
    queryKey: ["ac06", "groups", companyId],
    queryFn: () => listCostingGroups({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const browseMaterialsQuery = useQuery({
    queryKey: ["ac06", "materials", companyId, drawerStorageLocationId, selectedMonth],
    queryFn: () => listCostingRateMaterials({ company_id: companyId, storage_location_id: drawerStorageLocationId, rate_month: selectedMonth }),
    enabled: Boolean(companyId && drawerStorageLocationId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const rateMaterialsQuery = useQuery({
    queryKey: ["ac06", "rate-materials", companyId, storageLocationId, selectedMonth],
    queryFn: () => listCostingRateMaterials({ company_id: companyId, storage_location_id: storageLocationId, rate_month: selectedMonth }),
    enabled: Boolean(companyId && storageLocationId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const pendingDraftsQuery = useQuery({
    queryKey: ["ac06", "pending-drafts", companyId],
    queryFn: () => listPendingCostingDrafts({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? []),
  });

  const storageLocationOptions = storageLocationsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const browseMaterials = browseMaterialsQuery.data ?? [];
  const rateMaterials = rateMaterialsQuery.data ?? [];
  const pendingDrafts = pendingDraftsQuery.data ?? [];

  useEffect(() => {
    setRates((current) => {
      const next = { ...current };
      let changed = false;
      for (const row of rateMaterials) {
        if (!(row.material_id in next) && row.rate != null) {
          next[row.material_id] = String(row.rate);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [rateMaterials]);

  const selectedGroup = useMemo(
    () => groups.find((entry) => entry.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  function toggleMaterial(materialId) {
    setSelectedMaterialIds((current) => (
      current.includes(materialId)
        ? current.filter((entry) => entry !== materialId)
        : [...current, materialId]
    ));
  }

  function updateRate(materialId, nextValue, groupId) {
    setRates((current) => {
      const next = { ...current, [materialId]: nextValue };
      if (groupId) {
        for (const row of rateMaterials) {
          if (row.group_id === groupId) next[row.material_id] = nextValue;
        }
      }
      return next;
    });
  }

  async function submitGroupFlow() {
    if (!companyId) return pushNotice("Select a company first.", "error");
    if (!drawerStorageLocationId) return pushNotice("Pick a storage location first.", "error");
    if (selectedMaterialIds.length === 0) return pushNotice("Select at least one material.", "error");
    setSubmitting(true);
    try {
      let groupId = selectedGroupId;
      if (groupMode === "create") {
        if (!newGroupName.trim()) {
          pushNotice("Group name is required.", "error");
          setSubmitting(false);
          return;
        }
        const created = await createCostingGroup({ company_id: companyId, name: newGroupName });
        groupId = created.id;
      }
      await addCostingGroupMembers(groupId, {
        storage_location_id: drawerStorageLocationId,
        material_ids: selectedMaterialIds,
      });
      pushNotice("Costing group members saved.");
      setDrawerOpen(false);
      setSelectedMaterialIds([]);
      setNewGroupName("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ac06", "groups", companyId] }),
        qc.invalidateQueries({ queryKey: ["ac06", "materials"] }),
        qc.invalidateQueries({ queryKey: ["ac06", "rate-materials"] }),
      ]);
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeMember(groupId, memberId) {
    setSubmitting(true);
    try {
      await removeCostingGroupMember(groupId, memberId);
      pushNotice("Group member unmapped.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ac06", "groups", companyId] }),
        qc.invalidateQueries({ queryKey: ["ac06", "materials"] }),
        qc.invalidateQueries({ queryKey: ["ac06", "rate-materials"] }),
      ]);
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveDraft() {
    const lines = rateMaterials
      .map((row) => ({
        material_id: row.material_id,
        rate: Number(rates[row.material_id] ?? row.rate ?? 0),
      }))
      .filter((row) => Number.isFinite(row.rate));
    if (!companyId || !selectedMonth || lines.length === 0) {
      return pushNotice("Company, month, and at least one row are required.", "error");
    }
    setSubmitting(true);
    try {
      await saveCostingRateDraft({
        company_id: companyId,
        rate_month: selectedMonth,
        lines,
      });
      pushNotice("Costing draft saved.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ac06", "rate-materials"] }),
        qc.invalidateQueries({ queryKey: ["ac06", "pending-drafts"] }),
      ]);
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
      pushNotice("Costing month approved.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ac06", "pending-drafts"] }),
        qc.invalidateQueries({ queryKey: ["ac06", "rate-materials"] }),
      ]);
    } catch (error) {
      pushNotice(noticeFor(error), "error");
    } finally {
      setSubmitting(false);
    }
  }

  useErpScreenHotkeys({
    refresh: {
      disabled: !companyId,
      perform: () => { void qc.invalidateQueries({ queryKey: ["ac06"] }); },
    },
    focusPrimary: {
      disabled: false,
      perform: () => primaryFocusRef.current?.focus?.(),
    },
  });

  return (
    <ErpScreenScaffold
      title="SLoc Costing Group"
      subtitle="AC06 - material-level costing groups and month-wise draft/approve rate chart, browsed by storage location."
      notice={notice.message ? notice : null}
      actions={[
        {
          label: "New Group",
          tone: "primary",
          onClick: () => {
            setDrawerOpen(true);
            setGroupMode("create");
            setSelectedGroupId("");
            setDrawerStorageLocationId(storageLocationId);
            setSelectedMaterialIds([]);
          },
        },
      ]}
    >
      <ErpSectionCard title="Header">
        <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,260px)_180px]">
          <TransactionCompanySelector
            runtimeContext={runtimeContext}
            value={companyId}
            onChange={setCompanyId}
            label="Company"
            selectRef={primaryFocusRef}
          />
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Storage Location
            <select
              value={storageLocationId}
              onChange={(event) => setStorageLocationId(event.target.value)}
              className="h-9 border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="">Select storage location</option>
              {storageLocationOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.storage_location_code} | {entry.storage_location_name}
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
          Approve
        </button>
      </div>

      {tab === "entry" ? (
        <>
          <ErpSectionCard title="Current Groups">
            <ErpDenseGrid
              columns={[
                { key: "name", label: "Group", render: (row) => row.name },
                { key: "member_count", label: "Members", render: (row) => row.member_count },
                {
                  key: "members",
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
                        setDrawerOpen(true);
                        setGroupMode("existing");
                        setSelectedGroupId(row.id);
                        setDrawerStorageLocationId(storageLocationId);
                        setSelectedMaterialIds([]);
                      }}
                      className="border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      Add Members
                    </button>
                  ),
                },
              ]}
              rows={groups}
              rowKey={(row) => row.id}
              emptyMessage="No costing groups yet."
            />
            {selectedGroup ? (
              <div className="mt-4 grid gap-3">
                <SectionMembers group={selectedGroup} onRemove={removeMember} busy={submitting} />
              </div>
            ) : null}
          </ErpSectionCard>

          <ErpSectionCard title="Rate Chart Entry">
            <div className="mb-4 flex justify-between gap-3">
              <ErpFieldPreview label="Visible Materials" value={String(rateMaterials.length)} />
              <button type="button" onClick={() => void saveDraft()} disabled={submitting || rateMaterials.length === 0} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
                {submitting ? "Saving..." : "Save Draft"}
              </button>
            </div>
            <ErpDenseGrid
              columns={[
                { key: "pace_code", label: "Material", render: (row) => `${row.pace_code} | ${row.material_name}` },
                { key: "group_name", label: "Group", render: (row) => row.group_name || "-" },
                {
                  key: "rate",
                  label: "Rate",
                  render: (row) => (
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={rates[row.material_id] ?? row.rate ?? ""}
                      onChange={(event) => updateRate(row.material_id, event.target.value, row.group_id)}
                      className="h-8 w-28 border border-slate-300 px-2 text-sm"
                    />
                  ),
                },
                { key: "status", label: "Status", render: (row) => row.status || "NEW" },
              ]}
              rows={rateMaterials}
              rowKey={(row) => row.material_id}
              emptyMessage="Select company, storage location, and month to load materials."
            />
          </ErpSectionCard>
        </>
      ) : (
        <ErpSectionCard title="Approve Draft Month">
          <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_160px]">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Draft Month
              <select value={approveMonth} onChange={(event) => setApproveMonth(event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm">
                <option value="">Select draft month</option>
                {pendingDrafts.map((entry) => (
                  <option key={entry.rate_month} value={entry.rate_month}>
                    {entry.rate_month} | {entry.filled_count}/{entry.line_count}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button type="button" onClick={() => void approveDraftMonth()} disabled={submitting || !approveMonth} className="h-9 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950">
                {submitting ? "Approving..." : "Approve"}
              </button>
            </div>
          </div>
          <div className="mt-4">
            <ErpDenseGrid
              columns={[
                { key: "rate_month", label: "Month" },
                { key: "line_count", label: "Drafted Rows" },
                { key: "filled_count", label: "Rate > 0" },
              ]}
              rows={pendingDrafts}
              rowKey={(row) => row.rate_month}
              emptyMessage="No pending draft months."
            />
          </div>
        </ErpSectionCard>
      )}

      <DrawerBase
        visible={drawerOpen}
        title={groupMode === "create" ? "Create Costing Material Group" : "Add To Existing Group"}
        onClose={() => setDrawerOpen(false)}
        width="min(880px, calc(100vw - 24px))"
      >
        <div className="grid gap-4 p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Mode
              <select value={groupMode} onChange={(event) => setGroupMode(event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm">
                <option value="create">Create New Group</option>
                <option value="existing">Select Existing Group</option>
              </select>
            </label>
            {groupMode === "create" ? (
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Group Name
                <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm" />
              </label>
            ) : (
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Group
                <select value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm">
                  <option value="">Select group</option>
                  {groups.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} | {entry.member_count}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Browse Storage Location
              <select value={drawerStorageLocationId} onChange={(event) => setDrawerStorageLocationId(event.target.value)} className="h-9 border border-slate-300 bg-white px-3 text-sm">
                <option value="">Select storage location</option>
                {storageLocationOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.storage_location_code} | {entry.storage_location_name}
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
                    onChange={() => toggleMaterial(row.material_id)}
                  />
                ),
              },
              { key: "pace_code", label: "Material", render: (row) => `${row.pace_code} | ${row.material_name}` },
              { key: "group_name", label: "Current Group", render: (row) => row.group_name || "-" },
              { key: "rate", label: "Current Rate", render: (row) => row.rate ?? "-" },
            ]}
            rows={browseMaterials}
            rowKey={(row) => row.material_id}
            emptyMessage="Pick a browse storage location to load materials."
          />

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setDrawerOpen(false)} className="border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">
              Cancel
            </button>
            <button type="button" onClick={() => void submitGroupFlow()} disabled={submitting} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
              {submitting ? "Saving..." : "Save Members"}
            </button>
          </div>
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
            key: "added_from",
            label: "Added From",
            render: (row) => row.storage_location_code ? `${row.storage_location_code} | ${row.storage_location_name}` : "-",
          },
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
