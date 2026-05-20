import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import { getLCAlertList, getVesselBookingAlertList } from "../procurementApi.js";

function resolveInitialTab(rawValue) {
  return rawValue === "vessel" ? "vessel" : "lc";
}

export default function CSNAlertsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const [lcRows, setLcRows] = useState([]);
  const [vesselRows, setVesselRows] = useState([]);
  const [loadingLc, setLoadingLc] = useState(false);
  const [loadingVessel, setLoadingVessel] = useState(false);
  const [error, setError] = useState("");

  const activeTab = resolveInitialTab(searchParams.get("tab"));
  const companyOptions = useMemo(
    () =>
      (runtimeContext?.availableCompanies ?? []).map((entry) => ({
        value: entry.id,
        label: entry.company_name || entry.company_code || entry.id,
      })),
    [runtimeContext?.availableCompanies]
  );

  useEffect(() => {
    if (!companyId) {
      setCompanyId(runtimeContext?.selectedCompanyId || companyOptions[0]?.value || "");
    }
  }, [companyId, companyOptions, runtimeContext?.selectedCompanyId]);

  useEffect(() => {
    if (!companyId || activeTab !== "lc" || lcRows.length > 0) {
      return;
    }
    let active = true;
    async function loadLcAlerts() {
      setLoadingLc(true);
      setError("");
      try {
        const data = await getLCAlertList({ company_id: companyId });
        if (active) {
          setLcRows(Array.isArray(data) ? data : []);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_LC_ALERT_LIST_FAILED");
        }
      } finally {
        if (active) {
          setLoadingLc(false);
        }
      }
    }
    void loadLcAlerts();
    return () => {
      active = false;
    };
  }, [activeTab, companyId, lcRows.length]);

  useEffect(() => {
    if (!companyId || activeTab !== "vessel" || vesselRows.length > 0) {
      return;
    }
    let active = true;
    async function loadVesselAlerts() {
      setLoadingVessel(true);
      setError("");
      try {
        const data = await getVesselBookingAlertList({ company_id: companyId });
        if (active) {
          setVesselRows(Array.isArray(data) ? data : []);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_VESSEL_ALERT_LIST_FAILED");
        }
      } finally {
        if (active) {
          setLoadingVessel(false);
        }
      }
    }
    void loadVesselAlerts();
    return () => {
      active = false;
    };
  }, [activeTab, companyId, vesselRows.length]);

  function switchTab(nextTab) {
    setSearchParams({ tab: nextTab });
    setError("");
  }

  const notices = error ? [{ key: "csn-alerts-error", tone: "error", message: error }] : [];
  const activeRows = activeTab === "lc" ? lcRows : vesselRows;
  const loading = activeTab === "lc" ? loadingLc : loadingVessel;

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="CSN Alerts"
      notices={notices}
      actions={[{ key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() }]}
    >
      <div className="grid gap-4">
        <ErpSectionCard eyebrow="Alert Scope" title="Open attention items">
          <div className="grid gap-3 lg:grid-cols-[220px_auto]">
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Company
              <select
                value={companyId}
                onChange={(event) => {
                  setCompanyId(event.target.value);
                  setLcRows([]);
                  setVesselRows([]);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select company</option>
                {companyOptions.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <button
                type="button"
                onClick={() => switchTab("lc")}
                className={`border px-3 py-2 text-sm font-semibold ${activeTab === "lc" ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"}`}
              >
                LC Alerts
              </button>
              <button
                type="button"
                onClick={() => switchTab("vessel")}
                className={`border px-3 py-2 text-sm font-semibold ${activeTab === "vessel" ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"}`}
              >
                Vessel Booking Alerts
              </button>
            </div>
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow={activeTab === "lc" ? "LC Alert List" : "Vessel Booking Alert List"}
          title={activeTab === "lc" ? "CSNs nearing LC deadline" : "CSNs missing vessel booking confirmation"}
        >
          <ErpDenseGrid
            columns={
              activeTab === "lc"
                ? [
                    { key: "csn_number", label: "CSN", width: "140px" },
                    { key: "vendor_name", label: "Vendor", width: "160px" },
                    { key: "material_name", label: "Material", width: "160px" },
                    { key: "eta_at_port", label: "ETA Port", width: "120px" },
                    { key: "lc_due_date", label: "LC Deadline", width: "120px" },
                    {
                      key: "open",
                      label: "Open",
                      width: "110px",
                      render: (row) => (
                        <Link
                          to={`/dashboard/procurement/csns/${encodeURIComponent(row.id)}`}
                          className="text-sky-700 underline underline-offset-2"
                        >
                          Open CSN
                        </Link>
                      ),
                    },
                  ]
                : [
                    { key: "csn_number", label: "CSN", width: "140px" },
                    { key: "vendor_name", label: "Vendor", width: "160px" },
                    { key: "po_date", label: "PO Date", width: "120px" },
                    { key: "etd", label: "ETD", width: "120px" },
                    { key: "scheduled_eta_to_port", label: "Scheduled ETA", width: "140px" },
                    {
                      key: "open",
                      label: "Open",
                      width: "110px",
                      render: (row) => (
                        <Link
                          to={`/dashboard/procurement/csns/${encodeURIComponent(row.id)}`}
                          className="text-sky-700 underline underline-offset-2"
                        >
                          Open CSN
                        </Link>
                      ),
                    },
                  ]
            }
            rows={activeRows}
            rowKey={(row) => row.id}
            emptyMessage={loading ? "Loading alerts..." : "No alert rows found for this tab."}
          />
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
