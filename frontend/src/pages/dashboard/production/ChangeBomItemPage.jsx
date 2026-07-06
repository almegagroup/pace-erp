/*
 * File-ID: 27.FE-PR03
 * File-Path: frontend/src/pages/dashboard/production/ChangeBomItemPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: L1/L2 Manager creates a material-substitution Change Request on an ACTIVE Stroke.
 *          Does NOT modify the live stroke — creates a DRAFT for L3 Manager approval (PR04).
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { listStrokeMasters, createStrokeChangeRequest } from "./prodApi.js";

const ERRORS = {
  PROD_SCR_INVALID:           "stroke_master_id and company_id required.",
  PROD_SCR_NO_LINES:          "At least one line change is required.",
  PROD_SCR_STROKE_NOT_ACTIVE: "Stroke must be APPROVED (active) to create a change request.",
  PROD_SCR_ALREADY_PENDING:   "A pending change request already exists for this stroke.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

export default function ChangeBomItemPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [selectedStrokeId, setSelectedStrokeId] = useState("");
  const [editedLines, setEditedLines] = useState([]);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const strokesQ = useQuery({
    queryKey: ["stroke-cr-strokes", companyId],
    queryFn: () => listStrokeMasters({ company_id: companyId || undefined, status: "APPROVED" }),
    enabled: companyId.length > 10,
    select: (d) => Array.isArray(d) ? d : d?.data ?? [],
  });

  const strokes = strokesQ.data ?? [];
  const selectedStroke = strokes.find((s) => s.id === selectedStrokeId) ?? null;

  function handleStrokeChange(e) {
    const id = e.target.value;
    setSelectedStrokeId(id);
    const stroke = strokes.find((s) => s.id === id);
    if (stroke?.lines) {
      setEditedLines(
        stroke.lines.map((l) => ({
          stroke_line_id: l.id,
          current_material_pace: l.material?.pace_code ?? l.material_id?.slice(0, 8),
          current_material_name: l.material?.material_name ?? "",
          dosage_pct: l.dosage_pct,
          new_material_id: "",
          new_has_alternate: Boolean(l.alternate_material_id),
          changed: false,
        }))
      );
    } else {
      setEditedLines([]);
    }
  }

  function updateLine(idx, field, value) {
    setEditedLines((prev) =>
      prev.map((l, i) =>
        i === idx ? { ...l, [field]: value, changed: true } : l
      )
    );
  }

  const submitMutation = useMutation({
    mutationFn: (payload) => createStrokeChangeRequest(payload),
    onSuccess: () => {
      toast("Change request created — awaiting L3 Manager approval.");
      setSelectedStrokeId("");
      setEditedLines([]);
      qc.invalidateQueries({ queryKey: ["stroke-cr-strokes"] });
    },
    onError: (err) => toast(friendly(err.message), "error"),
  });

  function handleSubmit() {
    if (!selectedStroke || !companyId) {
      toast("Select a company and stroke first.", "error");
      return;
    }
    const changedLines = editedLines.filter((l) => l.changed && l.new_material_id.length > 10);
    if (changedLines.length === 0) {
      toast("Enter at least one new material UUID before submitting.", "error");
      return;
    }
    submitMutation.mutate({
      stroke_master_id: selectedStrokeId,
      company_id: companyId,
      lines: changedLines.map((l) => ({
        stroke_line_id: l.stroke_line_id,
        new_material_id: l.new_material_id.trim(),
        new_has_alternate: l.new_has_alternate,
        new_group_id: null,
      })),
    });
  }

  return (
    <ErpScreenScaffold
      title="Change BOM Item — PR03"
      subtitle="Substitute RM/INT materials on an ACTIVE Stroke — creates a Change Request for L3 Manager approval"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Select Stroke">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Company ID</label>
            <input
              className="border border-slate-300 rounded px-2 py-1.5 text-sm w-72 font-mono"
              placeholder="Paste company UUID…"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            />
          </div>
          {strokes.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Stroke (APPROVED only)</label>
              <select
                className="border border-slate-300 rounded px-2 py-1.5 text-sm w-80"
                value={selectedStrokeId}
                onChange={handleStrokeChange}
              >
                <option value="">— Select stroke —</option>
                {strokes.map((s) => (
                  <option key={s.id} value={s.id}>
                    #{s.stroke_number} — {s.description ?? "No description"} ({s.material?.pace_code ?? "?"})
                  </option>
                ))}
              </select>
            </div>
          )}
          {strokesQ.isLoading && <p className="text-sm text-slate-400">Loading strokes…</p>}
          {companyId.length > 10 && !strokesQ.isLoading && strokes.length === 0 && (
            <p className="text-sm text-slate-400">No APPROVED strokes found for this company.</p>
          )}
        </div>
      </ErpSectionCard>

      {selectedStroke && (
        <ErpSectionCard title={`RM Lines — Stroke #${selectedStroke.stroke_number}`}>
          <p className="text-xs text-slate-500 mb-3">
            Enter the new material UUID for lines you want to change. Leave blank to keep the current material.
            Dosage percentages cannot be changed here.
          </p>
          {editedLines.length === 0 ? (
            <p className="text-slate-400 text-sm py-4 text-center">This stroke has no RM lines.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                  <th className="text-left py-2 px-3 border-b">#</th>
                  <th className="text-left py-2 px-3 border-b">Current Material</th>
                  <th className="text-right py-2 px-3 border-b">Dosage %</th>
                  <th className="text-left py-2 px-3 border-b">New Material UUID</th>
                  <th className="text-left py-2 px-3 border-b">Has Alt.</th>
                </tr>
              </thead>
              <tbody>
                {editedLines.map((l, idx) => (
                  <tr key={l.stroke_line_id} className={`border-b border-slate-100 ${l.changed ? "bg-sky-50" : ""}`}>
                    <td className="py-2 px-3 text-slate-400">{idx + 1}</td>
                    <td className="py-2 px-3">
                      <span className="font-mono font-medium text-xs">{l.current_material_pace}</span>
                      {l.current_material_name && (
                        <span className="text-slate-400 ml-1 text-xs">— {l.current_material_name}</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{Number(l.dosage_pct).toFixed(2)}%</td>
                    <td className="py-2 px-3">
                      <input
                        className="border border-slate-300 rounded px-2 py-1 text-xs font-mono w-64"
                        placeholder="Paste new material UUID…"
                        value={l.new_material_id}
                        onChange={(e) => updateLine(idx, "new_material_id", e.target.value)}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={l.new_has_alternate}
                        onChange={(e) => updateLine(idx, "new_has_alternate", e.target.checked)}
                        className="accent-sky-600"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-4 flex justify-end">
            <button
              className="bg-sky-600 hover:bg-sky-700 text-white text-sm px-5 py-2 rounded disabled:opacity-50"
              onClick={handleSubmit}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? "Submitting…" : "Submit Change Request"}
            </button>
          </div>
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
