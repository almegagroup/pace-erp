/*
 * File-ID: 27.FE-01
 * File-Path: frontend/src/pages/dashboard/production/StrokeMasterPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Stroke Master list + create/edit/approve in right drawer.
 *          DRAFT = QA edits, APPROVED = Manager saves. Keyboard-first.
 */

import React, { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import {
  listStrokeMasters, getStrokeMaster, createStrokeMaster,
  updateStrokeMaster, approveStrokeMaster, revertStrokeMaster,
} from "./prodApi.js";

const STATUS_BADGE = {
  DRAFT:    "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
};

const EMPTY_LINE = { material_id: "", dosage_pct: "" };

const ERRORS = {
  PROD_STROKE_DOSAGE_SUM: "Dosage total must equal 100%.",
  PROD_STROKE_NUMBER_NUMERIC: "Stroke number must be numeric.",
  PROD_STROKE_EXISTS: "Stroke number already exists for this prodshade.",
  PROD_STROKE_APPROVED_LOCKED: "Approved stroke cannot be edited.",
  PROD_STROKE_IN_USE: "Cannot revert — active Process Orders reference this stroke.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required for this action.",
};

function friendlyErr(code) { return ERRORS[code] ?? code; }

export default function StrokeMasterPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("create"); // create | detail
  const [detail, setDetail]   = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create form state
  const [form, setForm] = useState({ company_id: "", prodshade_material_id: "", stroke_number: "", description: "" });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);

  const firstInputRef = useRef(null);

  const strokesQ = useQuery({
    queryKey: ["prod-stroke-masters", companyId, statusFilter],
    queryFn: () => listStrokeMasters({ company_id: companyId || undefined, status: statusFilter || undefined }),
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function openCreate() {
    setDrawerMode("create");
    setForm({ company_id: "", prodshade_material_id: "", stroke_number: "", description: "" });
    setLines([{ ...EMPTY_LINE }]);
    setDrawerOpen(true);
  }

  async function openDetail(id) {
    setDrawerMode("detail");
    setDetail(null);
    setDetailLoading(true);
    setDrawerOpen(true);
    try {
      const d = await getStrokeMaster(id);
      setDetail(d);
    } catch { toast("Failed to load stroke detail.", "error"); setDrawerOpen(false); }
    finally { setDetailLoading(false); }
  }

  function addLine() { setLines(l => [...l, { ...EMPTY_LINE }]); }
  function removeLine(i) { setLines(l => l.filter((_, idx) => idx !== i)); }
  function updateLine(i, field, val) {
    setLines(l => l.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  }

  function dosageSum() { return lines.reduce((s, l) => s + (parseFloat(l.dosage_pct) || 0), 0); }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.company_id || !form.prodshade_material_id || !form.stroke_number) {
      toast("Company, Prodshade material ID, and Stroke number are required.", "error"); return;
    }
    const sum = dosageSum();
    if (lines.some(l => l.material_id) && Math.abs(sum - 100) > 0.01) {
      toast(`Dosage must sum to 100. Current: ${sum.toFixed(2)}%`, "error"); return;
    }
    setSaving(true);
    try {
      await createStrokeMaster({
        ...form,
        lines: lines.filter(l => l.material_id).map(l => ({
          material_id: l.material_id,
          dosage_pct: parseFloat(l.dosage_pct),
        })),
      });
      toast("Stroke master created.");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleApprove(id) {
    setSaving(true);
    try {
      await approveStrokeMaster(id);
      toast("Stroke approved.");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  async function handleRevert(id) {
    setSaving(true);
    try {
      await revertStrokeMaster(id);
      toast("Reverted to DRAFT.");
      setDrawerOpen(false);
      qc.invalidateQueries({ queryKey: ["prod-stroke-masters"] });
    } catch (err) { toast(friendlyErr(err.message), "error"); }
    finally { setSaving(false); }
  }

  const strokes = strokesQ.data ?? [];

  const actions = [
    { label: "New Stroke", tone: "primary", mnemonic: "N", onClick: openCreate },
  ];

  return (
    <ErpScreenScaffold
      title="Stroke Master"
      subtitle="Define RM dosage formulas per prodshade"
      actions={actions}
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      {/* Filters */}
      <ErpSectionCard title="Filters">
        <div className="flex gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Company ID</label>
            <input
              className="border border-slate-300 rounded px-2 py-1 text-sm w-64"
              placeholder="Filter by company…"
              value={companyId}
              onChange={e => setCompanyId(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Status</label>
            <select
              className="border border-slate-300 rounded px-2 py-1 text-sm"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Approved</option>
            </select>
          </div>
        </div>
      </ErpSectionCard>

      {/* Table */}
      <ErpSectionCard title={`Strokes (${strokes.length})`}>
        {strokesQ.isLoading ? (
          <p className="text-slate-500 text-sm py-4 text-center">Loading…</p>
        ) : strokes.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No strokes found. Press <kbd className="bg-slate-100 border px-1 rounded text-xs">Alt+N</kbd> to create.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <th className="text-left py-2 px-3 border-b">Stroke #</th>
                <th className="text-left py-2 px-3 border-b">Prodshade ID</th>
                <th className="text-left py-2 px-3 border-b">Description</th>
                <th className="text-left py-2 px-3 border-b">Status</th>
                <th className="text-left py-2 px-3 border-b">Created</th>
              </tr>
            </thead>
            <tbody>
              {strokes.map(s => (
                <tr
                  key={s.id}
                  className="hover:bg-sky-50 cursor-pointer border-b border-slate-100 transition-colors"
                  onClick={() => openDetail(s.id)}
                >
                  <td className="py-2 px-3 font-mono font-semibold">{s.stroke_number}</td>
                  <td className="py-2 px-3 text-slate-600">{s.material?.pace_code ?? s.material_id?.slice(0, 8)}</td>
                  <td className="py-2 px-3 text-slate-500">{s.description ?? "—"}</td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[s.status] ?? ""}`}>{s.status}</span>
                  </td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{s.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      {/* Create Drawer */}
      <DrawerBase
        visible={drawerOpen && drawerMode === "create"}
        title="New Stroke Master"
        onClose={() => setDrawerOpen(false)}
        initialFocusRef={firstInputRef}
        width="min(560px, calc(100vw - 24px))"
        actions={[
          { label: "Save Draft", tone: "primary", onClick: handleCreate, disabled: saving },
          { label: "Cancel", tone: "neutral", onClick: () => setDrawerOpen(false) },
        ]}
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Company ID <span className="text-rose-500">*</span></label>
              <input ref={firstInputRef} className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))} placeholder="UUID" required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Prodshade Material ID <span className="text-rose-500">*</span></label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.prodshade_material_id} onChange={e => setForm(f => ({ ...f, prodshade_material_id: e.target.value }))} placeholder="UUID" required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Stroke Number <span className="text-rose-500">*</span></label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono" value={form.stroke_number} onChange={e => setForm(f => ({ ...f, stroke_number: e.target.value }))} placeholder="Numeric only" required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 font-medium">Description</label>
              <input className="border border-slate-300 rounded px-2 py-1.5 text-sm" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" />
            </div>
          </div>

          {/* RM Lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">RM Lines</p>
              <span className={`text-xs font-mono px-2 py-0.5 rounded ${Math.abs(dosageSum() - 100) < 0.01 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                Σ {dosageSum().toFixed(2)}% / 100%
              </span>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <input
                  className="border border-slate-300 rounded px-2 py-1 text-sm flex-1"
                  placeholder="Material ID"
                  value={line.material_id}
                  onChange={e => updateLine(i, "material_id", e.target.value)}
                />
                <input
                  className="border border-slate-300 rounded px-2 py-1 text-sm w-24 font-mono text-right"
                  placeholder="Dosage %"
                  type="number" step="0.01" min="0" max="100"
                  value={line.dosage_pct}
                  onChange={e => updateLine(i, "dosage_pct", e.target.value)}
                />
                <button type="button" onClick={() => removeLine(i)} className="text-rose-400 hover:text-rose-600 text-sm px-1">✕</button>
              </div>
            ))}
            <button type="button" onClick={addLine} className="text-sky-600 hover:text-sky-800 text-xs underline">+ Add line</button>
          </div>
        </form>
      </DrawerBase>

      {/* Detail Drawer */}
      <DrawerBase
        visible={drawerOpen && drawerMode === "detail"}
        title={detail ? `Stroke #${detail.stroke_number}` : "Loading…"}
        onClose={() => setDrawerOpen(false)}
        width="min(560px, calc(100vw - 24px))"
        actions={detail ? [
          ...(detail.status === "DRAFT" ? [{ label: "Approve", tone: "primary", onClick: () => handleApprove(detail.id), disabled: saving }] : []),
          ...(detail.status === "APPROVED" ? [{ label: "Revert to Draft", tone: "neutral", onClick: () => handleRevert(detail.id), disabled: saving }] : []),
          { label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) },
        ] : [{ label: "Close", tone: "neutral", onClick: () => setDrawerOpen(false) }]}
      >
        {detailLoading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading…</p>
        ) : detail ? (
          <div className="p-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-400 text-xs">Prodshade</span><p className="font-medium">{detail.material?.pace_code ?? detail.material_id?.slice(0, 8)}</p></div>
              <div><span className="text-slate-400 text-xs">Status</span><p><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[detail.status]}`}>{detail.status}</span></p></div>
              <div><span className="text-slate-400 text-xs">Description</span><p>{detail.description ?? "—"}</p></div>
              {detail.approved_by && <div><span className="text-slate-400 text-xs">Approved</span><p>{detail.approved_at?.slice(0, 10)}</p></div>}
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">RM Lines</p>
              {(detail.lines ?? []).length === 0 ? (
                <p className="text-slate-400 text-sm">No lines.</p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs">
                      <th className="text-left py-1.5 px-2 border-b">#</th>
                      <th className="text-left py-1.5 px-2 border-b">Material</th>
                      <th className="text-right py-1.5 px-2 border-b">Dosage %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l, i) => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                        <td className="py-1.5 px-2">{l.material?.pace_code ?? l.material_id?.slice(0, 8)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{Number(l.dosage_pct).toFixed(2)}%</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-semibold">
                      <td colSpan={2} className="py-1.5 px-2 text-right text-slate-500 text-xs">Total</td>
                      <td className="py-1.5 px-2 text-right font-mono">
                        {detail.lines.reduce((s, l) => s + Number(l.dosage_pct), 0).toFixed(2)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
