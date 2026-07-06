/*
 * File-ID: 27.FE-PR07
 * File-Path: frontend/src/pages/dashboard/production/ChangePackBomPage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Procurement proposes changes to an ACTIVE Pack BOM.
 *          Creates a DRAFT change request → PR08 approval queue for L1 Manager.
 */

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { getPackBom, listPackBoms, createPackBomChangeRequest } from "./prodApi.js";

const ERRORS = {
  PROD_BCR_NO_CHANGES:      "At least one change required.",
  PROD_BCR_BOM_NOT_ACTIVE:  "Change requests can only be created for ACTIVE Pack BOMs.",
  PROD_BCR_ALREADY_PENDING: "A pending change request already exists for this BOM.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

const ACTION_LABELS = { ADD: "Add", REMOVE: "Remove", EDIT: "Edit" };
const ACTION_COLORS = {
  ADD:    "bg-emerald-100 text-emerald-800",
  REMOVE: "bg-rose-100 text-rose-800",
  EDIT:   "bg-sky-100 text-sky-800",
};

export default function ChangePackBomPage() {
  const qc = useQueryClient();
  const [skuInput, setSkuInput] = useState("");
  const [bom, setBom] = useState(null);
  const [loading, setLoading] = useState(false);
  const [changes, setChanges] = useState([]);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  async function loadBom() {
    if (!skuInput.trim()) return;
    setLoading(true);
    setBom(null);
    setChanges([]);
    try {
      const results = await listPackBoms({ sku_material_id: skuInput.trim(), status: "ACTIVE" });
      const list = Array.isArray(results) ? results : results?.data ?? [];
      if (list.length === 0) {
        toast("No ACTIVE Pack BOM found for this FG material UUID.", "error");
        return;
      }
      const full = await getPackBom(list[0].id);
      setBom(full);
      setChanges(
        (full.lines ?? [])
          .filter((l) => l.line_type === "INPUT")
          .map((l) => ({
            _key: l.id,
            action: "EDIT",
            bom_line_id: l.id,
            material_id: l.material_id ?? "",
            material_pace: l.material?.pace_code ?? "",
            qty: String(l.qty ?? ""),
            uom_code: l.uom_code ?? "KG",
            has_alternate: Boolean(l.has_alternate),
            marked_remove: false,
          }))
      );
    } catch (err) {
      toast(friendly(err.message), "error");
    } finally {
      setLoading(false);
    }
  }

  function markRemove(key) {
    setChanges((prev) =>
      prev.map((c) =>
        c._key === key
          ? { ...c, marked_remove: !c.marked_remove, action: c.marked_remove ? "EDIT" : "REMOVE" }
          : c
      )
    );
  }

  function updateChange(key, field, value) {
    setChanges((prev) =>
      prev.map((c) =>
        c._key === key ? { ...c, [field]: value, action: c.marked_remove ? "REMOVE" : "EDIT" } : c
      )
    );
  }

  function addLine() {
    setChanges((prev) => [
      ...prev,
      {
        _key: `new-${Math.random().toString(36).slice(2)}`,
        action: "ADD",
        bom_line_id: null,
        material_id: "",
        material_pace: "",
        qty: "",
        uom_code: "KG",
        has_alternate: false,
        marked_remove: false,
      },
    ]);
  }

  const submitMutation = useMutation({
    mutationFn: (payload) => createPackBomChangeRequest(bom.id, payload),
    onSuccess: () => {
      toast("Change request created — awaiting L1 Manager Procurement approval (PR08).");
      setBom(null);
      setChanges([]);
      setSkuInput("");
      qc.invalidateQueries({ queryKey: ["pack-bom-change-requests"] });
    },
    onError: (err) => toast(friendly(err.message), "error"),
  });

  function handleSubmit() {
    if (!bom) return;
    const payload = changes
      .filter((c) => {
        if (c.action === "ADD") return c.material_id.length > 10 && Number(c.qty) > 0;
        if (c.action === "REMOVE") return true;
        if (c.action === "EDIT") return true;
        return false;
      })
      .map((c) => ({
        action: c.action,
        bom_line_id: c.bom_line_id,
        material_id: c.material_id,
        qty: Number(c.qty),
        uom_code: c.uom_code,
        has_alternate: c.has_alternate,
      }));

    if (payload.length === 0) {
      toast("No changes to submit.", "error");
      return;
    }
    submitMutation.mutate({ changes: payload });
  }

  return (
    <ErpScreenScaffold
      title="Change Pack BOM — PR07"
      subtitle="Propose PM line changes to an ACTIVE Pack BOM — creates a change request for L1 Manager approval"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Load Active Pack BOM">
        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">FG Material UUID</label>
            <input
              className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono w-72"
              placeholder="Paste FG SKU material UUID…"
              value={skuInput}
              onChange={(e) => setSkuInput(e.target.value)}
            />
          </div>
          <button
            className="bg-slate-700 hover:bg-slate-900 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50"
            onClick={loadBom}
            disabled={loading || !skuInput.trim()}
          >
            {loading ? "Loading…" : "Load BOM"}
          </button>
        </div>
      </ErpSectionCard>

      {bom && (
        <>
          <ErpSectionCard title="BOM Header">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">SKU Code</span>
                <p className="font-mono font-semibold">{bom.sku?.pace_code ?? "—"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Material Name</span>
                <p>{bom.sku?.material_name ?? "—"}</p>
              </div>
              <div>
                <span className="text-slate-400 text-xs block mb-0.5">Pack Code</span>
                <p className="font-mono">{bom.sku?.pack_code ?? "—"}</p>
              </div>
            </div>
          </ErpSectionCard>

          <ErpSectionCard title="PM Lines — Propose Changes">
            <p className="text-xs text-slate-500 mb-3">
              Toggle "Remove" to mark lines for removal. Edit qty/material inline. Click "+ Add Line" for new PM components.
            </p>
            <table className="w-full text-sm border-collapse mb-3">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                  <th className="text-left py-2 px-3 border-b">Action</th>
                  <th className="text-left py-2 px-3 border-b">Material UUID</th>
                  <th className="text-right py-2 px-3 border-b">Qty</th>
                  <th className="text-left py-2 px-3 border-b">UOM</th>
                  <th className="text-left py-2 px-3 border-b">Has Alt.</th>
                  <th className="py-2 px-3 border-b"></th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c, idx) => (
                  <tr
                    key={c._key}
                    className={`border-b border-slate-100 ${c.marked_remove ? "opacity-50 bg-rose-50" : c.action === "ADD" ? "bg-emerald-50" : ""}`}
                  >
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[c.action] ?? ""}`}>
                        {ACTION_LABELS[c.action]}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <input
                        className="border border-slate-300 rounded px-2 py-1 text-xs font-mono w-52 disabled:bg-slate-50"
                        value={c.material_id}
                        disabled={c.marked_remove}
                        onChange={(e) => updateChange(c._key, "material_id", e.target.value)}
                      />
                      {c.material_pace && !c.marked_remove && (
                        <span className="text-slate-400 ml-1 text-xs">{c.material_pace}</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        className="border border-slate-300 rounded px-2 py-1 text-xs text-right w-20 disabled:bg-slate-50"
                        value={c.qty}
                        disabled={c.marked_remove}
                        onChange={(e) => updateChange(c._key, "qty", e.target.value)}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        className="border border-slate-300 rounded px-2 py-1 text-xs w-14 uppercase disabled:bg-slate-50"
                        value={c.uom_code}
                        disabled={c.marked_remove}
                        onChange={(e) => updateChange(c._key, "uom_code", e.target.value.toUpperCase())}
                      />
                    </td>
                    <td className="py-2 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={c.has_alternate}
                        disabled={c.marked_remove}
                        onChange={(e) => updateChange(c._key, "has_alternate", e.target.checked)}
                        className="accent-sky-600"
                      />
                    </td>
                    <td className="py-2 px-3">
                      {c.action !== "ADD" ? (
                        <button
                          className={`text-xs ${c.marked_remove ? "text-slate-500 hover:text-slate-700" : "text-rose-500 hover:text-rose-700"}`}
                          onClick={() => markRemove(c._key)}
                        >
                          {c.marked_remove ? "Undo" : "Remove"}
                        </button>
                      ) : (
                        <button
                          className="text-xs text-rose-500 hover:text-rose-700"
                          onClick={() => setChanges((prev) => prev.filter((x) => x._key !== c._key))}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-between items-center">
              <button
                className="text-sky-600 hover:text-sky-800 text-sm font-medium"
                onClick={addLine}
              >
                + Add PM Line
              </button>
              <button
                className="bg-sky-600 hover:bg-sky-700 text-white text-sm px-5 py-2 rounded disabled:opacity-50"
                onClick={handleSubmit}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? "Submitting…" : "Submit Change Request"}
              </button>
            </div>
          </ErpSectionCard>
        </>
      )}
    </ErpScreenScaffold>
  );
}
