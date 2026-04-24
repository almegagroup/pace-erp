import { popScreen, getActiveScreenContext } from "../../../navigation/screenStackEngine.js";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";

function formatDateTime(value) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SAAuditDetail() {
  const context = getActiveScreenContext() ?? {};
  const row = context.auditRow ?? null;

  return (
    <ErpScreenScaffold
      eyebrow="SA Audit Viewer"
      title="Audit Detail"
      actions={[
        {
          key: "back",
          label: "Back To Audit",
          tone: "primary",
          onClick: () => popScreen(),
        },
      ]}
      footerHints={["Esc Back", "Ctrl+K Command Bar"]}
    >
      {!row ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
          Audit detail context is missing. Return to the audit register and open a row again.
        </div>
      ) : (
        <div className="grid gap-2">
          {[
            ["Action", row.action_code ?? "N/A"],
            ["Status", row.status ?? "UNKNOWN"],
            ["Performed", formatDateTime(row.performed_at)],
            ["Actor", row.admin_user_id ?? "N/A"],
            ["Request", row.request_id ?? "N/A"],
            ["Resource Type", row.resource_type ?? "N/A"],
            ["Resource Id", row.resource_id ?? "N/A"],
            ["Company", row.company_id ?? "Global"],
            ["Audit Id", row.audit_id ?? "N/A"],
          ].map(([label, value]) => (
            <div key={label} className="border border-slate-300 bg-white px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {label}
              </div>
              <div className="mt-1 break-all text-sm text-slate-900">{value}</div>
            </div>
          ))}
        </div>
      )}
    </ErpScreenScaffold>
  );
}
