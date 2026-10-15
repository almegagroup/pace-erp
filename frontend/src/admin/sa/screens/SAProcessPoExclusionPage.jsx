/*
 * File-Path: frontend/src/admin/sa/screens/SAProcessPoExclusionPage.jsx
 * Domain: PRODUCTION / SA Operation Masters (OM13)
 * Purpose: SA "Process PO Exclusion" (owner, 2026-10-15). Per company, tick
 *          "Exclude from Process PO" on a whole Mother group, on Child groups,
 *          or on single Prodshades of the MTS Product Group layout. A ticked
 *          Prodshade is only hidden when a Process PO is created for that
 *          company — it still exists everywhere else (plan, stock, reports).
 *          A Prodshade in no group is never excluded: put it in a group first
 *          (MTS Customer Plan → Product Group), then tick it here.
 * Authority: Frontend
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { pushToast } from "../../../store/uiToast.js";
import { listCompaniesForOm } from "../../../pages/dashboard/om/omApi.js";
import { getProcessPoExclusion, saveProcessPoExclusion } from "../../../pages/dashboard/production/prodApi.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const GRID_PROPS = { cellNavigate: true, columnFilter: true, searchBar: true, fitColumnWidths: true };
const ROW_CLASS = { MOTHER: "bg-amber-50 font-semibold", CHILD: "bg-sky-50 font-semibold", PRODSHADE: "" };

function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "Request failed");
}

export default function SAProcessPoExclusionPage() {
  const [companyId, setCompanyId] = useState("");
  const companiesQ = useQuery({ queryKey: ["sa-process-po-exclusion-companies"], queryFn: listCompaniesForOm });
  const exclusionQ = useQuery({
    queryKey: ["sa-process-po-exclusion", companyId],
    queryFn: () => getProcessPoExclusion(companyId),
    enabled: Boolean(companyId),
  });
  const companies = useMemo(() => [...(companiesQ.data ?? [])]
    .sort((a, b) => collator.compare(a.company_code ?? "", b.company_code ?? "")), [companiesQ.data]);

  return (
    <ErpScreenScaffold eyebrow="SA · Operation Masters" title="Process PO Exclusion">
      <div className="grid gap-3">
        <label className="grid max-w-md gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Company</span>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="h-8 border border-slate-300 bg-white px-2 text-sm">
            <option value="">Select company…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{[c.company_code, c.company_name].filter(Boolean).join(" | ")}</option>
            ))}
          </select>
        </label>
        {!companyId ? (
          <p className="text-sm text-slate-500">Select a company.</p>
        ) : exclusionQ.isLoading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : exclusionQ.error ? (
          <p className="text-sm text-rose-700">{errorText(exclusionQ.error)}</p>
        ) : exclusionQ.data ? (
          <ExclusionEditor key={`${companyId}-${exclusionQ.dataUpdatedAt}`} companyId={companyId} data={exclusionQ.data} />
        ) : null}
      </div>
    </ErpScreenScaffold>
  );
}

function ExclusionEditor({ companyId, data }) {
  const queryClient = useQueryClient();
  const [ticked, setTicked] = useState(() => {
    const set = new Set();
    (data.mother_groups ?? []).forEach((m) => { if (m.excluded) set.add(`MOTHER|${m.id}`); });
    (data.child_groups ?? []).forEach((c) => { if (c.excluded) set.add(`CHILD|${c.id}`); });
    (data.prodshades ?? []).forEach((p) => { if (p.excluded) set.add(`PRODSHADE|${p.prodshade_material_id}`); });
    return set;
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const motherById = useMemo(() => new Map((data.mother_groups ?? []).map((m) => [m.id, m])), [data]);
  const childById = useMemo(() => new Map((data.child_groups ?? []).map((c) => [c.id, c])), [data]);

  // Tree rows: Mother → its Child groups → their Prodshades, all ascending.
  const rows = useMemo(() => {
    const out = [];
    const mothers = [...(data.mother_groups ?? [])].sort((a, b) => collator.compare(a.name, b.name));
    for (const mother of mothers) {
      out.push({ kind: "MOTHER", key: `MOTHER|${mother.id}`, id: mother.id, mother_name: mother.name, child_name: "", label: mother.name, document_name: "" });
      const children = (data.child_groups ?? []).filter((c) => c.mother_group_id === mother.id).sort((a, b) => collator.compare(a.name, b.name));
      for (const child of children) {
        out.push({ kind: "CHILD", key: `CHILD|${child.id}`, id: child.id, mother_id: mother.id, mother_name: mother.name, child_name: child.name, label: child.name, document_name: "" });
        const prodshades = (data.prodshades ?? []).filter((p) => p.child_group_id === child.id)
          .sort((a, b) => collator.compare(a.prodshade_label, b.prodshade_label));
        for (const p of prodshades) {
          out.push({
            kind: "PRODSHADE", key: `PRODSHADE|${p.prodshade_material_id}`, id: p.prodshade_material_id,
            mother_id: mother.id, child_id: child.id, mother_name: mother.name, child_name: child.name,
            label: p.prodshade_label, document_name: p.prodshade_document_name ?? "",
          });
        }
      }
    }
    return out;
  }, [data]);

  // Ticked higher up = covered (shown ticked and locked).
  function coveredBy(row) {
    if (row.kind === "CHILD" && ticked.has(`MOTHER|${row.mother_id}`)) return `Mother group ${row.mother_name}`;
    if (row.kind === "PRODSHADE") {
      if (ticked.has(`MOTHER|${row.mother_id}`)) return `Mother group ${row.mother_name}`;
      if (ticked.has(`CHILD|${row.child_id}`)) return `Child group ${row.child_name}`;
    }
    return "";
  }
  const isExcluded = (row) => ticked.has(row.key) || Boolean(coveredBy(row));
  const excludedProdshadeCount = rows.filter((r) => r.kind === "PRODSHADE" && isExcluded(r)).length;

  function toggle(row) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
      return next;
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const pick = (kind) => [...ticked].filter((k) => k.startsWith(`${kind}|`)).map((k) => k.slice(kind.length + 1))
        .filter((id) => (kind === "MOTHER" ? motherById.has(id) : kind === "CHILD" ? childById.has(id) : true));
      await saveProcessPoExclusion({
        company_id: companyId,
        mother_group_ids: pick("MOTHER"),
        child_group_ids: pick("CHILD"),
        prodshade_material_ids: pick("PRODSHADE"),
      });
      pushToast({ message: "Process PO exclusions saved.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["sa-process-po-exclusion", companyId] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: "mother_name", label: "Mother Group", width: "170px" },
    { key: "child_name", label: "Child Group", width: "190px", render: (r) => (r.kind === "MOTHER" ? "" : r.child_name) },
    {
      key: "label", label: "Group / Prodshade", width: "260px",
      render: (r) => <span style={{ paddingLeft: r.kind === "MOTHER" ? 0 : r.kind === "CHILD" ? 16 : 32 }}>{r.label}</span>,
      filterValue: (r) => r.label,
    },
    { key: "document_name", label: "Document Name", width: "280px" },
    { key: "kind", label: "Level", width: "100px", render: (r) => ({ MOTHER: "Mother", CHILD: "Child", PRODSHADE: "Prodshade" }[r.kind]) },
    {
      key: "exclude", label: "Exclude from Process PO", width: "190px", filterable: true,
      render: (r) => {
        const covered = coveredBy(r);
        return (
          <label className="flex items-center gap-2" title={covered ? `Excluded by ${covered}` : undefined}>
            <input type="checkbox" checked={isExcluded(r)} disabled={Boolean(covered)} onChange={() => toggle(r)} />
            {covered ? <span className="text-[11px] text-slate-500">via {covered.split(" ")[0]}</span> : null}
          </label>
        );
      },
      filterValue: (r) => (isExcluded(r) ? "Excluded" : "Allowed"),
      copyValue: (r) => (isExcluded(r) ? "Yes" : "No"),
    },
  ];

  const ungroupedColumns = [
    { key: "prodshade_label", label: "Prodshade", width: "260px" },
    { key: "prodshade_document_name", label: "Document Name", width: "320px", render: (r) => r.prodshade_document_name || "—" },
  ];

  return (
    <>
      <ErpSectionCard eyebrow="OM13" title="Exclude Product Groups / Prodshades from Process PO">
        <p className="mb-2 text-xs text-slate-500">
          Ticked items are not offered when a Process PO is created for this company; they still exist for everything else
          (plan, stock, reports). Tick a Mother group to exclude everything under it — including Child groups and Prodshades added
          later — or tick single Child groups or Prodshades. Groups come from MTS Customer Plan → Product Group.
        </p>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-700">Prodshades excluded: <b>{excludedProdshadeCount}</b></span>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        <ErpDenseGrid
          {...GRID_PROPS}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          getRowProps={(r) => ({ className: ROW_CLASS[r.kind] })}
          emptyMessage="No Product Groups for this company yet (MTS Customer Plan → Product Group)."
          maxHeight="calc(100vh - 420px)"
        />
      </ErpSectionCard>
      <ErpSectionCard eyebrow="Always shown" title="Not in any group — always offered on Process PO">
        <p className="mb-2 text-xs text-slate-500">
          These Prodshades are in no Product Group, so they cannot be excluded. To exclude one, add it to a group first.
        </p>
        <ErpDenseGrid
          {...GRID_PROPS}
          columns={ungroupedColumns}
          rows={data.ungrouped_prodshades ?? []}
          rowKey={(r) => r.prodshade_material_id}
          emptyMessage="Every Prodshade of this company is in a group."
          maxHeight="30vh"
        />
      </ErpSectionCard>
    </>
  );
}
