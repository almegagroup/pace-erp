/*
 * File-Path: frontend/src/admin/sa/screens/SAProcTransferGroupPage.jsx
 * Domain: PROCUREMENT / PO12 Tab 2
 * Purpose: SA "PTO Company" page — Transfer Group allow-list master. A group's member
 *          companies may freely do PO12 Tab 2 returnable transfers among themselves; no
 *          two active groups may share the exact same member-set.
 *          Design: docs/PROCUREMENT-DESIGN-DOC.md "PO12 (PTO) — Tab 1 Design" ->
 *          "Tab 2 ... FINAL DESIGN LOCKED" (2026-10-05).
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { pushToast } from "../../../store/uiToast.js";
import { listCompaniesForOm } from "../../../pages/dashboard/om/omApi.js";
import { listTransferGroups, upsertTransferGroup, toggleTransferGroup } from "../../../pages/dashboard/procurement/procurementApi.js";

const ERRORS = {
  TRANSFER_GROUP_MIN_MEMBERS: "A group needs at least 2 distinct companies.",
  TRANSFER_GROUP_NAME_REQUIRED: "Group Name is mandatory.",
  TRANSFER_GROUP_NOT_FOUND: "Group not found.",
};

function friendly(code) {
  if (!code) return "Save failed.";
  const prefix = "TRANSFER_GROUP_DUPLICATE_MEMBERS";
  if (code.startsWith(prefix)) {
    const existing = code.slice(prefix.length).replace(/^:\s*/, "");
    return existing ? `This exact company combination already exists as "${existing}".` : "This exact company combination already exists as another group.";
  }
  return ERRORS[code] ?? code;
}

function signatureOf(ids) {
  return [...new Set(ids)].sort().join(",");
}

export default function SAProcTransferGroupPage() {
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [groupName, setGroupName] = useState("");
  const [selectedCompanyIds, setSelectedCompanyIds] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const companiesQuery = useQuery({ queryKey: ["sa-transfer-group-companies"], queryFn: listCompaniesForOm });
  const groupsQuery = useQuery({ queryKey: ["sa-transfer-groups"], queryFn: listTransferGroups });

  const companies = companiesQuery.data ?? [];
  const groups = useMemo(() => (Array.isArray(groupsQuery.data) ? groupsQuery.data : []), [groupsQuery.data]);

  const existingSignatures = useMemo(
    () => new Map(
      groups
        .filter((group) => group.is_active && group.id !== editingGroupId)
        .map((group) => [signatureOf((group.members ?? []).map((member) => member.id)), group.group_name]),
    ),
    [groups, editingGroupId],
  );

  const currentSignature = signatureOf(selectedCompanyIds);
  const duplicateOfName = selectedCompanyIds.length >= 2 ? existingSignatures.get(currentSignature) : null;
  const canSave = Boolean(groupName.trim()) && selectedCompanyIds.length >= 2 && !duplicateOfName;

  function openCreate() {
    setEditingGroupId(null);
    setGroupName("");
    setSelectedCompanyIds([]);
    setError("");
    setDrawerOpen(true);
  }

  function openEdit(group) {
    setEditingGroupId(group.id);
    setGroupName(group.group_name ?? "");
    setSelectedCompanyIds((group.members ?? []).map((member) => member.id));
    setError("");
    setDrawerOpen(true);
  }

  function toggleCompany(companyId) {
    setSelectedCompanyIds((current) =>
      current.includes(companyId) ? current.filter((id) => id !== companyId) : [...current, companyId]);
  }

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      await upsertTransferGroup({ group_id: editingGroupId, group_name: groupName.trim(), company_ids: selectedCompanyIds });
      pushToast({ tone: "success", message: "Transfer Group saved." });
      setDrawerOpen(false);
      await qc.invalidateQueries({ queryKey: ["sa-transfer-groups"] });
    } catch (saveError) {
      setError(friendly(saveError?.code ?? saveError?.message));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(group) {
    try {
      await toggleTransferGroup(group.id, !group.is_active);
      pushToast({ tone: "success", message: group.is_active ? "Group deactivated." : "Group activated." });
      await qc.invalidateQueries({ queryKey: ["sa-transfer-groups"] });
    } catch (toggleError) {
      pushToast({ tone: "error", message: friendly(toggleError?.code ?? toggleError?.message) });
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="SA / Procurement"
      title="PTO Company"
      actions={[{ key: "new", label: "+ New Group", tone: "primary", onClick: openCreate }]}
    >
      <ErpSectionCard eyebrow="Transfer Groups" title="PO12 Tab 2 allow-list">
        <p className="mb-3 text-xs text-slate-500">
          Companies in the same active group can freely do PO12 Tab 2 (returnable material) transfers among themselves.
          No two active groups may share the exact same company combination.
        </p>
        <ErpDenseGrid
          columns={[
            { key: "group_name", label: "Group Name", width: "220px" },
            {
              key: "members",
              label: "Member Companies",
              width: "360px",
              render: (row) => (row.members ?? []).map((member) => member.label).join(", ") || "—",
            },
            { key: "member_count", label: "Count", width: "80px", render: (row) => (row.members ?? []).length },
            {
              key: "is_active",
              label: "Status",
              width: "100px",
              render: (row) => (row.is_active ? <span className="text-emerald-700">Active</span> : <span className="text-slate-400">Inactive</span>),
            },
            {
              key: "action",
              label: "Action",
              width: "160px",
              render: (row) => (
                <div className="flex gap-2">
                  <button type="button" onClick={() => openEdit(row)} className="border border-sky-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-sky-700">
                    Edit
                  </button>
                  <button type="button" onClick={() => void handleToggle(row)} className="border border-slate-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-700">
                    {row.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              ),
            },
          ]}
          rows={groups}
          rowKey={(row) => row.id}
          emptyMessage={groupsQuery.isLoading ? "Loading..." : "No Transfer Group yet."}
          maxHeight="calc(100vh - 320px)"
        />
      </ErpSectionCard>

      <DrawerBase
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onEscape={() => setDrawerOpen(false)}
        side="center"
        width="min(620px, calc(100vw - 24px))"
        title={editingGroupId ? "Edit Transfer Group" : "New Transfer Group"}
        actions={(
          <>
            <button type="button" onClick={() => setDrawerOpen(false)} className="h-8 border border-slate-300 bg-white px-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave || saving}
              className="h-8 border border-sky-700 bg-sky-100 px-4 text-xs font-semibold uppercase tracking-[0.12em] text-sky-950 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        )}
      >
        {error ? <div className="mb-3 text-xs font-semibold text-rose-700">{error}</div> : null}
        {duplicateOfName ? (
          <div className="mb-3 text-xs font-semibold text-rose-700">
            This exact combination already exists — "{duplicateOfName}".
          </div>
        ) : null}
        <label className="mb-3 grid gap-1 text-xs font-semibold text-slate-700">
          Group Name <span className="text-rose-500">*</span>
          <input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="e.g. Jayashree-Coatings"
            className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
          />
        </label>
        <div className="text-xs font-semibold text-slate-700">Member Companies (min 2)</div>
        <div className="mt-1 grid max-h-[min(360px,50vh)] gap-1 overflow-y-auto border border-slate-200 p-2">
          {companies.map((company) => (
            <label key={company.id} className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={selectedCompanyIds.includes(company.id)}
                onChange={() => toggleCompany(company.id)}
              />
              {company.company_code} — {company.company_name}
            </label>
          ))}
        </div>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
