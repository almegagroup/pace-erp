export function getPIStatusMeta(status) {
  switch (String(status || "").toUpperCase()) {
    case "COUNTED":
      return {
        value: "COUNTED",
        label: "Counted",
        badgeClassName: "bg-amber-100 text-amber-800",
        previewTone: "amber",
      };
    case "PENDING_APPROVAL":
      return {
        value: "PENDING_APPROVAL",
        label: "Pending Approval",
        badgeClassName: "bg-violet-100 text-violet-800",
        previewTone: "violet",
      };
    case "POSTED":
      return {
        value: "POSTED",
        label: "Posted",
        badgeClassName: "bg-emerald-100 text-emerald-800",
        previewTone: "emerald",
      };
    case "CANCELLED":
      return {
        value: "CANCELLED",
        label: "Cancelled",
        badgeClassName: "bg-slate-200 text-slate-600",
        previewTone: "slate",
      };
    case "OPEN":
    default:
      return {
        value: "OPEN",
        label: "Open",
        badgeClassName: "bg-sky-100 text-sky-800",
        previewTone: "sky",
      };
  }
}
