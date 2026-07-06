/*
 * File-ID: 27.FE-PR05
 * File-Path: frontend/src/pages/dashboard/production/PackBomCreatePage.jsx
 * Gate: 27 | Domain: PRODUCTION
 * Purpose: Procurement creates Pack BOM for an FG SKU.
 *          599/000/001 pack codes → auto-ACTIVE. Others → DRAFT → PR06 approval queue.
 */

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { createPackBom } from "./prodApi.js";

const ERRORS = {
  PROD_BOM_INVALID:        "sku_material_id required.",
  PROD_BOM_NOT_FG:         "Pack BOM can only be created for FG materials.",
  PROD_BOM_ALREADY_EXISTS: "A DRAFT or ACTIVE Pack BOM already exists for this SKU.",
  PROD_MANAGER_OR_SA_REQUIRED: "Manager or SA access required.",
};
function friendly(code) { return ERRORS[code] ?? code; }

const EMPTY_LINE = () => ({
  _key: Math.random().toString(36).slice(2),
  material_id: "",
  qty: "",
  uom_code: "KG",
  has_alternate: false,
});

export default function PackBomCreatePage() {
  const qc = useQueryClient();
  const [skuMaterialId, setSkuMaterialId] = useState("");
  const [pmLines, setPmLines] = useState([EMPTY_LINE()]);
  const [notice, setNotice] = useState({ msg: "", tone: "success" });

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  function addLine() {
    setPmLines((prev) => [...prev, EMPTY_LINE()]);
  }

  function removeLine(key) {
    setPmLines((prev) => prev.filter((l) => l._key !== key));
  }

  function updateLine(key, field, value) {
    setPmLines((prev) =>
      prev.map((l) => l._key === key ? { ...l, [field]: value } : l)
    );
  }

  const submitMutation = useMutation({
    mutationFn: (payload) => createPackBom(payload),
    onSuccess: (result) => {
      if (result?.auto_approved) {
        toast("Pack BOM created and automatically activated (BOM not required for this pack code).");
      } else {
        toast("Pack BOM submitted — awaiting L1 Manager Procurement approval (PR06).");
      }
      setSkuMaterialId("");
      setPmLines([EMPTY_LINE()]);
      qc.invalidateQueries({ queryKey: ["pack-boms"] });
    },
    onError: (err) => toast(friendly(err.message), "error"),
  });

  function handleSubmit() {
    if (!skuMaterialId.trim()) {
      toast("Enter the FG SKU material UUID.", "error");
      return;
    }
    const validPm = pmLines.filter((l) => l.material_id.length > 10 && Number(l.qty) > 0);
    if (validPm.length === 0) {
      toast("Add at least one PM line with material UUID and quantity.", "error");
      return;
    }

    const lines = [
      { line_type: "OUTPUT", material_id: skuMaterialId.trim(), qty: 1, uom_code: "KG", has_alternate: false },
      ...validPm.map((l) => ({
        line_type: "INPUT",
        material_id: l.material_id.trim(),
        qty: Number(l.qty),
        uom_code: l.uom_code || "KG",
        has_alternate: l.has_alternate,
      })),
    ];

    submitMutation.mutate({ sku_material_id: skuMaterialId.trim(), lines });
  }

  return (
    <ErpScreenScaffold
      title="Pack BOM Create — PR05"
      subtitle="Define packing material components for an FG SKU. 599/000/001 packs activate immediately; others go to PR06 approval."
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="FG SKU">
        <div className="flex flex-col gap-1 max-w-md">
          <label className="text-xs text-slate-500">FG Material UUID</label>
          <input
            className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
            placeholder="Paste FG material UUID…"
            value={skuMaterialId}
            onChange={(e) => setSkuMaterialId(e.target.value)}
          />
          <p className="text-xs text-slate-400">
            Must be an FG material. One OUTPUT line (qty=1 KG) is auto-added from this SKU.
          </p>
        </div>
      </ErpSectionCard>

      <ErpSectionCard title="PM Input Lines">
        <p className="text-xs text-slate-500 mb-3">
          Add packing material (PM) lines. Qty = quantity per pack unit.
        </p>
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <th className="text-left py-2 px-3 border-b">#</th>
              <th className="text-left py-2 px-3 border-b">PM Material UUID</th>
              <th className="text-left py-2 px-3 border-b">Qty</th>
              <th className="text-left py-2 px-3 border-b">UOM</th>
              <th className="text-left py-2 px-3 border-b">Has Alt.</th>
              <th className="py-2 px-3 border-b"></th>
            </tr>
          </thead>
          <tbody>
            {pmLines.map((l, idx) => (
              <tr key={l._key} className="border-b border-slate-100">
                <td className="py-2 px-3 text-slate-400">{idx + 1}</td>
                <td className="py-2 px-3">
                  <input
                    className="border border-slate-300 rounded px-2 py-1 text-xs font-mono w-60"
                    placeholder="Paste PM material UUID…"
                    value={l.material_id}
                    onChange={(e) => updateLine(l._key, "material_id", e.target.value)}
                  />
                </td>
                <td className="py-2 px-3">
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    className="border border-slate-300 rounded px-2 py-1 text-sm w-24 text-right"
                    value={l.qty}
                    onChange={(e) => updateLine(l._key, "qty", e.target.value)}
                  />
                </td>
                <td className="py-2 px-3">
                  <input
                    className="border border-slate-300 rounded px-2 py-1 text-sm w-16 uppercase"
                    maxLength={10}
                    value={l.uom_code}
                    onChange={(e) => updateLine(l._key, "uom_code", e.target.value.toUpperCase())}
                  />
                </td>
                <td className="py-2 px-3 text-center">
                  <input
                    type="checkbox"
                    checked={l.has_alternate}
                    onChange={(e) => updateLine(l._key, "has_alternate", e.target.checked)}
                    className="accent-sky-600"
                  />
                </td>
                <td className="py-2 px-3">
                  <button
                    className="text-rose-500 hover:text-rose-700 text-xs"
                    onClick={() => removeLine(l._key)}
                  >
                    Remove
                  </button>
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
            {submitMutation.isPending ? "Submitting…" : "Submit Pack BOM"}
          </button>
        </div>
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
