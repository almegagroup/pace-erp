import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
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
  const [reloadTick, setReloadTick] = useState(0);

  const activeTab = resolveInitialTab(searchParams.get("tab"));
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);

  useEffect(() => {
    if (!effectiveCompanyId || activeTab !== "lc" || lcRows.length > 0) {
      return;
    }
    let active = true;
    async function loadLcAlerts() {
      setLoadingLc(true);
      setError("");
      try {
        const data = await getLCAlertList({ company_id: effectiveCompanyId });
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
  }, [activeTab, effectiveCompanyId, lcRows.length, reloadTick]);

  useEffect(() => {
    if (!effectiveCompanyId || activeTab !== "vessel" || vesselRows.length > 0) {
      return;
    }
    let active = true;
    async function loadVesselAlerts() {
      setLoadingVessel(true);
      setError("");
      try {
        const data = await getVesselBookingAlertList({ company_id: effectiveCompanyId });
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
  }, [activeTab, effectiveCompanyId, vesselRows.length, reloadTick]);

  function switchTab(nextTab) {
    setSearchParams({ tab: nextTab });
    setError("");
  }

  const notices = error ? [{ key: "csn-alerts-error", tone: "error", message: error }] : [];
  const activeRows = activeTab === "lc" ? lcRows : vesselRows;
  const loading = activeTab === "lc" ? loadingLc : loadingVessel;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => {
        if (activeTab === "lc") {
          setLcRows([]);
        } else {
          setVesselRows([]);
        }
        setReloadTick((tick) => tick + 1);
      },
    },
  });

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
            <TransactionCompanySelector
              runtimeContext={runtimeContext}
              value={companyId}
              onChange={(nextValue) => {
                setCompanyId(nextValue);
                setLcRows([]);
                setVesselRows([]);
              }}
              label="Company"
            />
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
            emptyMessage={loading ? "Loading alerts..." : effectiveCompanyId ? "No alert rows found for this tab." : "No company resolved for this session."}
          />
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
