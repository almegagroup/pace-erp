import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  createGateEntry,
  listOpenCSNsForGE,
  listOpenPOsForGE,
  listOpenSTOsForGE,
} from "../procurementApi.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentTime12() {
  const d = new Date();
  let h = d.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return {
    time: `${String(h).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    ampm: ap,
  };
}

function time12to24(time, ampm) {
  if (!time) return null;
  const [hh, mm] = time.split(":").map(Number);
  let h24 = hh;
  if (ampm === "PM" && hh !== 12) h24 = hh + 12;
  if (ampm === "AM" && hh === 12) h24 = 0;
  return `${String(h24).padStart(2, "0")}:${String(mm || 0).padStart(2, "0")}:00`;
}

const EMPTY_LINE = () => ({
  refQuery: "",
  po: null,
  poLine: null,
  sto: null,
  stoLine: null,
  csn: null,
  rcvQty: "",
  lrNumber: "",
  lrDate: "",
});

function buildFallbackRefSuggestions(allCsns, openPoIds, openStoIds) {
  const suggestions = new Map();

  for (const csn of allCsns) {
    if (csn.sto_id) {
      const key = `STO:${csn.sto_id}`;
      if (openStoIds.has(csn.sto_id) || suggestions.has(key)) continue;
      suggestions.set(key, {
        id: csn.sto_id,
        sto_number: csn.sto_number || csn.display_reference_number || csn.csn_number,
        vendor_name: csn.vendor_name || null,
        delivery_type: csn.delivery_type || null,
        __kind: "STO",
        __number: csn.sto_number || csn.display_reference_number || csn.csn_number,
      });
      continue;
    }

    if (!csn.po_id) continue;
    const key = `PO:${csn.po_id}`;
    if (openPoIds.has(csn.po_id) || suggestions.has(key)) continue;
    suggestions.set(key, {
      id: csn.po_id,
      po_number: csn.po_number || csn.display_reference_number || csn.csn_number,
      vendor_name: csn.vendor_name || null,
      delivery_type: csn.delivery_type || null,
      __kind: "PO",
      __number: csn.po_number || csn.display_reference_number || csn.csn_number,
    });
  }

  return [...suggestions.values()];
}

// ─── component ──────────────────────────────────────────────────────────────

export default function GateEntryCreatePage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const dateRef = useRef(null);
  const rcvQtyRefs = useRef({});

  // ── header state
  const [companyId, setCompanyId] = useState("");
  const { time: initTime, ampm: initAmpm } = currentTime12();
  const [entryDate, setEntryDate] = useState(todayIso());
  const [entryTime, setEntryTime] = useState(initTime);
  const [ampm, setAmpm] = useState(initAmpm);
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [grossWeight, setGrossWeight] = useState("");

  // ── lines state
  const [lines, setLines] = useState(() => Array.from({ length: 6 }, EMPTY_LINE));

  // ── PO / STO / CSN data
  const [allPos, setAllPos] = useState([]);
  const [allStos, setAllStos] = useState([]);
  const [allCsns, setAllCsns] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);

  // ── PO/STO dropdown per-row
  const [poDropRow, setPoDropRow] = useState(null);
  const [poDropHi, setPoDropHi] = useState(0);

  // ── CSN drawer
  const [drawer, setDrawer] = useState({
    open: false,
    rowIndex: null,
    refLabel: null,
    refKind: null,
    refItem: null,
    csns: [],
    hiIdx: 0,
    selected: null,
  });

  // ── save / success modal
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successGE, setSuccessGE] = useState(null);
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  useEffect(() => {
    if (!effectiveCompanyId) return;
    let active = true;
    setDataLoading(true);
    Promise.all([
      listOpenPOsForGE({ company_id: effectiveCompanyId }),
      listOpenSTOsForGE({ company_id: effectiveCompanyId }),
      listOpenCSNsForGE({ company_id: effectiveCompanyId }),
    ])
      .then(([poRes, stoRes, csnRes]) => {
        if (!active) return;
        setAllPos(Array.isArray(poRes?.items) ? poRes.items : []);
        setAllStos(Array.isArray(stoRes?.items) ? stoRes.items : []);
        setAllCsns(Array.isArray(csnRes?.items) ? csnRes.items : []);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "DATA_LOAD_FAILED");
      })
      .finally(() => {
        if (active) setDataLoading(false);
      });
    return () => { active = false; };
  }, [effectiveCompanyId]);

  // §111 (2026-07-25) — one search box, either PO or STO number. STO has no
  // po_number of its own (it's a different document, per-company-transfer,
  // not per-vendor-purchase), so a plain PO-only search could never find an
  // STO-originated shipment at the gate. Suggestions are merged and tagged
  // with __kind so the rest of the flow knows which lookup table to use.
  function getRefSuggestions(query) {
    const poItems = allPos.map((p) => ({ ...p, __kind: "PO", __number: p.po_number }));
    const stoItems = allStos.map((s) => ({ ...s, __kind: "STO", __number: s.sto_number }));
    const fallbackItems = buildFallbackRefSuggestions(
      allCsns,
      new Set(allPos.map((p) => p.id)),
      new Set(allStos.map((s) => s.id)),
    );
    const all = [...poItems, ...stoItems, ...fallbackItems];
    if (!query) return all.slice(0, 8);
    const q = query.toLowerCase();
    return all
      .filter(
        (item) =>
          (item.__number || "").toLowerCase().includes(q) ||
          (item.vendor_name || "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }

  function getCsnsForRef(kind, refId) {
    return kind === "STO"
      ? allCsns.filter((c) => c.sto_id === refId)
      : allCsns.filter((c) => c.po_id === refId);
  }

  function updateLine(i, patch) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function selectRef(rowIndex, item) {
    if (item.__kind === "STO") {
      updateLine(rowIndex, { refQuery: item.sto_number, po: null, poLine: null, sto: item, stoLine: null, csn: null });
      setPoDropRow(null);
      const csns = getCsnsForRef("STO", item.id);
      if (csns.length > 0) {
        setTimeout(() => openDrawer(rowIndex, null, item), 60);
      }
      return;
    }
    const po = item;
    const isBulk = ["BULK"].includes((po.delivery_type || "").toUpperCase());
    const firstOpenLine = isBulk
      ? (po.lines ?? []).find((l) =>
          ["OPEN", "PARTIALLY_RECEIVED"].includes((l.line_status || "").toUpperCase())
        ) ?? null
      : null;
    updateLine(rowIndex, { refQuery: po.po_number, po, poLine: firstOpenLine, sto: null, stoLine: null, csn: null });
    setPoDropRow(null);
    if (!isBulk) {
      const csns = getCsnsForRef("PO", po.id);
      if (csns.length > 0) {
        setTimeout(() => openDrawer(rowIndex, po, null), 60);
      }
    }
  }

  function openDrawer(rowIndex, po, sto) {
    const resolvedPo = po ?? lines[rowIndex]?.po;
    const resolvedSto = sto ?? lines[rowIndex]?.sto;
    const kind = resolvedSto ? "STO" : "PO";
    const refItem = resolvedSto ?? resolvedPo;
    if (!refItem) return;
    const csns = getCsnsForRef(kind, refItem.id);
    const currentCsn = lines[rowIndex]?.csn;
    const hiIdx = csns.findIndex((c) => c.id === currentCsn?.id);
    setDrawer({
      open: true,
      rowIndex,
      refLabel: kind === "STO"
        ? (refItem.sto_number ?? refItem.display_reference_number ?? null)
        : (refItem.po_number ?? refItem.display_reference_number ?? null),
      refKind: kind,
      refItem,
      csns,
      hiIdx: Math.max(0, hiIdx),
      selected: currentCsn,
    });
  }

  function closeDrawer() {
    setDrawer({ open: false, rowIndex: null, refLabel: null, refKind: null, refItem: null, csns: [], hiIdx: 0, selected: null });
  }

  function confirmDrawer() {
    const rowIndex = drawer.rowIndex;
    if (drawer.selected && rowIndex !== null) {
      const csn = drawer.selected;
      const isImport = (csn.csn_type || "").toUpperCase() === "IMPORT";
      const patch = {
        csn,
        lrNumber: isImport ? (csn.boe_number || "") : (csn.invoice_number || ""),
        lrDate: isImport ? (csn.bl_date || "") : (csn.lr_date || ""),
      };
      if (drawer.refKind === "STO") {
        // The CSN itself has no line-level STO reference (consignment_note
        // only carries the STO header id) — the actual sto_line_id GE needs
        // to post against lives on stock_transfer_order_line, resolved here
        // by matching material_id within the STO we already fetched.
        const stoLines = drawer.refItem?.lines ?? [];
        patch.stoLine = stoLines.find((l) => l.material_id === csn.material_id) ?? null;
      }
      updateLine(rowIndex, patch);
    }
    closeDrawer();
    if (rowIndex !== null) {
      setTimeout(() => rcvQtyRefs.current[rowIndex]?.focus(), 60);
    }
  }

  function setDrawerHi(idx) {
    if (idx < 0 || idx >= drawer.csns.length) return;
    setDrawer((d) => ({ ...d, hiIdx: idx, selected: d.csns[idx] }));
  }

  async function handleSave() {
    setError("");
    if (!effectiveCompanyId || !entryDate || !vehicleNumber.trim()) {
      setError("Company, entry date, and vehicle number are required.");
      return;
    }
    if (!grossWeight || Number(grossWeight) <= 0) {
      setError("Gross weight (KG) is required.");
      return;
    }
    const activeLines = lines.filter((l) => l.po !== null || l.sto !== null);
    if (activeLines.length === 0) {
      setError("At least one PO or STO line must be added.");
      return;
    }
    for (let i = 0; i < activeLines.length; i++) {
      const l = activeLines[i];
      const refNumber = l.po ? l.po.po_number : l.sto.sto_number;
      const isBulk = l.po ? ["BULK"].includes((l.po.delivery_type || "").toUpperCase()) : false;
      if (!isBulk && !l.csn) {
        setError(`Line ${i + 1} (${refNumber}): CSN must be selected.`);
        return;
      }
      if (isBulk && !l.poLine) {
        setError(`Line ${i + 1} (${refNumber}): No open PO line found for this BULK PO.`);
        return;
      }
      if (l.sto && !l.stoLine) {
        setError(`Line ${i + 1} (${refNumber}): Could not resolve the STO line for the selected CSN.`);
        return;
      }
      if (!l.rcvQty || Number(l.rcvQty) <= 0) {
        setError(`Line ${i + 1} (${refNumber}): Received quantity is required.`);
        return;
      }
    }

    setSaving(true);
    try {
      const gw = Number(grossWeight);
      // Gross weight is captured once per vehicle (weighbridge reading), not per line.
      // Split it across lines proportionally by received qty (SAP-style) instead of
      // repeating the vehicle total on every line — the last line absorbs any
      // rounding remainder so the per-line values always sum back to gw exactly.
      const qtyTotal = activeLines.reduce((sum, l) => sum + (Number(l.rcvQty) || 0), 0);
      let allocatedGrossWeight = 0;
      const created = await createGateEntry({
        company_id: effectiveCompanyId,
        entry_date: entryDate,
        entry_time: time12to24(entryTime, ampm),
        vehicle_number: vehicleNumber.trim().toUpperCase(),
        gross_weight: gw,
        lines: activeLines.map((l, index) => {
          const isBulk = l.po ? ["BULK"].includes((l.po.delivery_type || "").toUpperCase()) : false;
          const rcvQty = Number(l.rcvQty) || 0;
          let lineGrossWeight;
          if (index === activeLines.length - 1) {
            lineGrossWeight = Number((gw - allocatedGrossWeight).toFixed(4));
          } else if (qtyTotal > 0) {
            lineGrossWeight = Number(((gw * rcvQty) / qtyTotal).toFixed(4));
          } else {
            lineGrossWeight = Number((gw / activeLines.length).toFixed(4));
          }
          allocatedGrossWeight += lineGrossWeight;
          return {
            csn_id: isBulk ? null : (l.csn?.id || null),
            po_line_id: isBulk ? (l.poLine?.id || "") : (l.po ? (l.csn?.po_line_id || "") : ""),
            sto_id: l.sto?.id || null,
            sto_line_id: l.sto ? (l.stoLine?.id || "") : null,
            material_id: isBulk ? (l.poLine?.material_id || "") : (l.csn?.material_id || ""),
            ge_qty: rcvQty,
            uom_code: isBulk ? (l.poLine?.uom_code || l.poLine?.po_uom_code || "") : (l.csn?.po_uom_code || ""),
            challan_or_invoice_no: l.lrNumber.trim() || null,
            rst_number: l.lrDate || null,
            gross_weight: lineGrossWeight,
          };
        }),
      });
      setSuccessGE({ number: created.ge_number || "—", id: String(created.id) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "GE_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    const t = currentTime12();
    setEntryDate(todayIso());
    setEntryTime(t.time);
    setAmpm(t.ampm);
    setVehicleNumber("");
    setGrossWeight("");
    setLines(Array.from({ length: 6 }, EMPTY_LINE));
    setError("");
    setSuccessGE(null);
  }

  function openGEList() {
    openScreen(OPERATION_SCREENS.PROC_GATE_ENTRY_LIST.screen_code);
    navigate("/dashboard/procurement/gate-entries/list");
  }

  useEffect(() => {
    function onKey(e) {
      if (drawer.open) {
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeDrawer(); return; }
        if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); confirmDrawer(); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); setDrawerHi(drawer.hiIdx + 1); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setDrawerHi(drawer.hiIdx - 1); return; }
        e.stopImmediatePropagation();
        return;
      }
      if (successGE) {
        if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); resetForm(); }
        return;
      }
      if (e.key === "F9") { e.preventDefault(); void handleSave(); return; }
      if (e.key === "F4") {
        const active = document.activeElement;
        if (active && active.type === "date") { active.showPicker?.(); }
        else { const t = currentTime12(); setEntryTime(t.time); setAmpm(t.ampm); }
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); setLines((p) => [...p, EMPTY_LINE()]); return; }
      if (e.altKey && e.key.toLowerCase() === "l") { e.preventDefault(); openGEList(); return; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer, successGE, lines, saving, effectiveCompanyId, entryDate, vehicleNumber, grossWeight, entryTime, ampm]);

  // ─── render helpers ──────────────────────────────────────────────────────

  function renderCsnCard(csn, idx) {
    const isImport = (csn.csn_type || "").toUpperCase() === "IMPORT";
    const matDisplay = csn.material_name || csn.material_id || "—";
    const refLabel = csn.po_id ? "PO number" : "STO number";
    const refNumber = csn.po_id
      ? (csn.po_number || csn.display_reference_number || "—")
      : (csn.sto_number || csn.display_reference_number || "—");
    const isSelected = drawer.selected?.id === csn.id;
    const isHi = idx === drawer.hiIdx;

    return (
      <div
        key={csn.id}
        className={[
          "cursor-pointer border p-3 transition-colors",
          isSelected
            ? "border-sky-500 bg-sky-50"
            : isHi
            ? "border-sky-300 bg-slate-50"
            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
        ].join(" ")}
        onMouseEnter={() => setDrawer((d) => ({ ...d, hiIdx: idx }))}
        onClick={() => setDrawer((d) => ({ ...d, hiIdx: idx, selected: d.csns[idx] }))}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-900">
            {csn.csn_number || csn.id}
          </span>
          <span
            className={[
              "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
              csn.status === "TRN"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-sky-100 text-sky-800",
            ].join(" ")}
          >
            {csn.status}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {[
            [refLabel, refNumber],
            ["Material", matDisplay],
            ["Quantity", csn.dispatch_qty ? `${Number(csn.dispatch_qty).toLocaleString()} ${csn.po_uom_code || ""}` : "—"],
            [isImport ? "BOE number" : "Invoice number", csn.invoice_number || csn.boe_number || "—"],
            [isImport ? "BL date (ATD)" : "LR date (ATD)", csn.bl_date || csn.lr_date || "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
              <div className={["text-[11px] font-medium", value === "—" ? "text-slate-400" : "text-slate-900"].join(" ")}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderLineRow(line, i) {
    const hasRef = line.po !== null || line.sto !== null;
    const isBulk = ["BULK"].includes((line.po?.delivery_type || "").toUpperCase());
    const isImportLine = (line.csn?.csn_type || "").toUpperCase() === "IMPORT";
    const sugs = hasRef ? [] : getRefSuggestions(line.refQuery);
    const showDrop = poDropRow === i && sugs.length > 0 && (allPos.length > 0 || allStos.length > 0);
    const matName = isBulk
      ? (line.poLine?.material_name || line.poLine?.material_id || "")
      : (line.csn?.material_name || line.csn?.material_id || "");
    const uom = isBulk
      ? (line.poLine?.uom_code || line.poLine?.po_uom_code || "")
      : (line.csn?.po_uom_code || "");
    const expQty = isBulk ? "" : (line.csn?.dispatch_qty ?? "");

    return (
      <tr key={i} className="border-b border-slate-100 last:border-0">
        <td className="w-6 py-1 text-center text-[10px] text-slate-400">{i + 1}</td>

        {/* PO/STO combobox */}
        <td className="relative w-[160px] py-1 pr-1">
          <input
            className="h-7 w-full border border-slate-200 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500 focus:bg-white"
            value={line.refQuery}
            placeholder="Type PO or STO…"
            onChange={(e) => {
              updateLine(i, { refQuery: e.target.value, po: null, poLine: null, sto: null, stoLine: null, csn: null });
              setPoDropRow(i);
              setPoDropHi(0);
            }}
            onFocus={() => {
              if (!hasRef) { setPoDropRow(i); setPoDropHi(0); }
            }}
            onBlur={() => setTimeout(() => setPoDropRow(null), 200)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!showDrop) { setPoDropRow(i); setPoDropHi(0); }
                else setPoDropHi((h) => Math.min(h + 1, sugs.length - 1));
              }
              else if (e.key === "ArrowUp") { e.preventDefault(); setPoDropHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter" && showDrop) { e.preventDefault(); selectRef(i, sugs[poDropHi]); }
              else if (e.key === "Tab" && showDrop && sugs.length > 0) { e.preventDefault(); selectRef(i, sugs[poDropHi]); }
              else if (e.key === "Escape") { setPoDropRow(null); }
            }}
          />
          {showDrop && (
            <div className="absolute left-0 top-full z-50 min-w-[280px] border border-slate-300 bg-white shadow-lg">
              {sugs.map((item, si) => (
                <div
                  key={`${item.__kind}-${item.id}`}
                  className={[
                    "cursor-pointer border-b border-slate-100 px-3 py-2 last:border-0",
                    si === poDropHi ? "bg-sky-50" : "hover:bg-slate-50",
                  ].join(" ")}
                  onMouseDown={() => selectRef(i, item)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-900">{item.__number}</span>
                    <span
                      className={[
                        "rounded px-1.5 py-0.5 text-[9px] font-semibold",
                        item.__kind === "STO" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700",
                      ].join(" ")}
                    >
                      {item.__kind}
                    </span>
                    {["BULK", "TANKER"].includes((item.delivery_type || "").toUpperCase()) && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
                        {item.delivery_type}
                      </span>
                    )}
                  </div>
                  {item.vendor_name && (
                    <div className="mt-0.5 text-[10px] text-slate-500">{item.vendor_name}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </td>

        {/* CSN */}
        <td className="w-[150px] py-1 pr-1">
          {!hasRef ? (
            <span className="text-[11px] text-slate-400">—</span>
          ) : isBulk ? (
            <span className="text-[11px] italic text-amber-600">BULK — no CSN</span>
          ) : (
            <div className="flex items-center gap-1">
              <span className={["flex-1 truncate text-[11px]", line.csn ? "text-slate-900" : "text-slate-400"].join(" ")}>
                {line.csn ? line.csn.csn_number : "—"}
              </span>
              <button
                type="button"
                className="h-6 flex-shrink-0 border border-sky-600 bg-sky-50 px-2 text-[9px] font-semibold text-sky-800"
                onClick={() => openDrawer(i, null)}
              >
                {line.csn ? "Change" : "Select"}
              </button>
            </div>
          )}
        </td>

        {/* Material (readonly) */}
        <td className="w-[160px] py-1 pr-1">
          <span className="text-[11px] text-slate-700">{matName || ""}</span>
        </td>

        {/* UOM */}
        <td className="w-[52px] py-1 text-center">
          <span className="text-[11px] text-slate-500">{uom}</span>
        </td>

        {/* Exp qty */}
        <td className="w-[80px] py-1 pr-1 text-right">
          <span className="text-[11px] text-slate-500">
            {expQty !== "" ? Number(expQty).toLocaleString() : ""}
          </span>
        </td>

        {/* Rcv qty */}
        <td className="w-[90px] py-1 pr-1">
          <input
            ref={(el) => { rcvQtyRefs.current[i] = el; }}
            type="number"
            min="0"
            step="0.001"
            className="h-7 w-full border border-slate-200 bg-white px-2 text-right text-[11px] text-slate-900 outline-none focus:border-sky-500"
            value={line.rcvQty}
            placeholder="0"
            onChange={(e) => updateLine(i, { rcvQty: e.target.value })}
          />
        </td>

        {/* Invoice / BOE no */}
        <td className="w-[120px] py-1 pr-1">
          <input
            className="h-7 w-full border border-slate-200 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
            value={line.lrNumber}
            placeholder={line.csn ? (isImportLine ? "BOE no" : "Invoice no") : "Optional"}
            onChange={(e) => updateLine(i, { lrNumber: e.target.value })}
          />
        </td>

        {/* LR / BL date */}
        <td className="w-[120px] py-1 pr-1">
          <input
            type="date"
            className="h-7 w-full border border-slate-200 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
            value={line.lrDate}
            onChange={(e) => updateLine(i, { lrDate: e.target.value })}
          />
        </td>

        {/* Delete */}
        <td className="w-6 py-1 text-center">
          {lines.length > 1 && (
            <button
              type="button"
              className="h-5 w-5 border border-red-300 bg-red-50 text-[11px] font-bold text-red-600"
              onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
            >
              ×
            </button>
          )}
        </td>
      </tr>
    );
  }

  // ─── JSX ────────────────────────────────────────────────────────────────

  return (
    <>
      <ErpScreenScaffold
        eyebrow="Procurement"
        title="Gate Entry"
        notices={error ? [{ key: "ge-error", tone: "error", message: error }] : []}
        actions={[
          { key: "list", label: "GE Register", tone: "neutral", onClick: openGEList },
          {
            key: "save",
            label: saving ? "Saving…" : "Save GE (F9)",
            tone: "primary",
            onClick: () => void handleSave(),
            disabled: saving || dataLoading,
          },
        ]}
      >
        {/* keyboard help */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">
          {[
            ["Tab / Shift+Tab", "Next / prev field"],
            ["F4", "Calendar on date · Now on time"],
            ["↑ ↓ + Enter", "Dropdown / drawer navigate"],
            ["Space", "Open CSN drawer (on CSN cell)"],
            ["Alt+N", "Add row"],
            ["F9", "Save"],
            ["Alt+L", "GE Register"],
          ].map(([key, desc]) => (
            <span key={key} className="flex items-center gap-1">
              <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[9px] text-slate-700">{key}</kbd>
              {desc}
            </span>
          ))}
        </div>

        {/* ── Header ── */}
        <ErpSectionCard eyebrow="Header" title="Vehicle arrival">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {/* Company */}
            <div className="col-span-2 lg:col-span-1">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={setCompanyId}
                label="Company"
              />
            </div>

            {/* GE Number */}
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              GE number
              <input
                readOnly
                value="Auto-generated"
                className="h-9 border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 outline-none"
              />
            </label>

            {/* Entry Date */}
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              <span className="flex items-center justify-between">
                Entry date <span className="font-normal text-red-500">*</span>
                <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[9px] font-normal text-slate-500">F4</kbd>
              </span>
              <div className="flex gap-1">
                <input
                  ref={dateRef}
                  type="date"
                  value={entryDate}
                  max={todayIso()}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="h-9 flex-1 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  className="h-9 border border-sky-600 bg-sky-50 px-3 text-xs font-semibold text-sky-800"
                  onClick={() => dateRef.current?.showPicker?.()}
                >
                  F4
                </button>
              </div>
            </label>

            {/* Entry Time */}
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              <span className="flex items-center justify-between">
                Entry time
                <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[9px] font-normal text-slate-500">F4 = now</kbd>
              </span>
              <div className="flex gap-1">
                <input
                  type="text"
                  maxLength={5}
                  value={entryTime}
                  placeholder="HH:MM"
                  className="h-9 flex-1 border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-sky-500"
                  onChange={(e) => {
                    let v = e.target.value.replace(/\D/g, "");
                    if (v.length > 2) v = `${v.slice(0, 2)}:${v.slice(2)}`;
                    setEntryTime(v.slice(0, 5));
                  }}
                />
                <div className="flex overflow-hidden border border-slate-300">
                  {["AM", "PM"].map((ap) => (
                    <button
                      key={ap}
                      type="button"
                      className={[
                        "h-9 px-2 text-xs font-semibold",
                        ampm === ap
                          ? "bg-slate-700 text-white"
                          : "bg-white text-slate-600",
                      ].join(" ")}
                      onClick={() => setAmpm(ap)}
                    >
                      {ap}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="h-9 border border-sky-600 bg-sky-50 px-3 text-xs font-semibold text-sky-800"
                  onClick={() => { const t = currentTime12(); setEntryTime(t.time); setAmpm(t.ampm); }}
                >
                  F4
                </button>
              </div>
            </label>

            {/* Vehicle Number */}
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Vehicle number <span className="font-normal text-red-500">*</span>
              <input
                type="text"
                value={vehicleNumber}
                placeholder="MH04 AB 1234"
                className="h-9 border border-slate-300 bg-white px-3 text-sm uppercase text-slate-900 outline-none focus:border-sky-500"
                onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              />
            </label>

            {/* Gross Weight */}
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Gross weight (KG) <span className="font-normal text-red-500">*</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={grossWeight}
                placeholder="0.00"
                className="h-9 border border-slate-300 bg-white px-3 text-right text-sm text-slate-900 outline-none focus:border-sky-500"
                onChange={(e) => setGrossWeight(e.target.value)}
              />
              <span className="text-[10px] font-normal text-slate-400">Weighbridge slip reading</span>
            </label>
          </div>
        </ErpSectionCard>

        {/* ── Lines ── */}
        <ErpSectionCard eyebrow="Lines" title="PO items received on this vehicle">
          {dataLoading ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Loading POs and CSNs…
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-300 bg-slate-50">
                      {[
                        ["#", "w-6"],
                        ["PO / STO *", "w-[160px]"],
                        ["CSN", "w-[150px]"],
                        ["Material", "w-[160px]"],
                        ["UOM", "w-[52px] text-center"],
                        ["Exp qty", "w-[80px] text-right"],
                        ["Rcv qty *", "w-[90px] text-right"],
                        ["Invoice / BOE no", "w-[120px]"],
                        ["LR / BL date", "w-[120px]"],
                        ["", "w-6"],
                      ].map(([label, cls]) => (
                        <th
                          key={label}
                          className={`px-1.5 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${cls}`}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, i) => renderLineRow(line, i))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="mt-2 flex h-8 items-center gap-1.5 border border-dashed border-slate-300 bg-transparent px-3 text-xs font-medium text-slate-500 hover:bg-slate-50"
                onClick={() => setLines((p) => [...p, EMPTY_LINE()])}
              >
                + Add row
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[9px] text-slate-400">Alt+N</kbd>
              </button>
            </>
          )}
        </ErpSectionCard>
      </ErpScreenScaffold>

      {/* ── CSN Drawer ── */}
      <DrawerBase
        visible={drawer.open}
        title={drawer.refLabel ? `Select CSN — ${drawer.refLabel}` : "Select CSN"}
        onEscape={closeDrawer}
        onClose={closeDrawer}
        width="min(420px, calc(100vw - 24px))"
      >
        {drawer.csns.length === 0 ? (
          <p className="text-sm text-slate-500">No open CSNs for this {drawer.refKind === "STO" ? "STO" : "PO"}.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="mb-1 text-xs text-slate-400">
              {drawer.csns.length} open shipment{drawer.csns.length !== 1 ? "s" : ""} · ↑↓ navigate · Enter select · Esc close
            </p>
            {drawer.csns.map((csn, idx) => renderCsnCard(csn, idx))}
          </div>
        )}
      </DrawerBase>

      {/* ── Success Modal ── */}
      {successGE && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[340px] overflow-hidden border border-slate-300 bg-white shadow-xl">
            <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-emerald-700">
                Gate entry created
              </p>
            </div>
            <div className="px-5 py-5">
              <p className="mb-1 text-xs text-slate-500">GE number</p>
              <p className="font-mono text-[28px] font-semibold tracking-wider text-slate-900">
                {successGE.number}
              </p>
              <p className="mt-3 text-xs text-slate-500">
                Note this number for the gate register, then close to create the next entry.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                className="h-9 border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700"
                onClick={() => {
                  openScreen(OPERATION_SCREENS.PROC_GATE_ENTRY_DETAIL.screen_code);
                  navigate(`/dashboard/procurement/gate-entries/${successGE.id}`);
                }}
              >
                Open detail
              </button>
              <button
                type="button"
                className="h-9 border border-sky-700 bg-sky-600 px-4 text-sm font-semibold text-white"
                onClick={resetForm}
                autoFocus
              >
                Close (Enter / Esc)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
