import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { listVendors } from "../../om/omApi.js";
import { listPOOrderGroups } from "../procurementApi.js";

function getStatusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING_APPROVAL":
      return "bg-amber-100 text-amber-800";
    case "CONFIRMED":
      return "bg-emerald-100 text-emerald-800";
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    case "DRAFT":
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function POOrderGroupListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [status, setStatus] = useState("PENDING_APPROVAL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [groupData, vendorData] = await Promise.all([
          listPOOrderGroups({ status: status || undefined, limit: 100, offset: 0 }),
          listVendors({ limit: 200, offset: 0 }),
        ]);
        if (!active) return;
        setRows(Array.isArray(groupData?.data) ? groupData.data : []);
        setVendors(Array.isArray(vendorData?.data) ? vendorData.data : []);
      } catch (loadError) {
        if (!active) return;
        setRows([]);
        setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_PO_ORDER_GROUP_LIST_FAILED");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [status]);

  const vendorMap = useMemo(() => new Map(vendors.map((entry) => [entry.id, entry])), [vendors]);
  const companyMap = useMemo(
    () => new Map((runtimeContext?.availableCompanies ?? []).map((entry) => [entry.id, entry])),
    [runtimeContext?.availableCompanies]
  );

  function openDetail(row) {
    navigate(`/dashboard/procurement/po-order-groups/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Purchase Order Approvals"
      notices={error ? [{ key: "err", tone: "error", message: error }] : []}
      actions={[{ key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => setStatus((s) => s) }]}
    >
      <ErpSectionCard eyebrow="Filter" title="Order status">
        <div className="flex gap-2">
          {["PENDING_APPROVAL", "DRAFT", "CONFIRMED", ""].map((s) => (
            <button
              key={s || "ALL"}
              type="button"
              onClick={() => setStatus(s)}
              className={`border px-3 py-1.5 text-xs font-semibold ${status === s ? "border-sky-600 bg-sky-100 text-sky-900" : "border-slate-300 bg-white text-slate-600"}`}
            >
              {s || "ALL"}
            </button>
          ))}
        </div>
      </ErpSectionCard>

      <ErpSectionCard eyebrow="Orders" title={loading ? "Loading..." : `${rows.length} order(s)`}>
        <ErpDenseGrid
          columns={[
            { key: "created_at", label: "Created", width: "140px", render: (row) => (row.created_at || "").slice(0, 10) },
            { key: "vendor_name", label: "Vendor", render: (row) => vendorMap.get(row.vendor_id)?.vendor_name || row.vendor_id || "-" },
            { key: "company_name", label: "Company", render: (row) => companyMap.get(row.company_id)?.company_name || row.company_id || "-" },
            { key: "po_count", label: "POs", width: "80px", render: (row) => (Array.isArray(row.purchase_orders) ? row.purchase_orders.length : 0) },
            {
              key: "po_numbers",
              label: "PO Numbers",
              render: (row) => (Array.isArray(row.purchase_orders) ? row.purchase_orders.map((p) => p.po_number).join(", ") : "-"),
            },
            {
              key: "status",
              label: "Status",
              width: "150px",
              render: (row) => (
                <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${getStatusTone(row.status)}`}>
                  {row.status}
                </span>
              ),
            },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          onRowActivate={openDetail}
          getRowProps={(row) => ({ onDoubleClick: () => openDetail(row), className: "cursor-pointer hover:bg-sky-50" })}
          emptyMessage={loading ? "Loading..." : "No order groups found for this status."}
        />
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
