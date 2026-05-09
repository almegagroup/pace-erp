/*
 * File-ID: 15B.2
 * File-Path: frontend/src/admin/sa/screens/SAOmMaterialCategoryGroups.jsx
 * Gate: 15B
 * Phase: 15B
 * Domain: MASTER
 * Purpose: SA screen - Material Category Group list, create, and member management.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  addMaterialCategoryMember,
  createMaterialCategoryGroup,
  listMaterialCategoryGroups,
  listMaterials,
} from "../../../pages/dashboard/om/omApi.js";

function normalizeGroups(result) {
  return Array.isArray(result?.data) ? result.data : [];
}

function normalizeMaterials(result) {
  return Array.isArray(result?.data) ? result.data : [];
}

function normalizeMembers(group, localMembersByGroup) {
  const remoteMembers = Array.isArray(group?.members)
    ? group.members
    : Array.isArray(group?.group_members)
      ? group.group_members
      : Array.isArray(group?.materials)
        ? group.materials
        : [];
  const localMembers = Array.isArray(localMembersByGroup[group.id]) ? localMembersByGroup[group.id] : [];
  const seen = new Set();

  return [...remoteMembers, ...localMembers].filter((member) => {
    const key = `${member.material_id || member.id || ""}:${member.is_primary ? "P" : "N"}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getMemberCount(group, localMembersByGroup) {
  if (Number.isFinite(group?.member_count)) {
    return Number(group.member_count);
  }
  if (Number.isFinite(group?.memberCount)) {
    return Number(group.memberCount);
  }
  return normalizeMembers(group, localMembersByGroup).length;
}

export default function SAOmMaterialCategoryGroups() {
  const [groups, setGroups] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [expandedGroupId, setExpandedGroupId] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [createForm, setCreateForm] = useState({
    group_name: "",
    description: "",
  });
  const [memberForms, setMemberForms] = useState({});
  const [localMembersByGroup, setLocalMembersByGroup] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingGroup, setSavingGroup] = useState(false);
  const [savingMemberGroupId, setSavingMemberGroupId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadScreen() {
    setLoading(true);
    setError("");
    try {
      const [groupResult, materialResult] = await Promise.all([
        listMaterialCategoryGroups(),
        listMaterials({ limit: 200, offset: 0 }),
      ]);
      setGroups(normalizeGroups(groupResult));
      setMaterials(normalizeMaterials(materialResult));
    } catch (loadError) {
      setGroups([]);
      setMaterials([]);
      setError(loadError instanceof Error ? loadError.message : "OM_MCG_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadScreen();
  }, []);

  const materialOptions = useMemo(() => {
    const query = materialSearch.trim().toLowerCase();
    const filtered = query
      ? materials.filter((material) => {
        const haystack = `${material.pace_code || ""} ${material.material_name || ""}`.toLowerCase();
        return haystack.includes(query);
      })
      : materials;
    return filtered.slice(0, 50);
  }, [materialSearch, materials]);

  const materialById = useMemo(() => {
    return new Map(materials.map((material) => [material.id, material]));
  }, [materials]);

  function toggleGroup(groupId) {
    setExpandedGroupId((current) => (current === groupId ? "" : groupId));
    setMaterialSearch("");
    setMemberForms((current) => ({
      ...current,
      [groupId]: current[groupId] || { material_id: "", is_primary: false },
    }));
  }

  async function handleCreateGroup() {
    if (!createForm.group_name.trim()) {
      setError("OM_MCG_CREATE_FAILED");
      return;
    }
    setSavingGroup(true);
    setError("");
    setNotice("");
    try {
      await createMaterialCategoryGroup({
        group_name: createForm.group_name.trim(),
        description: createForm.description.trim() || null,
      });
      setCreateForm({ group_name: "", description: "" });
      setNotice("Material category group created.");
      await loadScreen();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_MCG_CREATE_FAILED");
    } finally {
      setSavingGroup(false);
    }
  }

  async function handleAddMember(group) {
    const currentForm = memberForms[group.id] || { material_id: "", is_primary: false };
    if (!currentForm.material_id) {
      setError("OM_MCG_MEMBER_ADD_FAILED");
      return;
    }

    setSavingMemberGroupId(group.id);
    setError("");
    setNotice("");
    try {
      await addMaterialCategoryMember({
        group_id: group.id,
        material_id: currentForm.material_id,
        is_primary: currentForm.is_primary === true,
      });

      const selectedMaterial = materialById.get(currentForm.material_id);
      if (selectedMaterial) {
        setLocalMembersByGroup((current) => {
          const nextMembers = normalizeMembers(group, current)
            .filter((member) => member.material_id !== currentForm.material_id)
            .map((member) => ({
              ...member,
              is_primary: currentForm.is_primary ? false : member.is_primary,
            }));
          nextMembers.push({
            material_id: selectedMaterial.id,
            material_code: selectedMaterial.pace_code,
            material_name: selectedMaterial.material_name,
            is_primary: currentForm.is_primary === true,
          });
          return {
            ...current,
            [group.id]: nextMembers,
          };
        });
      }

      setMemberForms((current) => ({
        ...current,
        [group.id]: { material_id: "", is_primary: false },
      }));
      setMaterialSearch("");
      setNotice("Material added to group.");
      await loadScreen();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_MCG_MEMBER_ADD_FAILED");
    } finally {
      setSavingMemberGroupId("");
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Operation Management"
      title="Material Category Groups"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadScreen() },
        { key: "create", label: savingGroup ? "Creating..." : "Create Group", tone: "primary", onClick: () => void handleCreateGroup(), disabled: savingGroup },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Create Group" title="New material category group">
          <div className="grid gap-3 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
            <ErpDenseFormRow label="Group Name" required>
              <input
                value={createForm.group_name}
                onChange={(event) => setCreateForm((current) => ({ ...current, group_name: event.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Description">
              <textarea
                value={createForm.description}
                onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
                className="min-h-[72px] w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
          </div>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Group Register" title="All material category groups">
          <div className="grid gap-3">
            <div className="grid grid-cols-[minmax(180px,1.2fr)_minmax(180px,1.6fr)_120px_120px_110px] gap-3 border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <div>Group</div>
              <div>Description</div>
              <div>Status</div>
              <div>Members</div>
              <div>Expand</div>
            </div>

            {loading ? (
              <div className="px-3 py-6 text-sm text-slate-500">Loading material category groups...</div>
            ) : groups.length === 0 ? (
              <div className="px-3 py-6 text-sm text-slate-500">No material category groups are available.</div>
            ) : (
              <div className="grid gap-3">
                {groups.map((group) => {
                  const members = normalizeMembers(group, localMembersByGroup);
                  const currentForm = memberForms[group.id] || { material_id: "", is_primary: false };
                  const isExpanded = expandedGroupId === group.id;

                  return (
                    <div key={group.id} className="overflow-hidden border border-slate-200 bg-white">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        className="grid w-full grid-cols-[minmax(180px,1.2fr)_minmax(180px,1.6fr)_120px_120px_110px] gap-3 px-3 py-3 text-left text-sm text-slate-900 transition hover:bg-slate-50"
                      >
                        <div className="font-semibold">{group.group_name}</div>
                        <div className="text-slate-600">{group.description || "—"}</div>
                        <div>
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${group.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                            {group.active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </div>
                        <div className="font-medium text-slate-700">{getMemberCount(group, localMembersByGroup)}</div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                          {isExpanded ? "Collapse" : "Expand"}
                        </div>
                      </button>

                      {isExpanded ? (
                        <div className="grid gap-4 border-t border-slate-200 bg-slate-50 px-3 py-4">
                          <div className="grid gap-2">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Members</div>
                            {members.length === 0 ? (
                              <div className="text-sm text-slate-500">No members available for this group yet.</div>
                            ) : (
                              <div className="grid gap-2">
                                {members.map((member) => {
                                  const material = materialById.get(member.material_id) || member;
                                  return (
                                    <div
                                      key={`${group.id}:${member.material_id || material.id}`}
                                      className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                                    >
                                      <div>
                                        <span className="font-semibold">{material.pace_code || material.material_code || "UNKNOWN"}</span>
                                        <span className="mx-2 text-slate-400">|</span>
                                        <span>{material.material_name || "Unnamed material"}</span>
                                      </div>
                                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${member.is_primary ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                                        {member.is_primary ? "PRIMARY" : "MEMBER"}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div className="grid gap-3 border border-dashed border-slate-300 bg-white px-3 py-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Add Member</div>
                            <div className="grid gap-3 xl:grid-cols-[minmax(180px,0.8fr)_minmax(200px,1.2fr)_160px]">
                              <ErpDenseFormRow label="Search Material">
                                <input
                                  value={materialSearch}
                                  onChange={(event) => setMaterialSearch(event.target.value)}
                                  placeholder="Search by code or name"
                                  className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                />
                              </ErpDenseFormRow>
                              <ErpDenseFormRow label="Material" required>
                                <select
                                  value={currentForm.material_id}
                                  onChange={(event) => setMemberForms((current) => ({
                                    ...current,
                                    [group.id]: { ...currentForm, material_id: event.target.value },
                                  }))}
                                  className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                                >
                                  <option value="">Select material</option>
                                  {materialOptions.map((material) => (
                                    <option key={material.id} value={material.id}>
                                      {material.pace_code} | {material.material_name}
                                    </option>
                                  ))}
                                </select>
                              </ErpDenseFormRow>
                              <ErpDenseFormRow label="Primary">
                                <label className="flex h-8 items-center gap-2 text-sm text-slate-900">
                                  <input
                                    type="checkbox"
                                    checked={currentForm.is_primary === true}
                                    onChange={(event) => setMemberForms((current) => ({
                                      ...current,
                                      [group.id]: { ...currentForm, is_primary: event.target.checked },
                                    }))}
                                  />
                                  Mark as primary
                                </label>
                              </ErpDenseFormRow>
                            </div>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => void handleAddMember(group)}
                                disabled={savingMemberGroupId === group.id}
                                className="inline-flex h-9 items-center justify-center border border-sky-700 bg-sky-700 px-4 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
                              >
                                {savingMemberGroupId === group.id ? "Adding..." : "Add Member"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
