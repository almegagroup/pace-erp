/*
 * File-ID: 25.2
 * File-Path: frontend/src/pages/dashboard/procurement/DocumentFlowSection.jsx
 * Gate: 25
 * Phase: 25
 * Domain: PROCUREMENT
 * Purpose: Reusable document flow chain section for procurement detail pages.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../navigation/screens/projects/operationModule/operationScreens.js";
import { getDocumentFlow } from "./procurementApi.js";

const DOC_TYPE_CONFIG = {
  PO: { label: "PO", screen: "PROC_PO_DETAIL", path: "/dashboard/procurement/purchase-orders", bg: "bg-sky-100", text: "text-sky-800" },
  CSN: { label: "CSN", screen: "PROC_CSN_DETAIL", path: "/dashboard/procurement/csns", bg: "bg-violet-100", text: "text-violet-800" },
  GATE_ENTRY: { label: "Gate Entry", screen: "PROC_GATE_ENTRY_DETAIL", path: "/dashboard/procurement/gate-entries", bg: "bg-slate-100", text: "text-slate-700" },
  GRN: { label: "GRN", screen: "PROC_GRN_DETAIL", path: "/dashboard/procurement/grns", bg: "bg-emerald-100", text: "text-emerald-800" },
  QA: { label: "QA", screen: "PROC_QA_QUEUE", path: "/dashboard/procurement/qa-queue", bg: "bg-amber-100", text: "text-amber-800" },
  IV: { label: "Invoice Verif", screen: "PROC_IV_DETAIL", path: "/dashboard/procurement/accounts/invoice-verifications", bg: "bg-blue-100", text: "text-blue-800" },
  LANDED_COST: { label: "Landed Cost", screen: "PROC_LC_DETAIL", path: "/dashboard/procurement/accounts/landed-costs", bg: "bg-indigo-100", text: "text-indigo-800" },
  RTV: { label: "RTV", screen: "PROC_RTV_DETAIL", path: "/dashboard/procurement/rtvs", bg: "bg-orange-100", text: "text-orange-800" },
  DEBIT_NOTE: { label: "Debit Note", screen: "PROC_DEBIT_NOTE_DETAIL", path: "/dashboard/procurement/debit-notes", bg: "bg-rose-100", text: "text-rose-800" },
  STO: { label: "STO", screen: "PROC_STO_DETAIL", path: "/dashboard/procurement/stos", bg: "bg-purple-100", text: "text-purple-800" },
  SO: { label: "Sales Order", screen: "PROC_SO_DETAIL", path: "/dashboard/procurement/sales-orders", bg: "bg-teal-100", text: "text-teal-800" },
  SALES_INVOICE: { label: "Sales Invoice", screen: "PROC_INV_DETAIL", path: "/dashboard/procurement/sales-invoices", bg: "bg-green-100", text: "text-green-800" },
  PID: { label: "Phys. Inv.", screen: "PROC_PI_DETAIL", path: "/dashboard/procurement/physical-inventory", bg: "bg-slate-100", text: "text-slate-700" },
};

export default function DocumentFlowSection({ docType, docId }) {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!docType || !docId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");

    getDocumentFlow({ doc_type: docType, id: docId })
      .then((res) => {
        if (!cancelled) setNodes(Array.isArray(res) ? res : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "FLOW_FETCH_FAILED");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [docId, docType]);

  function handleNodeClick(node) {
    if (node.is_current) return;
    const cfg = DOC_TYPE_CONFIG[node.doc_type];
    if (!cfg) return;
    const screen = OPERATION_SCREENS[cfg.screen];
    if (screen) openScreen(screen.screen_code);
    // QA has no standalone detail route — the queue page opens the matching row inline.
    if (node.doc_type === "QA") {
      navigate(`${cfg.path}?qa_id=${encodeURIComponent(node.id)}`);
      return;
    }
    navigate(`${cfg.path}/${node.id}`);
  }

  return (
    <ErpSectionCard eyebrow="Document Flow" title="Related document chain">
      {loading ? (
        <div className="text-sm text-slate-400">Loading document flow...</div>
      ) : error ? (
        <div className="text-sm text-rose-600">{error}</div>
      ) : nodes.length === 0 ? (
        <div className="text-sm text-slate-400">No linked documents found.</div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
          {nodes.map((node, idx) => {
            const cfg = DOC_TYPE_CONFIG[node.doc_type] ?? {
              label: node.doc_type,
              bg: "bg-slate-100",
              text: "text-slate-700",
            };
            const isClickable = !node.is_current && !!DOC_TYPE_CONFIG[node.doc_type];

            return (
              <div key={`${node.doc_type}-${node.id}`} className="flex items-center gap-2">
                {idx > 0 ? <span className="text-sm text-slate-400">&rarr;</span> : null}
                <button
                  type="button"
                  onClick={() => handleNodeClick(node)}
                  disabled={!isClickable}
                  className={[
                    "flex flex-col rounded border px-3 py-2 text-left text-xs transition-all",
                    node.is_current
                      ? `cursor-default border-sky-400 ring-2 ring-sky-300 ${cfg.bg} ${cfg.text}`
                      : isClickable
                        ? `cursor-pointer border-slate-200 hover:border-slate-400 hover:shadow-sm ${cfg.bg} ${cfg.text}`
                        : `cursor-default border-slate-200 ${cfg.bg} ${cfg.text}`,
                  ].join(" ")}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide">{cfg.label}</span>
                  <span className="mt-0.5 text-[12px] font-medium">{node.doc_number || node.id.slice(0, 8)}</span>
                  <span className="mt-0.5 text-[10px] opacity-70">{node.status}</span>
                  {node.date ? <span className="mt-0.5 text-[10px] opacity-60">{node.date}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ErpSectionCard>
  );
}
