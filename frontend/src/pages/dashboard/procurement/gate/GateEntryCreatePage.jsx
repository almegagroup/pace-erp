import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import {
  createGateEntry,
  getGePersonNameContext,
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

const EMPTY_BULK_DRAWER = () => ({
  open: false,
  rowIndex: null,
  isSto: false,
  item: null,
  line: null,
  challanNumber: "",
  challanDate: "",
  invoiceNumber: "",
  invoiceDate: "",
  containerNumber: "",
  ewaybillNumber: "",
  lrNumber: "",
  geQty: "",
  rstNumber: "",
});

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
  bulkChallanNumber: "",
  bulkChallanDate: "",
  bulkInvoiceNumber: "",
  bulkInvoiceDate: "",
  bulkContainerNumber: "",
  bulkEwaybillNumber: "",
  bulkLrNumber: "",
  bulkRstNumber: "",
});

function isBulkLine(l) {
  const deliveryType = (l.po?.delivery_type ?? l.sto?.delivery_type ?? "").toUpperCase();
  return deliveryType === "BULK";
}

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

  // §3.7 "Bulk GE-Creation Drawer" — Person Name (general GE field, not
  // Bulk-only). Non-Security dept: auto-filled read-only with the logged-in
  // user's own name. Security dept: blank, mandatory manual entry.
  const [personName, setPersonName] = useState("");
  const [isSecurityUser, setIsSecurityUser] = useState(false);
  const [personNameLoading, setPersonNameLoading] = useState(true);

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

  // ── STO GE drawer (§3.7 STO GE-Creation Drawer design, 2026-09-28) — one
  // STO can carry many line items, unlike one PO line, so selecting an STO
  // opens this big center drawer instead of the small CSN-picker drawer.
  const [stoDrawer, setStoDrawer] = useState({ open: false, rowIndex: null, sto: null, rows: [] });

  // ── Bulk GE-Creation Drawer (§3.7 "Bulk GE-Creation Drawer" design,
  // 2026-09-30) — Bulk PO/STO sensing opens this single-item-shaped center
  // drawer instead of the CSN picker or the multi-row STO drawer (Bulk has
  // exactly one material, no CSN at all).
  const [bulkDrawer, setBulkDrawer] = useState(EMPTY_BULK_DRAWER);

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

  useEffect(() => {
    let active = true;
    setPersonNameLoading(true);
    getGePersonNameContext()
      .then((res) => {
        if (!active) return;
        setIsSecurityUser(Boolean(res?.is_security));
        setPersonName(res?.is_security ? "" : (res?.person_name || ""));
      })
      .catch(() => {
        if (!active) return;
        setIsSecurityUser(false);
        setPersonName("");
      })
      .finally(() => {
        if (active) setPersonNameLoading(false);
      });
    return () => { active = false; };
  }, []);

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
    const isBulk = ["BULK"].includes((item.delivery_type || "").toUpperCase());
    if (isBulk) {
      const isSto = item.__kind === "STO";
      updateLine(rowIndex, {
        refQuery: isSto ? item.sto_number : item.po_number,
        po: isSto ? null : item,
        poLine: null,
        sto: isSto ? item : null,
        stoLine: null,
        csn: null,
      });
      setPoDropRow(null);
      setTimeout(() => openBulkDrawer(rowIndex, item, isSto), 60);
      return;
    }
    if (item.__kind === "STO") {
      updateLine(rowIndex, { refQuery: item.sto_number, po: null, poLine: null, sto: item, stoLine: null, csn: null });
      setPoDropRow(null);
      setTimeout(() => openStoDrawer(rowIndex, item), 60);
      return;
    }
    const po = item;
    updateLine(rowIndex, { refQuery: po.po_number, po, poLine: null, sto: null, stoLine: null, csn: null });
    setPoDropRow(null);
    const csns = getCsnsForRef("PO", po.id);
    if (csns.length > 0) {
      setTimeout(() => openDrawer(rowIndex, po, null), 60);
    }
  }

  // §4.1 "GE duplicate CSN/line selection across rows" -- the ids already
  // picked by every OTHER active row in this GE, so a drawer can exclude
  // them from its own candidate list instead of letting the same CSN/STO
  // line get selected twice across rows.
  function getUsedCsnIds(excludeRowIndex) {
    return new Set(
      lines
        .filter((l, idx) => idx !== excludeRowIndex && l.csn?.id)
        .map((l) => l.csn.id)
    );
  }
  function getUsedStoLineIds(excludeRowIndex) {
    return new Set(
      lines
        .filter((l, idx) => idx !== excludeRowIndex && l.stoLine?.id)
        .map((l) => l.stoLine.id)
    );
  }

  function openDrawer(rowIndex, po, sto) {
    const resolvedPo = po ?? lines[rowIndex]?.po;
    const resolvedSto = sto ?? lines[rowIndex]?.sto;
    const kind = resolvedSto ? "STO" : "PO";
    const refItem = resolvedSto ?? resolvedPo;
    if (!refItem) return;
    const usedCsnIds = getUsedCsnIds(rowIndex);
    const csns = getCsnsForRef(kind, refItem.id).filter((c) => !usedCsnIds.has(c.id));
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

  // ── STO GE drawer (§3.7 STO GE-Creation Drawer design) ──────────────────
  function openStoDrawer(rowIndex, sto) {
    const stoLines = sto.lines ?? [];
    // §4.1 "GE duplicate CSN/line selection across rows" -- exclude STO lines
    // already picked by another active row in this same GE.
    const usedStoLineIds = getUsedStoLineIds(rowIndex);
    const rows = stoLines
      .filter((stoLine) => !usedStoLineIds.has(stoLine.id))
      .map((stoLine) => ({
        selected: true,
        stoLine,
        geQty: stoLine.expected_qty != null ? String(stoLine.expected_qty) : "",
        invoiceNo: stoLine.invoice_number || "",
        lrDate: stoLine.lr_date || "",
      }));
    setStoDrawer({ open: true, rowIndex, sto, rows });
  }

  function closeStoDrawer() {
    setStoDrawer({ open: false, rowIndex: null, sto: null, rows: [] });
  }

  function updateStoDrawerRow(idx, patch) {
    setStoDrawer((d) => ({ ...d, rows: d.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));
  }

  function confirmStoDrawer() {
    const { rowIndex, sto, rows } = stoDrawer;
    const selectedRows = rows.filter((r) => r.selected && r.stoLine);
    const newLines = selectedRows.map((r) => ({
      refQuery: sto.sto_number,
      po: null,
      poLine: null,
      sto,
      stoLine: r.stoLine,
      csn: {
        id: r.stoLine.csn_id,
        csn_number: r.stoLine.csn_number,
        csn_type: "DOMESTIC",
        material_id: r.stoLine.material_id,
        material_name: r.stoLine.material_name,
        po_uom_code: r.stoLine.uom_code,
        dispatch_qty: r.stoLine.expected_qty,
        invoice_number: r.stoLine.invoice_number,
        boe_number: r.stoLine.boe_number,
        lr_date: r.stoLine.lr_date,
      },
      rcvQty: r.geQty,
      lrNumber: r.invoiceNo,
      lrDate: r.lrDate,
    }));

    setLines((prev) => {
      const withoutTrigger = rowIndex !== null ? prev.filter((_, i) => i !== rowIndex) : prev;
      return [...withoutTrigger, ...newLines];
    });
    closeStoDrawer();
  }

  // ── Bulk GE-Creation Drawer (§3.7 "Bulk GE-Creation Drawer" design) ──────
  // `existingLine` is passed when re-opening the drawer to edit an
  // already-captured Bulk row (the "Edit Bulk details" button) — its
  // bulk_* fields prefill the drawer instead of starting blank.
  function openBulkDrawer(rowIndex, item, isSto, existingLine) {
    const itemLines = item.lines ?? [];
    const line = isSto
      ? itemLines[0] ?? null
      : itemLines.find((l) => ["OPEN", "PARTIALLY_RECEIVED"].includes((l.line_status || "").toUpperCase())) ?? itemLines[0] ?? null;
    setBulkDrawer({
      ...EMPTY_BULK_DRAWER(),
      open: true,
      rowIndex,
      isSto,
      item,
      line,
      geQty: existingLine?.rcvQty || (line?.expected_qty != null ? String(line.expected_qty) : ""),
      challanNumber: existingLine?.bulkChallanNumber || "",
      challanDate: existingLine?.bulkChallanDate || "",
      invoiceNumber: existingLine?.bulkInvoiceNumber || "",
      invoiceDate: existingLine?.bulkInvoiceDate || "",
      containerNumber: existingLine?.bulkContainerNumber || "",
      ewaybillNumber: existingLine?.bulkEwaybillNumber || "",
      lrNumber: existingLine?.bulkLrNumber || "",
      rstNumber: existingLine?.bulkRstNumber || "",
    });
  }

  function closeBulkDrawer() {
    setBulkDrawer(EMPTY_BULK_DRAWER());
  }

  function updateBulkDrawer(patch) {
    setBulkDrawer((d) => ({ ...d, ...patch }));
  }

  // Mirrors the backend's validateAndPrepareBulkLineFields — at least one of
  // the four identifiers is mandatory, a filled Challan/Invoice Number makes
  // its own paired Date mandatory, and whichever date(s) are filled must sit
  // inside the document's own Bulk Effective Date window.
  function getBulkDrawerErrors(d) {
    const errors = {};
    const { challanNumber, challanDate, invoiceNumber, invoiceDate, containerNumber, ewaybillNumber, geQty, item } = d;
    if (!challanNumber.trim() && !invoiceNumber.trim() && !containerNumber.trim() && !ewaybillNumber.trim()) {
      errors.identifier = "At least one of Challan Number, Invoice Number, Container Number, or Ewaybill Number is required.";
    }
    if (challanNumber.trim() && !challanDate) {
      errors.challanDate = "Challan Date is required when Challan Number is entered.";
    }
    if (invoiceNumber.trim() && !invoiceDate) {
      errors.invoiceDate = "Invoice Date is required when Invoice Number is entered.";
    }
    const effectiveStartDate = item?.effective_start_date || "";
    const windowUpperBound = item?.bulk_window_upper_bound || null;
    if (!effectiveStartDate) {
      errors.window = "This document has no Effective Start Date configured — it cannot accept a Gate Entry.";
    } else {
      for (const [dateVal, key, label] of [
        [challanDate, "challanDate", "Challan"],
        [invoiceDate, "invoiceDate", "Invoice"],
      ]) {
        if (!dateVal || errors[key]) continue;
        if (dateVal < effectiveStartDate) {
          errors[key] = `${label} Date is before this document's Effective Start Date (${effectiveStartDate}).`;
        } else if (windowUpperBound && dateVal >= windowUpperBound) {
          errors[key] = `${label} Date falls on/after the next document's Effective Start Date (${windowUpperBound}) — outside this document's window.`;
        }
      }
    }
    if (!geQty || Number(geQty) <= 0) {
      errors.geQty = "GE Quantity is required.";
    }
    return errors;
  }

  function confirmBulkDrawer() {
    const { rowIndex, isSto, item, line, challanNumber, challanDate, invoiceNumber, invoiceDate, containerNumber, ewaybillNumber, lrNumber, geQty, rstNumber } = bulkDrawer;
    if (rowIndex === null || !line) { closeBulkDrawer(); return; }
    updateLine(rowIndex, {
      refQuery: isSto ? item.sto_number : item.po_number,
      po: isSto ? null : item,
      poLine: isSto ? null : line,
      sto: isSto ? item : null,
      stoLine: isSto ? line : null,
      csn: null,
      rcvQty: geQty,
      bulkChallanNumber: challanNumber.trim(),
      bulkChallanDate: challanDate,
      bulkInvoiceNumber: invoiceNumber.trim(),
      bulkInvoiceDate: invoiceDate,
      bulkContainerNumber: containerNumber.trim(),
      bulkEwaybillNumber: ewaybillNumber.trim(),
      bulkLrNumber: lrNumber.trim(),
      bulkRstNumber: rstNumber.trim(),
    });
    closeBulkDrawer();
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
    if (isSecurityUser && !personName.trim()) {
      setError("Person Name is required.");
      return;
    }
    const activeLines = lines.filter((l) => l.po !== null || l.sto !== null);
    if (activeLines.length === 0) {
      setError("At least one PO or STO line must be added.");
      return;
    }
    // §4.1 "GE duplicate CSN/line selection across rows" -- defense in depth;
    // the drawers above already exclude already-used candidates, but this
    // catches any stale-state edge case before it ever reaches the server.
    const seenCsnIds = new Set();
    const seenStoLineIds = new Set();
    for (let i = 0; i < activeLines.length; i++) {
      const l = activeLines[i];
      if (l.csn?.id) {
        if (seenCsnIds.has(l.csn.id)) {
          setError(`Line ${i + 1}: this CSN is already selected on another line in this Gate Entry.`);
          return;
        }
        seenCsnIds.add(l.csn.id);
      }
      if (l.stoLine?.id) {
        if (seenStoLineIds.has(l.stoLine.id)) {
          setError(`Line ${i + 1}: this STO line is already selected on another line in this Gate Entry.`);
          return;
        }
        seenStoLineIds.add(l.stoLine.id);
      }
    }
    for (let i = 0; i < activeLines.length; i++) {
      const l = activeLines[i];
      const refNumber = l.po ? l.po.po_number : l.sto.sto_number;
      const isBulk = isBulkLine(l);
      const bulkLine = isBulk ? (l.sto ? l.stoLine : l.poLine) : null;
      if (!isBulk && !l.csn) {
        setError(`Line ${i + 1} (${refNumber}): CSN must be selected.`);
        return;
      }
      if (isBulk && !bulkLine) {
        setError(`Line ${i + 1} (${refNumber}): No open line found for this BULK ${l.sto ? "STO" : "PO"}.`);
        return;
      }
      if (isBulk) {
        const bulkErrors = getBulkDrawerErrors({
          challanNumber: l.bulkChallanNumber, challanDate: l.bulkChallanDate,
          invoiceNumber: l.bulkInvoiceNumber, invoiceDate: l.bulkInvoiceDate,
          containerNumber: l.bulkContainerNumber, ewaybillNumber: l.bulkEwaybillNumber,
          geQty: l.rcvQty, item: l.po || l.sto,
        });
        const firstError = Object.values(bulkErrors)[0];
        if (firstError) {
          setError(`Line ${i + 1} (${refNumber}): ${firstError}`);
          return;
        }
      }
      if (l.sto && !isBulk && !l.stoLine) {
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
        person_name: personName.trim(),
        lines: activeLines.map((l, index) => {
          const isBulk = isBulkLine(l);
          const bulkLine = isBulk ? (l.sto ? l.stoLine : l.poLine) : null;
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
          if (isBulk) {
            return {
              csn_id: null,
              po_line_id: l.sto ? "" : (bulkLine?.id || ""),
              sto_id: l.sto?.id || null,
              sto_line_id: l.sto ? (bulkLine?.id || "") : null,
              material_id: bulkLine?.material_id || "",
              ge_qty: rcvQty,
              uom_code: bulkLine?.uom_code || bulkLine?.po_uom_code || "",
              gross_weight: lineGrossWeight,
              bulk_challan_number: l.bulkChallanNumber.trim() || null,
              bulk_challan_date: l.bulkChallanDate || null,
              bulk_invoice_number: l.bulkInvoiceNumber.trim() || null,
              bulk_invoice_date: l.bulkInvoiceDate || null,
              bulk_container_number: l.bulkContainerNumber.trim() || null,
              bulk_ewaybill_number: l.bulkEwaybillNumber.trim() || null,
              bulk_lr_number: l.bulkLrNumber.trim() || null,
              rst_number: l.bulkRstNumber.trim() || null,
            };
          }
          return {
            csn_id: l.csn?.id || null,
            po_line_id: l.po ? (l.csn?.po_line_id || "") : "",
            sto_id: l.sto?.id || null,
            sto_line_id: l.sto ? (l.stoLine?.id || "") : null,
            material_id: l.csn?.material_id || "",
            ge_qty: rcvQty,
            uom_code: l.csn?.po_uom_code || "",
            challan_or_invoice_no: l.lrNumber.trim() || null,
            // rst_number is the weighbridge RST/slip number captured at Gate Exit
            // (gate_exit_inbound.rst_number_tare) — this page has no RST input,
            // and l.lrDate is an LR/BL date, not an RST number, so it must not
            // be written here.
            rst_number: null,
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
    const isBulk = isBulkLine(line);
    const bulkLine = isBulk ? (line.sto ? line.stoLine : line.poLine) : null;
    const isImportLine = (line.csn?.csn_type || "").toUpperCase() === "IMPORT";
    const sugs = hasRef ? [] : getRefSuggestions(line.refQuery);
    const showDrop = poDropRow === i && sugs.length > 0 && (allPos.length > 0 || allStos.length > 0);
    const matName = isBulk
      ? (bulkLine?.material_name || bulkLine?.material_id || "")
      : (line.csn?.material_name || line.csn?.material_id || "");
    const uom = isBulk
      ? (bulkLine?.uom_code || bulkLine?.po_uom_code || "")
      : (line.csn?.po_uom_code || "");
    const expQty = isBulk ? (bulkLine?.expected_qty ?? "") : (line.csn?.dispatch_qty ?? "");
    const bulkIdentifierSummary = isBulk
      ? [line.bulkChallanNumber, line.bulkInvoiceNumber, line.bulkContainerNumber, line.bulkEwaybillNumber].filter(Boolean).join(" / ")
      : "";

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

        {/* Invoice / BOE no — for Bulk this column instead shows the drawer's
            captured identifiers with an Edit button (§3.7 Bulk GE-Creation
            Drawer design: Challan/Invoice/Container/Ewaybill are captured in
            the drawer, not here). */}
        <td className="w-[120px] py-1 pr-1">
          {isBulk ? (
            <span className={["truncate text-[11px]", bulkIdentifierSummary ? "text-slate-900" : "text-amber-600"].join(" ")}>
              {bulkIdentifierSummary || "Not captured"}
            </span>
          ) : (
            <input
              className="h-7 w-full border border-slate-200 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
              value={line.lrNumber}
              placeholder={line.csn ? (isImportLine ? "BOE no" : "Invoice no") : "Optional"}
              onChange={(e) => updateLine(i, { lrNumber: e.target.value })}
            />
          )}
        </td>

        {/* LR / BL date */}
        <td className="w-[120px] py-1 pr-1">
          {isBulk ? (
            <button
              type="button"
              className="h-6 border border-sky-600 bg-sky-50 px-2 text-[9px] font-semibold text-sky-800"
              onClick={() => openBulkDrawer(i, line.po || line.sto, Boolean(line.sto), line)}
            >
              Edit Bulk details
            </button>
          ) : (
            <input
              type="date"
              className="h-7 w-full border border-slate-200 bg-white px-2 text-[11px] text-slate-900 outline-none focus:border-sky-500"
              value={line.lrDate}
              onChange={(e) => updateLine(i, { lrDate: e.target.value })}
            />
          )}
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

  // Save is blocked while a Security-dept Person Name is blank, or any Bulk
  // line hasn't cleared its own Effective Date / identifier validation —
  // §3.7 "Bulk GE-Creation Drawer" design's real-time save-gating requirement.
  const personNameMissing = isSecurityUser && !personName.trim();
  const hasBlockingBulkErrors = lines.some((l) => {
    if (!isBulkLine(l)) return false;
    const bulkLine = l.sto ? l.stoLine : l.poLine;
    if (!bulkLine) return false;
    const errors = getBulkDrawerErrors({
      challanNumber: l.bulkChallanNumber, challanDate: l.bulkChallanDate,
      invoiceNumber: l.bulkInvoiceNumber, invoiceDate: l.bulkInvoiceDate,
      containerNumber: l.bulkContainerNumber, ewaybillNumber: l.bulkEwaybillNumber,
      geQty: l.rcvQty, item: l.po || l.sto,
    });
    return Object.keys(errors).length > 0;
  });

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
            disabled: saving || dataLoading || personNameMissing || hasBlockingBulkErrors,
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

            {/* Person Name (§3.7 "Bulk GE-Creation Drawer" design — general
                GE field). Non-Security dept: auto-filled, read-only.
                Security dept: blank, mandatory manual entry. */}
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Person name <span className="font-normal text-red-500">*</span>
              <input
                type="text"
                value={personNameLoading ? "Loading…" : personName}
                readOnly={!isSecurityUser}
                placeholder={isSecurityUser ? "Type the gate user's name" : ""}
                className={[
                  "h-9 border px-3 text-sm outline-none",
                  isSecurityUser
                    ? "border-slate-300 bg-white text-slate-900 focus:border-sky-500"
                    : "border-slate-200 bg-slate-50 text-slate-500",
                ].join(" ")}
                onChange={(e) => { if (isSecurityUser) setPersonName(e.target.value); }}
              />
              <span className="text-[10px] font-normal text-slate-400">
                {isSecurityUser ? "Security department — enter the name manually every entry." : "Auto-filled from your login."}
              </span>
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

      {/* ── STO GE Drawer (§3.7 STO GE-Creation Drawer design) ── */}
      <DrawerBase
        visible={stoDrawer.open}
        title={stoDrawer.sto ? `STO items — ${stoDrawer.sto.sto_number}` : "STO items"}
        side="center"
        width="min(920px, calc(100vw - 48px))"
        onEscape={closeStoDrawer}
        onClose={closeStoDrawer}
        actions={
          <>
            <button type="button" className="h-9 border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700" onClick={closeStoDrawer}>
              Cancel
            </button>
            <button
              type="button"
              className="h-9 border border-sky-700 bg-sky-600 px-4 text-sm font-semibold text-white"
              onClick={confirmStoDrawer}
              disabled={!stoDrawer.rows.some((r) => r.selected)}
            >
              Add selected to GE
            </button>
          </>
        }
      >
        {stoDrawer.sto?.mother && (
          <div className="mb-3 grid grid-cols-3 gap-3 border border-violet-200 bg-violet-50 px-3 py-2 text-[11px]">
            <div>
              <span className="block text-violet-600">Mother PO Number</span>
              <span className="font-semibold text-violet-900">{stoDrawer.sto.mother.mother_po_number || "—"}</span>
            </div>
            <div>
              <span className="block text-violet-600">Mother Invoice Number</span>
              <span className="font-semibold text-violet-900">{stoDrawer.sto.mother.mother_invoice_number || "—"}</span>
            </div>
            <div>
              <span className="block text-violet-600">Mother BOE Number</span>
              <span className="font-semibold text-violet-900">{stoDrawer.sto.mother.mother_boe_number || "—"}</span>
            </div>
          </div>
        )}
        {stoDrawer.rows.length === 0 ? (
          <p className="text-sm text-slate-500">No open lines for this STO.</p>
        ) : (
          <ErpDenseGrid
            columns={[
              {
                key: "selected",
                label: "",
                width: "36px",
                render: (row, idx) => (
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => updateStoDrawerRow(idx, { selected: e.target.checked })}
                  />
                ),
              },
              { key: "sto_number", label: "STO Number", width: "110px", render: () => stoDrawer.sto?.sto_number },
              { key: "csn_number", label: "CSN", width: "110px", render: (row) => row.stoLine?.csn_number || "—" },
              { key: "material_name", label: "Material", render: (row) => row.stoLine?.material_name || "—" },
              { key: "uom_code", label: "UOM", width: "70px", render: (row) => row.stoLine?.uom_code || "—" },
              { key: "expected_qty", label: "Expected qty", width: "100px", render: (row) => Number(row.stoLine?.expected_qty ?? 0).toLocaleString() },
              {
                key: "ge_qty",
                label: "GE quantity",
                width: "100px",
                render: (row, idx) => (
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    className="h-7 w-full border border-slate-200 bg-white px-2 text-right text-[11px] outline-none focus:border-sky-500"
                    value={row.geQty}
                    onChange={(e) => updateStoDrawerRow(idx, { geQty: e.target.value })}
                  />
                ),
              },
              {
                key: "invoice_no",
                label: "Invoice No",
                width: "120px",
                render: (row, idx) => (
                  <input
                    type="text"
                    className="h-7 w-full border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-sky-500"
                    value={row.invoiceNo}
                    onChange={(e) => updateStoDrawerRow(idx, { invoiceNo: e.target.value })}
                  />
                ),
              },
              {
                key: "lr_date",
                label: "LR/BL Date",
                width: "130px",
                render: (row, idx) => (
                  <input
                    type="date"
                    className="h-7 w-full border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-sky-500"
                    value={row.lrDate || ""}
                    onChange={(e) => updateStoDrawerRow(idx, { lrDate: e.target.value })}
                  />
                ),
              },
              {
                key: "remove",
                label: "",
                width: "36px",
                render: (row, idx) => (
                  <button
                    type="button"
                    className="text-[11px] text-rose-600"
                    onClick={() => updateStoDrawerRow(idx, { selected: false })}
                  >
                    ✕
                  </button>
                ),
              },
            ]}
            rows={stoDrawer.rows}
            rowKey={(row, idx) => row.stoLine?.id ?? idx}
          />
        )}
      </DrawerBase>

      {/* ── Bulk GE Drawer (§3.7 "Bulk GE-Creation Drawer" design) ── */}
      {(() => {
        const bd = bulkDrawer;
        const bulkErrors = bd.open ? getBulkDrawerErrors(bd) : {};
        const hasErrors = Object.keys(bulkErrors).length > 0;
        const refNumber = bd.isSto ? bd.item?.sto_number : bd.item?.po_number;
        const vendorName = bd.isSto ? null : bd.item?.vendor_name;
        return (
          <DrawerBase
            visible={bd.open}
            title={refNumber ? `Bulk GE details — ${refNumber}` : "Bulk GE details"}
            side="center"
            width="min(760px, calc(100vw - 48px))"
            onEscape={closeBulkDrawer}
            onClose={closeBulkDrawer}
            actions={
              <>
                <button type="button" className="h-9 border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700" onClick={closeBulkDrawer}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="h-9 border border-sky-700 bg-sky-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={confirmBulkDrawer}
                  disabled={hasErrors}
                >
                  Save to line
                </button>
              </>
            }
          >
            {!bd.item ? null : (
              <div className="grid gap-4">
                {!bd.isSto && (
                  <div className="grid grid-cols-2 gap-3 border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">
                    <div>
                      <span className="block text-slate-400">Vendor</span>
                      <span className="font-semibold text-slate-800">{vendorName || "—"}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400">Effective Start Date</span>
                      <span className="font-semibold text-slate-800">{bd.item?.effective_start_date || "Not configured"}</span>
                    </div>
                  </div>
                )}
                {bd.isSto && (
                  <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">
                    <span className="block text-slate-400">Effective Start Date</span>
                    <span className="font-semibold text-slate-800">{bd.item?.effective_start_date || "Not configured"}</span>
                  </div>
                )}

                {bulkErrors.identifier && (
                  <p className="border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{bulkErrors.identifier}</p>
                )}
                {bulkErrors.window && (
                  <p className="border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{bulkErrors.window}</p>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Challan Number
                    <input
                      type="text"
                      className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                      value={bd.challanNumber}
                      onChange={(e) => updateBulkDrawer({ challanNumber: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Challan Date
                    <input
                      type="date"
                      className={["h-9 border bg-white px-3 text-sm outline-none focus:border-sky-500", bulkErrors.challanDate ? "border-red-400" : "border-slate-300"].join(" ")}
                      value={bd.challanDate}
                      onChange={(e) => updateBulkDrawer({ challanDate: e.target.value })}
                    />
                    {bulkErrors.challanDate && <span className="text-[10px] font-semibold text-red-600">{bulkErrors.challanDate}</span>}
                  </label>

                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Invoice Number
                    <input
                      type="text"
                      className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                      value={bd.invoiceNumber}
                      onChange={(e) => updateBulkDrawer({ invoiceNumber: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Invoice Date
                    <input
                      type="date"
                      className={["h-9 border bg-white px-3 text-sm outline-none focus:border-sky-500", bulkErrors.invoiceDate ? "border-red-400" : "border-slate-300"].join(" ")}
                      value={bd.invoiceDate}
                      onChange={(e) => updateBulkDrawer({ invoiceDate: e.target.value })}
                    />
                    {bulkErrors.invoiceDate && <span className="text-[10px] font-semibold text-red-600">{bulkErrors.invoiceDate}</span>}
                  </label>

                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Container Number
                    <input
                      type="text"
                      className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                      value={bd.containerNumber}
                      onChange={(e) => updateBulkDrawer({ containerNumber: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Ewaybill Number
                    <input
                      type="text"
                      className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                      value={bd.ewaybillNumber}
                      onChange={(e) => updateBulkDrawer({ ewaybillNumber: e.target.value })}
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    LR Number <span className="font-normal text-slate-400">(optional)</span>
                    <input
                      type="text"
                      className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                      value={bd.lrNumber}
                      onChange={(e) => updateBulkDrawer({ lrNumber: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    RST Number
                    <input
                      type="text"
                      className="h-9 border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500"
                      value={bd.rstNumber}
                      onChange={(e) => updateBulkDrawer({ rstNumber: e.target.value })}
                    />
                  </label>
                </div>

                <p className="text-[10px] text-slate-400">
                  At least one of Challan Number, Invoice Number, Container Number, or Ewaybill Number is required.
                  Gross weight is captured once at the vehicle header; Tare/Net weight are captured at Gate Exit.
                </p>

                <div className="grid grid-cols-4 gap-3 border-t border-slate-200 pt-3">
                  <label className="col-span-2 grid gap-1 text-xs font-semibold text-slate-700">
                    Material
                    <input readOnly className="h-9 border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700" value={bd.line?.material_name || bd.line?.material_id || "—"} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    UOM
                    <input readOnly className="h-9 border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700" value={bd.line?.uom_code || bd.line?.po_uom_code || "—"} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    Ordered/Expected Qty
                    <input readOnly className="h-9 border border-slate-200 bg-slate-50 px-3 text-right text-sm text-slate-700" value={bd.line?.expected_qty != null ? Number(bd.line.expected_qty).toLocaleString() : "—"} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    GE Quantity <span className="font-normal text-red-500">*</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      className={["h-9 border bg-white px-3 text-right text-sm outline-none focus:border-sky-500", bulkErrors.geQty ? "border-red-400" : "border-slate-300"].join(" ")}
                      value={bd.geQty}
                      onChange={(e) => updateBulkDrawer({ geQty: e.target.value })}
                    />
                    {bulkErrors.geQty && <span className="text-[10px] font-semibold text-red-600">{bulkErrors.geQty}</span>}
                  </label>
                </div>
              </div>
            )}
          </DrawerBase>
        );
      })()}

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
