/*
 * MTS Customer Plan — "Product Group" editor (owner, 2026-10-15).
 *
 * Lists every MTS Prodshade of the company with its Document Name. The user
 * builds Mother groups and Child groups (each Child under exactly one
 * Mother) and puts each Prodshade into at most one Child group; Prodshades
 * can be moved between groups, and new Prodshades show as "Not grouped"
 * until someone adds them. Save replaces the company's layout atomically.
 * Who may save is decided by ACL (PROC_MTS_PLAN_GROUP_MAINTAIN WRITE).
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { pushToast } from "../../../../store/uiToast.js";
import { getMtsPlanProductGroups, saveMtsPlanProductGroups } from "../procurementApi.js";
import { compareByGroup, NOT_GROUPED_LABEL } from "./mtsPlanGrouping.js";

const INPUT_CLASS = "h-7 border border-slate-300 bg-white px-2 text-xs outline-none focus:border-sky-500 disabled:bg-slate-100";
const BUTTON_CLASS = "h-7 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byName = (a, b) => collator.compare(a.name ?? "", b.name ?? "");

function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "Request failed");
}

export default function ProductGroupDrawer({ companyId, onClose }) {
  const groupsQ = useQuery({
    queryKey: ["procurement", "mts-plan", "product-groups", companyId],
    queryFn: () => getMtsPlanProductGroups({ company_id: companyId }),
    enabled: Boolean(companyId),
  });

  return (
    <DrawerBase
      visible
      title="Product Group — Mother / Child groups of Prodshades"
      onClose={onClose}
      side="center"
      width="min(1300px, calc(100vw - 24px))"
    >
      {groupsQ.isLoading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : groupsQ.error ? (
        <p className="text-sm text-rose-700">{errorText(groupsQ.error)}</p>
      ) : groupsQ.data ? (
        <GroupEditor key={groupsQ.dataUpdatedAt} data={groupsQ.data} companyId={companyId} onClose={onClose} />
      ) : null}
    </DrawerBase>
  );
}

function GroupEditor({ data, companyId, onClose }) {
  const queryClient = useQueryClient();
  const canManage = data.can_manage === true;
  const [mothers, setMothers] = useState(() => (data.mother_groups ?? []).map((m) => ({ key: m.id, id: m.id, name: m.name })));
  const [children, setChildren] = useState(() => (data.child_groups ?? []).map((c) => ({ key: c.id, id: c.id, name: c.name, mother_key: c.mother_group_id })));
  const [assign, setAssign] = useState(() => Object.fromEntries((data.prodshades ?? [])
    .filter((p) => p.child_group_id).map((p) => [p.prodshade_material_id, p.child_group_id])));
  const [selected, setSelected] = useState(() => new Set());
  const [newMother, setNewMother] = useState("");
  const [newChild, setNewChild] = useState("");
  const [newChildMother, setNewChildMother] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const motherByKey = useMemo(() => new Map(mothers.map((m) => [m.key, m])), [mothers]);
  const childByKey = useMemo(() => new Map(children.map((c) => [c.key, c])), [children]);
  const sortedMothers = useMemo(() => [...mothers].sort(byName), [mothers]);
  const sortedChildren = useMemo(() => [...children].sort((a, b) => collator.compare(motherByKey.get(a.mother_key)?.name ?? "", motherByKey.get(b.mother_key)?.name ?? "") || byName(a, b)), [children, motherByKey]);
  const memberCount = useMemo(() => {
    const counts = {};
    Object.values(assign).forEach((key) => { counts[key] = (counts[key] ?? 0) + 1; });
    return counts;
  }, [assign]);

  const rows = useMemo(() => (data.prodshades ?? []).map((p) => {
    const child = childByKey.get(assign[p.prodshade_material_id]);
    const mother = child ? motherByKey.get(child.mother_key) : null;
    return {
      ...p,
      child_key: child?.key ?? "",
      child_group_name: child?.name ?? null,
      mother_group_name: mother?.name ?? null,
    };
  }).sort(compareByGroup), [data.prodshades, assign, childByKey, motherByKey]);

  const nextKey = () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const touch = () => setDirty(true);
  const nameTaken = (list, name, exceptKey) => list.some((g) => g.key !== exceptKey && g.name.trim().toLowerCase() === name.trim().toLowerCase());

  function addMother() {
    const name = newMother.trim();
    if (!name) return;
    if (nameTaken(mothers, name)) { pushToast({ message: `Mother group "${name}" already exists.`, tone: "error" }); return; }
    const key = nextKey();
    setMothers((current) => [...current, { key, id: null, name }]);
    setNewMother("");
    if (!newChildMother) setNewChildMother(key);
    touch();
  }
  function addChild() {
    const name = newChild.trim();
    if (!name) return;
    if (!newChildMother) { pushToast({ message: "Choose the Mother group for the new Child group.", tone: "error" }); return; }
    if (nameTaken(children, name)) { pushToast({ message: `Child group "${name}" already exists.`, tone: "error" }); return; }
    setChildren((current) => [...current, { key: nextKey(), id: null, name, mother_key: newChildMother }]);
    setNewChild("");
    touch();
  }
  function renameGroup(setter, key, name) {
    setter((current) => current.map((g) => (g.key === key ? { ...g, name } : g)));
    touch();
  }
  function deleteMother(key) {
    if (children.some((c) => c.mother_key === key)) {
      pushToast({ message: "Move or delete its Child groups first.", tone: "error" });
      return;
    }
    setMothers((current) => current.filter((m) => m.key !== key));
    touch();
  }
  function deleteChild(key) {
    const count = memberCount[key] ?? 0;
    if (count > 0 && !window.confirm(`${count} Prodshade(s) in this group will become "${NOT_GROUPED_LABEL}". Continue?`)) return;
    setChildren((current) => current.filter((c) => c.key !== key));
    setAssign((current) => Object.fromEntries(Object.entries(current).filter(([, childKey]) => childKey !== key)));
    touch();
  }
  function setProdshadeGroup(pids, childKey) {
    setAssign((current) => {
      const next = { ...current };
      pids.forEach((pid) => { if (childKey) next[pid] = childKey; else delete next[pid]; });
      return next;
    });
    touch();
  }
  function toggleSelected(pid) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }

  async function handleSave() {
    if (mothers.some((m) => !m.name.trim()) || children.some((c) => !c.name.trim())) {
      pushToast({ message: "Every group needs a name.", tone: "error" });
      return;
    }
    const dup = (list) => new Set(list.map((g) => g.name.trim().toLowerCase())).size !== list.length;
    if (dup(mothers) || dup(children)) {
      pushToast({ message: "Two groups have the same name.", tone: "error" });
      return;
    }
    setSaving(true);
    try {
      await saveMtsPlanProductGroups({
        company_id: companyId,
        mother_groups: mothers.map((m) => ({ key: m.key, id: m.id, name: m.name.trim() })),
        child_groups: children.map((c) => ({ key: c.key, id: c.id, name: c.name.trim(), mother_key: c.mother_key })),
        members: Object.entries(assign).map(([pid, childKey]) => ({ prodshade_material_id: pid, child_key: childKey })),
      });
      pushToast({ message: "Product Groups saved.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-plan"] });
      onClose();
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const childOptions = sortedChildren.map((c) => (
    <option key={c.key} value={c.key}>{motherByKey.get(c.mother_key)?.name ?? "?"} › {c.name}</option>
  ));

  const columns = [
    {
      key: "pick", label: "Select", width: "60px", filterable: false,
      render: (r) => <input type="checkbox" disabled={!canManage} checked={selected.has(r.prodshade_material_id)} onChange={() => toggleSelected(r.prodshade_material_id)} />,
    },
    { key: "mother_group_name", label: "Mother Group", width: "170px", render: (r) => r.mother_group_name || NOT_GROUPED_LABEL, filterValue: (r) => r.mother_group_name || NOT_GROUPED_LABEL },
    {
      key: "child_group_name", label: "Child Group", width: "260px",
      render: (r) => (
        <select disabled={!canManage} value={r.child_key} onChange={(e) => setProdshadeGroup([r.prodshade_material_id], e.target.value)} className={`${INPUT_CLASS} w-full`}>
          <option value="">{NOT_GROUPED_LABEL}</option>
          {childOptions}
        </select>
      ),
      filterValue: (r) => r.child_group_name || NOT_GROUPED_LABEL,
      copyValue: (r) => r.child_group_name || NOT_GROUPED_LABEL,
    },
    { key: "prodshade_label", label: "Prodshade", width: "240px" },
    { key: "prodshade_document_name", label: "Document Name", width: "300px", render: (r) => r.prodshade_document_name || "—" },
  ];

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-500">
        Make Mother groups, then Child groups under them, then put each Prodshade in one Child group (row dropdown, or tick several rows
        and use “Move selected”). A Prodshade can be in only one group and a Child group in only one Mother group. New Prodshades show
        as “{NOT_GROUPED_LABEL}” — filter the Child Group column to find them. Nothing changes until you press Save.
        {!canManage ? " You can view the groups but not change them." : ""}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="border border-slate-200 p-2">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">Mother Groups</h3>
          <div className="grid max-h-48 gap-1 overflow-y-auto">
            {sortedMothers.length === 0 ? <p className="text-xs text-slate-400">No Mother group yet.</p> : null}
            {sortedMothers.map((m) => (
              <div key={m.key} className="flex items-center gap-2">
                <input disabled={!canManage} value={m.name} onChange={(e) => renameGroup(setMothers, m.key, e.target.value)} className={`${INPUT_CLASS} flex-1`} />
                <span className="w-24 text-xs text-slate-500">{children.filter((c) => c.mother_key === m.key).length} child group(s)</span>
                {canManage ? <button type="button" onClick={() => deleteMother(m.key)} className={BUTTON_CLASS}>Delete</button> : null}
              </div>
            ))}
          </div>
          {canManage ? (
            <div className="mt-2 flex gap-2">
              <input value={newMother} onChange={(e) => setNewMother(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addMother(); }} placeholder="New Mother group name" className={`${INPUT_CLASS} flex-1`} />
              <button type="button" onClick={addMother} className={BUTTON_CLASS}>Add Mother Group</button>
            </div>
          ) : null}
        </section>

        <section className="border border-slate-200 p-2">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">Child Groups</h3>
          <div className="grid max-h-48 gap-1 overflow-y-auto">
            {sortedChildren.length === 0 ? <p className="text-xs text-slate-400">No Child group yet.</p> : null}
            {sortedChildren.map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <input disabled={!canManage} value={c.name} onChange={(e) => renameGroup(setChildren, c.key, e.target.value)} className={`${INPUT_CLASS} flex-1`} />
                <select disabled={!canManage} value={c.mother_key} onChange={(e) => { setChildren((current) => current.map((g) => (g.key === c.key ? { ...g, mother_key: e.target.value } : g))); touch(); }} className={`${INPUT_CLASS} w-40`}>
                  {sortedMothers.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                </select>
                <span className="w-20 text-xs text-slate-500">{memberCount[c.key] ?? 0} Prodshade(s)</span>
                {canManage ? <button type="button" onClick={() => deleteChild(c.key)} className={BUTTON_CLASS}>Delete</button> : null}
              </div>
            ))}
          </div>
          {canManage ? (
            <div className="mt-2 flex gap-2">
              <input value={newChild} onChange={(e) => setNewChild(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addChild(); }} placeholder="New Child group name" className={`${INPUT_CLASS} flex-1`} />
              <select value={newChildMother} onChange={(e) => setNewChildMother(e.target.value)} className={`${INPUT_CLASS} w-40`}>
                <option value="">Mother group…</option>
                {sortedMothers.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
              </select>
              <button type="button" onClick={addChild} className={BUTTON_CLASS}>Add Child Group</button>
            </div>
          ) : null}
        </section>
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-700">Selected: {selected.size}</span>
          <button type="button" className={BUTTON_CLASS} onClick={() => setSelected(new Set(rows.filter((r) => !r.child_key).map((r) => r.prodshade_material_id)))}>Select all not grouped</button>
          <button type="button" className={BUTTON_CLASS} onClick={() => setSelected(new Set())}>Clear selection</button>
          <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className={`${INPUT_CLASS} w-64`}>
            <option value="">Move selected to…</option>
            {childOptions}
          </select>
          <button
            type="button"
            disabled={selected.size === 0 || !moveTarget}
            onClick={() => { setProdshadeGroup([...selected], moveTarget); setSelected(new Set()); }}
            className={BUTTON_CLASS}
          >
            Move selected
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => { setProdshadeGroup([...selected], ""); setSelected(new Set()); }}
            className={BUTTON_CLASS}
          >
            Remove selected from group
          </button>
        </div>
      ) : null}

      <ErpDenseGrid
        cellNavigate
        columnFilter
        searchBar
        fitColumnWidths
        columns={columns}
        rows={rows}
        rowKey={(r) => r.prodshade_material_id}
        emptyMessage="No MTS Prodshades for this company."
        maxHeight="45vh"
      />

      {canManage ? (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 border border-slate-300 bg-white px-3 text-sm text-slate-700">Cancel</button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
