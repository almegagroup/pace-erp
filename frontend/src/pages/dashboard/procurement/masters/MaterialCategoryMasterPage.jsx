/*
 * File-ID: 26.5
 * File-Path: frontend/src/pages/dashboard/procurement/masters/MaterialCategoryMasterPage.jsx
 * Gate: 26
 * Domain: PROCUREMENT
 * Purpose: Material Category Groups master page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openActionConfirm } from "../../../../store/actionConfirm.js";
import {
  addMaterialCategoryMember,
  createMaterialCategoryGroup,
  deleteMaterialCategoryGroup,
  listMaterialCategoryGroups,
  removeMaterialCategoryMember,
  updateMaterialCategoryGroup,
} from "../../om/omApi.js";
import { useMaterialOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";

const ERROR_LABELS = {
  OM_MCG_LIST_FAILED:        "Failed to load category groups.",
  OM_MCG_CREATE_FAILED:      "Could not create group. Check required fields.",
  OM_MCG_MEMBER_ADD_FAILED:  "Could not add member.",
  OM_MCG_MEMBER_REMOVE_FAILED: "Could not remove member.",
  OM_CATEGORY_GROUP_EXISTS:  "A group with this name already exists.",
  OM_MEMBER_EXISTS:          "This material is already a member of this group.",
  OM_MCG_UPDATE_FAILED:      "Could not update group.",
  OM_MCG_DELETE_FAILED:      "Could not delete group.",
  OM_MCG_HAS_MEMBERS:        "Remove all members before deleting this group.",
};

function label(code) {
  return ERROR_LABELS[code] || code;
}

export default function MaterialCategoryMasterPage() {
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId]     = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");
  const [notice, setNotice]           = useState("");

  useEffect(() => {
    if (companyId) return;
    const defaultId = resolveDefaultTransactionCompanyId(runtimeContext);
    if (defaultId) setCompanyId(defaultId);
  }, [companyId, runtimeContext]);

  const materialQuery = useMaterialOptionsQuery({ limit: 500, offset: 0 });
  const groupQuery = useQuery({
    queryKey: ["procurement", "material-category-groups", companyId],
    queryFn: async () => {
      const gResult = await listMaterialCategoryGroups(companyId);
      return Array.isArray(gResult?.data) ? gResult.data : [];
    },
    enabled: Boolean(companyId),
  });
  const groups = groupQuery.data ?? [];
  const materials = materialQuery.materials;
  const loading = groupQuery.isLoading || materialQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void Promise.all([groupQuery.refetch(), materialQuery.refetch()]),
    },
  });

  const queryError =
    groupQuery.error?.message ||
    materialQuery.error?.message ||
    "";

  const [expandedId, setExpandedId]   = useState(null);
  const [matSearch, setMatSearch]     = useState("");
  const [memberForm, setMemberForm]   = useState({ material_id: "", is_primary: false });

  const [editId, setEditId]           = useState(null);
  const [editDraft, setEditDraft]     = useState({});

  const [form, setForm]               = useState({ group_name: "", description: "" });

  const materialMap = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  const matOptions = useMemo(() => {
    const q = matSearch.trim().toLowerCase();
    const list = q
      ? materials.filter((m) =>
          `${m.pace_code || ""} ${m.material_name || ""}`.toLowerCase().includes(q)
        )
      : materials;
    return list.slice(0, 60);
  }, [matSearch, materials]);

  function startEdit(group, e) {
    e.stopPropagation();
    setEditId(group.id);
    setEditDraft({ group_name: group.group_name, description: group.description || "" });
    setExpandedId(null);
    setError("");
    setNotice("");
  }

  function cancelEdit(e) {
    e?.stopPropagation();
    setEditId(null);
    setEditDraft({});
  }

  async function saveEdit(group, e) {
    e.stopPropagation();
    if (!editDraft.group_name?.trim()) { setError("Group name is required."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await updateMaterialCategoryGroup({ id: group.id, group_name: editDraft.group_name.trim(), description: editDraft.description.trim() || null });
      setNotice("Group updated.");
      setEditId(null); setEditDraft({});
      await Promise.all([groupQuery.refetch(), materialQuery.refetch()]);
    } catch (e) { setError(label(e instanceof Error ? e.message : "OM_MCG_UPDATE_FAILED")); }
    finally { setSaving(false); }
  }

  async function handleDelete(group, e) {
    e.stopPropagation();
    const confirmed = await openActionConfirm({
      eyebrow: "Category Group",
      title: `Delete "${group.group_name}"?`,
      message: "This cannot be undone. Group must have no members.",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await deleteMaterialCategoryGroup(group.id);
      setNotice("Group deleted.");
      if (expandedId === group.id) setExpandedId(null);
      await Promise.all([groupQuery.refetch(), materialQuery.refetch()]);
    } catch (e) { setError(label(e instanceof Error ? e.message : "OM_MCG_DELETE_FAILED")); }
    finally { setSaving(false); }
  }

  function toggleExpand(group) {
    if (expandedId === group.id) {
      setExpandedId(null);
    } else {
      setExpandedId(group.id);
      setMatSearch("");
      setMemberForm({ material_id: "", is_primary: false });
    }
    setError("");
    setNotice("");
  }

  async function handleAddMember(group) {
    if (!memberForm.material_id) {
      setError("Select a material first.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await addMaterialCategoryMember({
        group_id: group.id,
        material_id: memberForm.material_id,
        is_primary: memberForm.is_primary,
      });
      setMemberForm({ material_id: "", is_primary: false });
      setMatSearch("");
      setNotice("Member added.");
      await Promise.all([groupQuery.refetch(), materialQuery.refetch()]);
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_MCG_MEMBER_ADD_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveMember(member, groupName) {
    const mat = materialMap.get(member.material_id);
    const matLabel = mat ? `${mat.pace_code} | ${mat.material_name}` : member.material_id;
    const confirmed = await openActionConfirm({
      eyebrow: "Category Group",
      title: `Remove member from "${groupName}"?`,
      message: matLabel,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await removeMaterialCategoryMember(member.id);
      setNotice("Member removed.");
      await Promise.all([groupQuery.refetch(), materialQuery.refetch()]);
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_MCG_MEMBER_REMOVE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    if (!form.group_name.trim()) {
      setError("Group name is required.");
      return;
    }
    if (!companyId) {
      setError("Select a company first.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createMaterialCategoryGroup({
        group_name: form.group_name.trim(),
        description: form.description.trim() || null,
        company_id: companyId,
      });
      setForm({ group_name: "", description: "" });
      setNotice("Category group created.");
      await Promise.all([groupQuery.refetch(), materialQuery.refetch()]);
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_MCG_CREATE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="Material Category Groups"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void Promise.all([groupQuery.refetch(), materialQuery.refetch()]),
          disabled: loading,
        },
      ]}
      notices={[
        ...((error || queryError)
          ? [{ key: "error", tone: "error", message: label(error || queryError) }]
          : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="mb-4 max-w-xs">
        <TransactionCompanySelector
          runtimeContext={runtimeContext}
          value={companyId}
          onChange={setCompanyId}
          label="Company"
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_360px]">
        <ErpSectionCard eyebrow="Group Register" title="All material category groups">
          <div className="overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Code</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Description</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Members</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>
                )}
                {!loading && groups.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">No category groups found.</td></tr>
                )}
                {groups.map((group) => {
                  const isOpen = expandedId === group.id;
                  const isEditing = editId === group.id;
                  const members = Array.isArray(group.members) ? group.members : [];
                  return (
                    <React.Fragment key={group.id}>
                      <tr
                        className={`border-b border-slate-100 transition-colors ${isEditing ? "bg-amber-50" : isOpen ? "bg-sky-50" : "hover:bg-slate-50 cursor-pointer"}`}
                        onClick={() => { if (!isEditing) toggleExpand(group); }}
                      >
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editDraft.group_name}
                              onChange={(e) => setEditDraft((d) => ({ ...d, group_name: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 w-full border border-amber-400 bg-white px-2 text-sm outline-none"
                            />
                          ) : (
                            <><span className="mr-1 text-slate-400">{isOpen ? "▾" : "▸"}</span>{group.group_name}</>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{group.group_code || "—"}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {isEditing ? (
                            <input
                              value={editDraft.description}
                              onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 w-full border border-amber-400 bg-white px-2 text-sm outline-none"
                            />
                          ) : (
                            group.description || "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                            {group.member_count ?? members.length}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${group.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                            {group.active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          {isEditing ? (
                            <div className="flex gap-1">
                              <button type="button" disabled={saving} onClick={(e) => void saveEdit(group, e)} className="border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50">Save</button>
                              <button type="button" onClick={cancelEdit} className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">Cancel</button>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <button type="button" onClick={(e) => startEdit(group, e)} className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                              <button type="button" disabled={saving} onClick={(e) => void handleDelete(group, e)} className="border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-50">Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="border-b border-sky-100 bg-sky-50/60">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="mb-3">
                              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                                Members ({members.length})
                              </div>
                              {members.length === 0 ? (
                                <div className="text-sm text-slate-400">No members yet.</div>
                              ) : (
                                <div className="grid gap-1">
                                  {members.map((member) => {
                                    const mat = materialMap.get(member.material_id);
                                    return (
                                      <div key={member.id} className="flex items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-1.5 text-sm">
                                        <div className="flex items-center gap-2">
                                          {member.is_primary && (
                                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">PRIMARY</span>
                                          )}
                                          <span className="font-mono text-xs text-slate-500">{mat?.pace_code || "—"}</span>
                                          <span className="text-slate-900">{mat?.material_name || member.material_id}</span>
                                        </div>
                                        <button
                                          type="button"
                                          disabled={saving}
                                          onClick={(e) => { e.stopPropagation(); void handleRemoveMember(member, group.group_name); }}
                                          className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 disabled:opacity-40"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            <div className="border border-dashed border-sky-300 bg-white px-3 py-3">
                              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Add Member</div>
                              <div className="flex flex-wrap items-end gap-2">
                                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                                  Search
                                  <input
                                    value={matSearch}
                                    onChange={(e) => setMatSearch(e.target.value)}
                                    placeholder="code or name"
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-8 w-36 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                                  />
                                </label>
                                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                                  Material <span className="text-rose-500">*</span>
                                  <select
                                    value={memberForm.material_id}
                                    onChange={(e) => setMemberForm((f) => ({ ...f, material_id: e.target.value }))}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-8 w-64 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
                                  >
                                    <option value="">— select —</option>
                                    {matOptions.map((m) => (
                                      <option key={m.id} value={m.id}>{m.pace_code} | {m.material_name}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="flex h-8 items-center gap-1.5 text-xs font-semibold text-slate-700" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={memberForm.is_primary}
                                    onChange={(e) => setMemberForm((f) => ({ ...f, is_primary: e.target.checked }))}
                                  />
                                  Primary
                                </label>
                                <button
                                  type="button"
                                  disabled={saving || !memberForm.material_id}
                                  onClick={(e) => { e.stopPropagation(); void handleAddMember(group); }}
                                  className="h-8 border border-sky-600 bg-sky-50 px-3 text-sm font-semibold text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Create Category Group" title="New group">
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Group Name <span className="text-rose-500">*</span>
              <input
                value={form.group_name}
                onChange={(e) => setForm((f) => ({ ...f, group_name: e.target.value }))}
                placeholder="e.g. Caustic Soda Variants"
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Description
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="border border-slate-300 bg-[#fffef7] px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              />
            </label>
            <p className="text-xs text-slate-400">Group code is auto-generated from the name.</p>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreate()}
              className="mt-1 border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Group"}
            </button>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
