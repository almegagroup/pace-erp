import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  createGateEntry,
  listOpenCSNsForGE,
  listOpenPOsForGE,
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
  poQuery: "",
  po: null,
  poLine: null,
  csn: null,
  rcvQty: "",
  lrNumber: "",
  lrDate: "",
});

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
  const [vehicleType, setVehicleType] = useState("TRUCK");
  const [grossWeight, setGrossWeight] = useState("");

  // ── lines state
  const [lines, setLines] = useState(() => Array.from({ length: 6 }, EMPTY_LINE));

  // ── PO / CSN data
  const [allPos, setAllPos] = useState([]);
  const [allCsns, setAllCsns] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);

  // ── PO dropdown per-row
  const [poDropRow, setPoDropRow] = useState(null);
  const [poDropHi, setPoDropHi] = useState(0);

  // ── CSN drawer
  const [drawer, setDrawer] = useState({
    open: false,
    rowIndex: null,
    poNumber: null,
    csns: [],
    hiIdx: 0,
    selected: null,
  });

  // ── save / success modal
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successGE, setSuccessGE] = useState(null);

  const companyOptions = useMemo(
    () =>
      (runtimeContext?.availableCompanies ?? []).map((c) => ({
        value: c.id,
        label: c.company_name || c.company_code || c.id,
      })),
    [runtimeContext?.availableCompanies]
  );

  // auto-select company
  useEffect(() => {
    if (!companyId && companyOptions.length > 0) {
      setCompanyId(runtimeContext?.selectedCompanyId || companyOptions[0].value);
    }
  }, [companyId, companyOptions, runtimeContext?.selectedCompanyId]);

  // load POs + open CSNs when company changes
  useEffect(() => {
    if (!companyId) return;
    let active = true;
    setDataLoading(true);
    Promise.all([
      listOpenPOsForGE({ company_id: companyId }),
      listOpenCSNsForGE({ company_id: companyId }),
    ])
      .then(([poRes, csnRes]) => {
        if (!active) return;
        setAllPos(Array.isArray(poRes?.items) ? poRes.items : []);
        setAllCsns(Array.isArray(csnRes?.items) ? csnRes.items : []);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "DATA_LOAD_FAILED");
      })
      .finally(() => {
        if (active) setDataLoading(false);
      });
    return () => {
      active = false;
    };
  }, [companyId]);

  // ── PO combobox
  function getPoSuggestions(query) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    return allPos
      .filter(
        (p) =>
          (p.po_number || "").toLowerCase().includes(q) ||
          (p.vendor_name || "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }

  function getCsnsForPo(poId) {
    return allCsns.filter((c) => c.po_id === poId);
  }

  function updateLine(i, patch) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l))
    );
  }

  function selectPO(rowIndex, po) {
    const isBulk = ["BULK", "TANKER"].includes((po.delivery_type || "").toUpperCase());
    // PO comes with embedded lines from listOpenPOsForGE
    const firstOpenLine = isBulk
      ? (po.lines ?? []).find((l) =>
          ["OPEN", "PARTIALLY_RECEIVED"].includes((l.line_status || "").toUpperCase())
        ) ?? null
      : null;
    updateLine(rowIndex, { poQuery: po.po_number, po, csn: null, poLine: firstOpenLine });
    setPoDropRow(null);

    if (!isBulk) {
      const csns = getCsnsForPo(po.id);
      if (csns.length > 0) {
        setTimeout(() => openDrawer(rowIndex, po), 60);
      }
    }
  }

  // ── drawer
  function openDrawer(rowIndex, po) {
    const resolvedPo = po ?? lines[rowIndex]?.po;
    if (!resolvedPo) return;
    const csns = getCsnsForPo(resolvedPo.id);
    const currentCsn = lines[rowIndex]?.csn;
    const hiIdx = csns.findIndex((c) => c.id === currentCsn?.id);
    setDrawer({ open: true, rowIndex, poNumber: resolvedPo.po_number ?? null, csns, hiIdx: Math.max(0, hiIdx), selected: currentCsn });
  }

  function closeDrawer() {
    setDrawer({ open: false, rowIndex: null, poNumber: null, csns: [], hiIdx: 0, selected: null });
  }

  function confirmDrawer() {
    const rowIndex = drawer.rowIndex;
    if (drawer.selected && rowIndex !== null) {
      const csn = drawer.selected;
      const isImport = (csn.csn_type || "").toUpperCase() === "IMPORT";
      updateLine(rowIndex, {
        csn,
        lrNumber: isImport ? (csn.boe_number || "") : (csn.invoice_number || ""),
        lrDate: isImport ? (csn.bl_date || "") : (csn.lr_date || ""),
      });
    }
    closeDrawer();
    if (rowIndex !== null) {
      setTimeout(() => rcvQtyRefs.current[rowIndex]?.focus(), 60);
    }
  }

  function setDrawerHi(idx) {
    const csns = drawer.csns;
    if (idx < 0 || idx >= csns.length) return;
    setDrawer((d) => ({ ...d, hiIdx: idx, selected: csns[idx] }));
  }

  // ── save
  async function handleSave() {
    setError("");
    if (!companyId || !entryDate || !vehicleNumber.trim()) {
      setError("Company, entry date, and vehicle number are required.");
      return;
    }
    if (!grossWeight || Number(grossWeight) <= 0) {
      setError("Gross weight (KG) is required.");
      return;
    }
    const activeLines = lines.filter((l) => l.po !== null);
    if (activeLines.length === 0) {
      setError("At least one PO line must be added.");
      return;
    }
    for (let i = 0; i < activeLines.length; i++) {
      const l = activeLines[i];
      const isBulk = ["BULK", "TANKER"].includes((l.po.delivery_type || "").toUpperCase());
      if (!isBulk && !l.csn) {
        setError(`Line ${i + 1} (${l.po.po_number}): CSN must be selected.`);
        return;
      }
      if (isBulk && !l.poLine) {
        setError(`Line ${i + 1} (${l.po.po_number}): No open PO line found for this BULK PO.`);
        return;
      }
      if (!l.rcvQty || Number(l.rcvQty) <= 0) {
        setError(`Line ${i + 1} (${l.po.po_number}): Received quantity is required.`);
        return;
      }
    }

    setSaving(true);
    try {
      const gw = Number(grossWeight);
      const created = await createGateEntry({
        company_id: companyId,
        entry_date: entryDate,
        entry_time: time12to24(entryTime, ampm),
        vehicle_number: vehicleNumber.trim().toUpperCase(),
        vehicle_type: vehicleType,
        gross_weight: gw,
        lines: activeLines.map((l) => {
          const isBulk = ["BULK", "TANKER"].includes((l.po.delivery_type || "").toUpperCase());
          const poLineId = isBulk ? (l.poLine?.id || "") : (l.csn?.po_line_id || "");
          const materialId = isBulk
            ? (l.poLine?.material_id || "")
            : (l.csn?.material_id || "");
          const uomCode = isBulk
            ? (l.poLine?.uom_code || l.poLine?.po_uom_code || "")
            : (l.csn?.po_uom_code || "");
          return {
            csn_id: isBulk ? null : (l.csn?.id || null),
            po_line_id: poLineId,
            material_id: materialId,
            ge_qty: Number(l.rcvQty),
            uom_code: uomCode,
            challan_or_invoice_no: l.lrNumber.trim() || null,
            rst_number: l.lrDate || null,
            gross_weight: gw,
          };
        }),
      });
      setSuccessGE(created.ge_number || String(created.id));
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
    setVehicleType("TRUCK");
    setGrossWeight("");
    setLines(Array.from({ length: 6 }, EMPTY_LINE));
    setError("");
    setSuccessGE(null);
  }

  function openGEList() {
    openScreen(OPERATION_SCREENS.PROC_GATE_ENTRY_LIST.screen_code);
    navigate("/dashboard/procurement/gate-entries/list");
  }

  // ── global keyboard
  useEffect(() => {
    function onKey(e) {
      // drawer open
      if (drawer.open) {
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeDrawer(); return; }
        if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); confirmDrawer(); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); setDrawerHi(drawer.hiIdx + 1); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setDrawerHi(drawer.hiIdx - 1); return; }
        e.stopImmediatePropagation();
        return;
      }
      // success modal
      if (successGE) {
        if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); resetForm(); }
        return;
      }
      if (e.key === "F9") { e.preventDefault(); void handleSave(); return; }
      if (e.key === "F4") {
        const active = document.activeElement;
        if (active && active.type === "date") {
          active.showPicker?.();
        } else {
          const t = currentTime12();
          setEntryTime(t.time);
          setAmpm(t.ampm);
        }
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); setLines((p) => [...p, EMPTY_LINE()]); return; }
      if (e.altKey && e.key.toLowerCase() === "l") { e.preventDefault(); openGEList(); return; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // intentional broad dep — we need latest state in handler
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer, successGE, lines, saving, companyId, entryDate, vehicleNumber, grossWeight, entryTime, ampm, vehicleType]);

  // ─── render helpers ─────────────────────────────────────────────────────

  const drawerCsn = drawer.csns[drawer.hiIdx] ?? null;

  function renderCsnCard(csn, idx) {
    const isImport = (csn.csn_type || "").toUpperCase() === "IMPORT";
    const matDisplay = csn.material_name || csn.material_id || "—";
    const isSelected = drawer.selected?.id === csn.id;
    const isHi = idx === drawer.hiIdx;
    return (
      <div
        key={csn.id}
        className={[
          "cursor-pointer rounded-[var(--radius)] border p-3 transition-colors",
          isSelected ? "border-[var(--border-accent)] bg-[var(--bg-accent)]" : "border-[var(--border)] hover:border-[var(--border-accent)] hover:bg-[var(--bg-accent)]",
          isHi ? "outline outline-2 outline-[var(--border-accent)]" : "",
        ].join(" ")}
        onMouseEnter={() => setDrawer((d) => ({ ...d, hiIdx: idx }))}
        onClick={() =>
          setDrawer((d) => ({
            ...d,
            hiIdx: idx,
            selected: d.csns[idx],
          }))
        }
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[var(--text-primary)]">
            {csn.csn_number || csn.id}
          </span>
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase",
              csn.status === "TRN"
                ? "bg-[var(--bg-success)] text-[var(--text-success)]"
                : "bg-[var(--bg-accent)] text-[var(--text-accent)]",
            ].join(" ")}
          >
            {csn.status}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {[
            ["PO number", csn.po_number || "—"],
            ["Material", matDisplay],
            ["Quantity", csn.dispatch_qty ? `${Number(csn.dispatch_qty).toLocaleString()} ${csn.po_uom_code || ""}` : "—"],
            [isImport ? "BOE number" : "Invoice number", csn.invoice_number || csn.boe_number || "—"],
            [isImport ? "BL date (ATD)" : "LR date (ATD)", csn.bl_date || csn.lr_date || "—"],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-[9px] text-[var(--text-muted)]">{label}</span>
              <span
                className={[
                  "text-[10px] font-medium",
                  value === "—" ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]",
                ].join(" ")}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderLineRow(line, i) {
    const isBulk = ["BULK", "TANKER"].includes((line.po?.delivery_type || "").toUpperCase());
    const isImportLine = (line.csn?.csn_type || "").toUpperCase() === "IMPORT";
    const sugs = line.po === null ? getPoSuggestions(line.poQuery) : [];
    const showDrop = poDropRow === i && sugs.length > 0;
    const matName = isBulk
      ? (line.poLine?.material_name || line.poLine?.material_id || "")
      : (line.csn?.material_name || line.csn?.material_id || "");
    const uom = isBulk
      ? (line.poLine?.uom_code || line.poLine?.po_uom_code || "")
      : (line.csn?.po_uom_code || "");
    const expQty = isBulk ? "" : (line.csn?.dispatch_qty ?? "");

    return (
      <tr key={i} className="group">
        <td className="w-6 text-center text-[10px] text-[var(--text-muted)]">{i + 1}</td>

        {/* PO combobox */}
        <td className="relative w-[150px]">
          <input
            className="h-6 w-full rounded-[3px] border border-transparent bg-transparent px-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)] focus:bg-[var(--surface-2)]"
            value={line.poQuery}
            placeholder="Type PO…"
            onChange={(e) => {
              updateLine(i, { poQuery: e.target.value, po: null, csn: null, poLine: null });
              setPoDropRow(i);
              setPoDropHi(0);
            }}
            onFocus={() => {
              if (!line.po) setPoDropRow(i);
            }}
            onBlur={() => setTimeout(() => setPoDropRow(null), 200)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setPoDropHi((h) => Math.min(h + 1, sugs.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setPoDropHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter" && showDrop) { e.preventDefault(); selectPO(i, sugs[poDropHi]); }
              else if (e.key === "Tab" && showDrop && sugs.length > 0) {
                // Tab with dropdown open: select highlighted suggestion, then drawer opens automatically
                e.preventDefault();
                selectPO(i, sugs[poDropHi]);
              }
              else if (e.key === "Escape") { setPoDropRow(null); }
            }}
          />
          {showDrop && (
            <div className="absolute left-0 top-full z-50 min-w-[260px] rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface-2)] shadow-lg">
              {sugs.map((p, si) => (
                <div
                  key={p.id}
                  className={[
                    "cursor-pointer border-b border-[var(--border)] px-3 py-2 last:border-0",
                    si === poDropHi ? "bg-[var(--bg-accent)]" : "hover:bg-[var(--surface-1)]",
                  ].join(" ")}
                  onMouseDown={() => void selectPO(i, p)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">
                      {p.po_number}
                    </span>
                    {["BULK", "TANKER"].includes((p.delivery_type || "").toUpperCase()) && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
                        {p.delivery_type}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                    {p.vendor_name || ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </td>

        {/* CSN */}
        <td className="w-[160px]">
          {!line.po ? (
            <span className="px-1.5 text-[10px] text-[var(--text-muted)]">—</span>
          ) : isBulk ? (
            <span className="px-1.5 text-[10px] italic text-amber-600">BULK — no CSN</span>
          ) : (
            <div className="flex items-center gap-1">
              <span className={["flex-1 truncate px-1 text-[10px]", line.csn ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"].join(" ")}>
                {line.csn ? line.csn.csn_number : "—"}
              </span>
              <button
                type="button"
                className="h-5 flex-shrink-0 rounded-[3px] border border-[var(--border-accent)] bg-[var(--bg-accent)] px-1.5 text-[9px] font-medium text-[var(--text-accent)]"
                onClick={() => openDrawer(i, null)}
                title="Space to open"
              >
                {line.csn ? "Change" : "Select"}
              </button>
            </div>
          )}
        </td>

        {/* Material (readonly) */}
        <td className="w-[150px]">
          <span className="px-1.5 text-[10px] text-[var(--text-muted)]">
            {matName || ""}
          </span>
        </td>

        {/* UOM */}
        <td className="w-[52px] text-center">
          <span className="text-[10px] text-[var(--text-muted)]">{uom}</span>
        </td>

        {/* Exp qty */}
        <td className="w-[80px] text-right">
          <span className="pr-1.5 text-[10px] text-[var(--text-muted)]">
            {expQty !== "" ? Number(expQty).toLocaleString() : ""}
          </span>
        </td>

        {/* Rcv qty */}
        <td className="w-[80px]">
          <input
            ref={(el) => { rcvQtyRefs.current[i] = el; }}
            type="number"
            min="0"
            step="0.001"
            className="h-6 w-full rounded-[3px] border border-transparent bg-transparent px-1.5 text-right text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)] focus:bg-[var(--surface-2)]"
            value={line.rcvQty}
            placeholder="0"
            onChange={(e) => updateLine(i, { rcvQty: e.target.value })}
          />
        </td>

        {/* Invoice / BOE no */}
        <td className="w-[110px]">
          <input
            className="h-6 w-full rounded-[3px] border border-transparent bg-transparent px-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)] focus:bg-[var(--surface-2)]"
            value={line.lrNumber}
            placeholder={line.csn ? (isImportLine ? "BOE no" : "Invoice no") : "Optional"}
            onChange={(e) => updateLine(i, { lrNumber: e.target.value })}
          />
        </td>

        {/* LR / BL date */}
        <td className="w-[110px]">
          <input
            type="date"
            className="h-6 w-full rounded-[3px] border border-transparent bg-transparent px-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)] focus:bg-[var(--surface-2)]"
            value={line.lrDate}
            onChange={(e) => updateLine(i, { lrDate: e.target.value })}
          />
        </td>

        {/* Delete */}
        <td className="w-6 text-center">
          {lines.length > 1 && (
            <button
              type="button"
              className="h-5 w-5 rounded-[3px] border border-[var(--border-danger)] bg-[var(--bg-danger)] text-[11px] font-bold text-[var(--text-danger)]"
              onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
              title="Alt+D"
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
          {
            key: "list",
            label: "GE Register",
            tone: "neutral",
            onClick: openGEList,
          },
          {
            key: "save",
            label: saving ? "Saving…" : "Save GE (F9)",
            tone: "primary",
            onClick: () => void handleSave(),
            disabled: saving || dataLoading,
          },
        ]}
      >
        {/* keyboard help strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-[10px] text-[var(--text-secondary)]">
          {[
            ["Tab / Shift+Tab", "Next / prev field"],
            ["F4", "Calendar on date · Now on time"],
            ["↑ ↓ + Enter", "Dropdown / drawer navigate"],
            ["Space", "Open CSN drawer (on CSN cell)"],
            ["Alt+N", "Add row"],
            ["F9", "Save"],
            ["Alt+L", "GE Register"],
            ["Esc", "Close drawer"],
          ].map(([key, desc]) => (
            <span key={key} className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-primary)]">
                {key}
              </kbd>
              {desc}
            </span>
          ))}
        </div>

        {/* ── Header card ── */}
        <ErpSectionCard eyebrow="Header" title="Vehicle arrival">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {/* Company */}
            <div className="col-span-2 flex flex-col gap-1 lg:col-span-1">
              <label className="text-[10px] font-medium text-[var(--text-secondary)]">
                Company <span className="text-[var(--text-danger)]">*</span>
              </label>
              <select
                className="erp-input h-7 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                <option value="">Select company</option>
                {companyOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* GE Number */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-[var(--text-secondary)]">
                GE number
              </label>
              <input
                readOnly
                value="Auto-generated"
                className="h-7 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-muted)] outline-none"
              />
            </div>

            {/* Entry Date */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center justify-between text-[10px] font-medium text-[var(--text-secondary)]">
                Entry date <span className="text-[var(--text-danger)]">*</span>
                <span className="rounded border border-[var(--border)] bg-[var(--surface-1)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-muted)]">
                  F4
                </span>
              </label>
              <div className="flex gap-1">
                <input
                  ref={dateRef}
                  type="date"
                  value={entryDate}
                  max={todayIso()}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="h-7 flex-1 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]"
                />
                <button
                  type="button"
                  className="h-7 flex-shrink-0 rounded-[var(--radius)] border border-[var(--border-accent)] bg-[var(--bg-accent)] px-2 text-[10px] font-medium text-[var(--text-accent)]"
                  onClick={() => dateRef.current?.showPicker?.()}
                >
                  F4
                </button>
              </div>
            </div>

            {/* Entry Time */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center justify-between text-[10px] font-medium text-[var(--text-secondary)]">
                Entry time
                <span className="rounded border border-[var(--border)] bg-[var(--surface-1)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-muted)]">
                  F4 = now
                </span>
              </label>
              <div className="flex gap-1">
                <input
                  type="text"
                  maxLength={5}
                  value={entryTime}
                  placeholder="HH:MM"
                  className="h-7 flex-1 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]"
                  onChange={(e) => {
                    let v = e.target.value.replace(/\D/g, "");
                    if (v.length > 2) v = `${v.slice(0, 2)}:${v.slice(2)}`;
                    setEntryTime(v.slice(0, 5));
                  }}
                />
                <div className="flex flex-shrink-0 overflow-hidden rounded-[var(--radius)] border border-[var(--border-strong)]">
                  {["AM", "PM"].map((ap) => (
                    <button
                      key={ap}
                      type="button"
                      className={[
                        "h-7 px-2 text-[10px] font-semibold",
                        ampm === ap
                          ? "bg-[var(--fill-accent)] text-[var(--on-accent)]"
                          : "bg-[var(--surface-2)] text-[var(--text-secondary)]",
                      ].join(" ")}
                      onClick={() => setAmpm(ap)}
                    >
                      {ap}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="h-7 flex-shrink-0 rounded-[var(--radius)] border border-[var(--border-accent)] bg-[var(--bg-accent)] px-2 text-[10px] font-medium text-[var(--text-accent)]"
                  onClick={() => {
                    const t = currentTime12();
                    setEntryTime(t.time);
                    setAmpm(t.ampm);
                  }}
                >
                  F4
                </button>
              </div>
            </div>

            {/* Vehicle Number */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-[var(--text-secondary)]">
                Vehicle number <span className="text-[var(--text-danger)]">*</span>
              </label>
              <input
                type="text"
                value={vehicleNumber}
                placeholder="MH04 AB 1234"
                className="h-7 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 text-[12px] uppercase text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]"
                onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              />
            </div>

            {/* Vehicle Type */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-[var(--text-secondary)]">
                Vehicle type <span className="text-[var(--text-danger)]">*</span>
              </label>
              <div className="flex gap-1">
                {["TRUCK", "TANKER"].map((vt) => (
                  <button
                    key={vt}
                    type="button"
                    className={[
                      "h-7 flex-1 rounded-[var(--radius)] border text-[11px] font-medium",
                      vehicleType === vt
                        ? "border-[var(--border-accent)] bg-[var(--bg-accent)] text-[var(--text-accent)]"
                        : "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-secondary)]",
                    ].join(" ")}
                    onClick={() => setVehicleType(vt)}
                  >
                    {vt.charAt(0) + vt.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Gross Weight */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-[var(--text-secondary)]">
                Gross weight (KG) <span className="text-[var(--text-danger)]">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={grossWeight}
                placeholder="0.00"
                className="h-7 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 text-right text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]"
                onChange={(e) => setGrossWeight(e.target.value)}
              />
              <span className="text-[9px] text-[var(--text-muted)]">
                Weighbridge slip reading
              </span>
            </div>
          </div>
        </ErpSectionCard>

        {/* ── Lines card ── */}
        <ErpSectionCard eyebrow="Lines" title="PO items received on this vehicle">
          {dataLoading ? (
            <div className="py-4 text-[11px] text-[var(--text-muted)]">
              Loading POs and CSNs…
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-[var(--border-strong)] bg-[var(--surface-1)]">
                      {[
                        ["#", "w-6"],
                        ["PO number *", "w-[150px]"],
                        ["CSN", "w-[160px]"],
                        ["Material", "w-[150px]"],
                        ["UOM", "w-[52px] text-center"],
                        ["Exp qty", "w-[80px] text-right"],
                        ["Rcv qty *", "w-[80px] text-right"],
                        ["Invoice / BOE no", "w-[110px]"],
                        ["LR / BL date", "w-[110px]"],
                        ["", "w-6"],
                      ].map(([label, cls]) => (
                        <th
                          key={label}
                          className={`px-1.5 py-1.5 text-left text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)] ${cls}`}
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
                className="mt-2 flex h-7 items-center gap-1.5 rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] bg-transparent px-3 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
                onClick={() => setLines((p) => [...p, EMPTY_LINE()])}
              >
                + Add row
                <kbd className="rounded border border-[var(--border)] bg-[var(--surface-1)] px-1 py-0.5 text-[9px] text-[var(--text-muted)]">
                  Alt+N
                </kbd>
              </button>
            </>
          )}
        </ErpSectionCard>
      </ErpScreenScaffold>

      {/* ── CSN Drawer ── */}
      {drawer.open && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/30"
          onClick={(e) => { if (e.target === e.currentTarget) closeDrawer(); }}
        >
          <div className="flex h-full w-[380px] flex-col border-l border-[var(--border-strong)] bg-[var(--surface-2)]">
            {/* drawer header */}
            <div className="border-b border-[var(--border)] bg-[var(--surface-1)] px-4 py-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-[13px] font-medium text-[var(--text-primary)]">
                    Select CSN
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                    {drawer.poNumber ?? ""}
                    {" · "}
                    {drawer.csns.length} open shipment{drawer.csns.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] bg-transparent text-[15px] text-[var(--text-secondary)]"
                  onClick={closeDrawer}
                >
                  ×
                </button>
              </div>
            </div>

            {/* drawer body */}
            <div className="flex-1 overflow-y-auto p-3">
              {drawer.csns.length === 0 ? (
                <p className="text-[11px] text-[var(--text-muted)]">
                  No open CSNs for this PO.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {drawer.csns.map((csn, idx) => renderCsnCard(csn, idx))}
                </div>
              )}
            </div>

            {/* drawer footer — keyboard hints only */}
            <div className="border-t border-[var(--border)] bg-[var(--surface-1)] px-4 py-2.5">
              <p className="text-[9px] text-[var(--text-muted)]">
                {[["↑↓", "Navigate"], ["Enter", "Select"], ["Esc", "Close"]].map(([k, d]) => (
                  <span key={k} className="mr-3 inline-flex items-center gap-1">
                    <kbd className="rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-primary)]">{k}</kbd>
                    {d}
                  </span>
                ))}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Success Modal ── */}
      {successGE && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[340px] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] shadow-xl">
            <div className="border-b border-[var(--border)] bg-[var(--bg-success)] px-5 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-success)]">
                Gate entry created
              </p>
            </div>
            <div className="px-5 py-5">
              <p className="mb-1 text-[10px] text-[var(--text-muted)]">GE number</p>
              <p className="font-mono text-[26px] font-semibold tracking-wider text-[var(--text-primary)]">
                {successGE}
              </p>
              <p className="mt-3 text-[10px] text-[var(--text-muted)]">
                Note this number for the gate register, then close to create the next entry.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface-1)] px-5 py-3">
              <button
                type="button"
                className="h-8 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 text-[12px] font-medium text-[var(--text-secondary)]"
                onClick={() => {
                  openScreen(OPERATION_SCREENS.PROC_GATE_ENTRY_DETAIL.screen_code);
                  navigate(
                    `/dashboard/procurement/gate-entries/${encodeURIComponent(successGE)}`
                  );
                }}
              >
                Open detail
              </button>
              <button
                type="button"
                className="h-8 rounded-[var(--radius)] border border-[var(--fill-accent)] bg-[var(--fill-accent)] px-4 text-[12px] font-medium text-[var(--on-accent)]"
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
