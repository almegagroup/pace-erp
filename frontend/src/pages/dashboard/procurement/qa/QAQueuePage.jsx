import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listMaterials } from "../../om/omApi.js";
import {
  assignQAOfficer,
  getQADocument,
  listQADocuments,
  listGRNs,
} from "../procurementApi.js";

const LIMIT = 50;

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "IN_PROGRESS":
      return "bg-sky-100 text-sky-800";
    case "DECISION_MADE":
      return "bg-emerald-100 text-emerald-800";
    case "PENDING":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function normalizeSearch(text) {
  return String(text || "").trim().toLowerCase();
}

export default function QAQueuePage() {
  const navigate = useNavigate();
  const { runtimeContext, shellProfile } = useMenu();
  const [rows, setRows] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [grns, setGrns] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [assignmentFilter, setAssignmentFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const companyId = runtimeContext?.selectedCompanyId || "";
  const myAssignee = shellProfile?.userCode || "";

  useEffect(() => {
    setPage(1);
  }, [assignmentFilter, search, statusFilter]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const statuses =
          statusFilter === "OPEN"
            ? ["PENDING", "IN_PROGRESS"]
            : [statusFilter];
        const qaLists = await Promise.all(
          statuses.map((status) =>
            listQADocuments({
              company_id: companyId || undefined,
              status,
              limit: 200,
            })
          )
        );
        const mergedRows = qaLists.flatMap((item) => (Array.isArray(item) ? item : []));
        const uniqueRows = Array.from(
          new Map(mergedRows.map((row) => [row.id, row])).values()
        );

        const [details, grnData, materialData] = await Promise.all([
          Promise.all(
            uniqueRows.map(async (row) => {
              try {
                const detail = await getQADocument(row.id);
                return {
                  ...row,
                  assigned_to: detail?.assigned_to ?? "",
                  total_qty: detail?.total_qty ?? row.total_qty ?? 0,
                  uom: detail?.uom_code || detail?.uom || "",
                };
              } catch {
                return row;
              }
            })
          ),
          listGRNs({
            company_id: companyId || undefined,
            limit: 200,
            offset: 0,
          }),
          listMaterials({ limit: 200, offset: 0 }),
        ]);

        if (!active) {
          return;
        }

        setRows(details);
        setGrns(Array.isArray(grnData?.data) ? grnData.data : []);
        setMaterials(Array.isArray(materialData?.data) ? materialData.data : []);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setRows([]);
        setGrns([]);
        setMaterials([]);
        setError(
          loadError instanceof Error ? loadError.message : "PROCUREMENT_QA_QUEUE_FAILED"
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [companyId, refreshToken, statusFilter]);

  const grnMap = useMemo(
    () => new Map(grns.map((row) => [row.id, row])),
    [grns]
  );
  const materialMap = useMemo(
    () => new Map(materials.map((row) => [row.id, row])),
    [materials]
  );
  const filteredRows = useMemo(() => {
    const needle = normalizeSearch(search);
    let nextRows = rows;

    if (assignmentFilter === "MINE" && myAssignee) {
      nextRows = nextRows.filter((row) => String(row.assigned_to || "") === myAssignee);
    }
    if (assignmentFilter === "UNASSIGNED") {
      nextRows = nextRows.filter((row) => !String(row.assigned_to || "").trim());
    }
    if (!needle) {
      return nextRows;
    }

    return nextRows.filter((row) => {
      const grn = grnMap.get(row.grn_id);
      const material = materialMap.get(row.material_id);
      const haystack = [
        row.qa_doc_number,
        grn?.grn_number,
        material?.material_name,
        material?.material_code,
        row.assigned_to,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [assignmentFilter, grnMap, materialMap, myAssignee, rows, search]);

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filteredRows.slice((safePage - 1) * LIMIT, safePage * LIMIT),
    [filteredRows, safePage]
  );
  const startIndex = total === 0 ? 0 : (safePage - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(safePage * LIMIT, total);

  async function handleAssignToMe(row) {
    if (!myAssignee) {
      setError("Current user identity is unavailable for assignment.");
      return;
    }
    setError("");
    setNotice("");
    try {
      await assignQAOfficer(row.id, { assigned_to: myAssignee });
      setNotice(`${row.qa_doc_number || "QA document"} assigned to you.`);
      setRefreshToken((value) => value + 1);
    } catch (assignError) {
      setError(
        assignError instanceof Error ? assignError.message : "PROCUREMENT_QA_ASSIGN_FAILED"
      );
    }
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_QA_DOCUMENT.screen_code);
    navigate(`/dashboard/procurement/qa-documents/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Inward QA Queue"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => setRefreshToken((value) => value + 1),
        },
      ]}
      notices={[
        ...(error ? [{ key: "qa-queue-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "qa-queue-notice", tone: "success", message: notice }] : []),
      ]}
      filterSection={{
        eyebrow: "Queue Filters",
        title: "Pending and in-progress QA work",
        children: (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_180px_180px]">
            <QuickFilterInput
              label="Search"
              value={search}
              onChange={setSearch}
              primaryFocus
              placeholder="Search QA, GRN or material"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="OPEN">PENDING + IN_PROGRESS</option>
                <option value="PENDING">PENDING</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="DECISION_MADE">DECISION_MADE</option>
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Assignment
              <select
                value={assignmentFilter}
                onChange={(event) => setAssignmentFilter(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="ALL">ALL</option>
                <option value="MINE">MY WORK</option>
                <option value="UNASSIGNED">UNASSIGNED</option>
              </select>
            </label>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "QA Work Queue",
        title: loading ? "Loading QA queue" : `${total} QA document row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={safePage}
              setPage={setPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={total}
            />
            <ErpDenseGrid
              columns={[
                { key: "qa_doc_number", label: "QA Number", width: "140px" },
                {
                  key: "grn_number",
                  label: "GRN Number",
                  width: "140px",
                  render: (row) => grnMap.get(row.grn_id)?.grn_number || row.grn_id || "—",
                },
                {
                  key: "material_name",
                  label: "Material",
                  render: (row) =>
                    materialMap.get(row.material_id)?.material_name ||
                    materialMap.get(row.material_id)?.material_code ||
                    row.material_id ||
                    "—",
                },
                { key: "total_qty", label: "Total Qty", width: "110px" },
                {
                  key: "uom",
                  label: "UOM",
                  width: "90px",
                  render: (row) => row.uom || "—",
                },
                {
                  key: "assigned_to",
                  label: "Assigned To",
                  width: "160px",
                  render: (row) => row.assigned_to || "Unassigned",
                },
                {
                  key: "public_status",
                  label: "Status",
                  width: "130px",
                  render: (row) => (
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusTone(row.public_status)}`}
                    >
                      {row.public_status}
                    </span>
                  ),
                },
                { key: "created_at", label: "Created", width: "120px" },
                {
                  key: "actions",
                  label: "Actions",
                  width: "150px",
                  render: (row) =>
                    !String(row.assigned_to || "").trim() &&
                    ["PENDING", "IN_PROGRESS"].includes(String(row.public_status || "").toUpperCase()) ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleAssignToMe(row);
                        }}
                        className="border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900"
                      >
                        Assign To Me
                      </button>
                    ) : (
                      "—"
                    ),
                },
              ]}
              rows={pageRows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openDetail(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading QA queue..." : "No QA document matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
