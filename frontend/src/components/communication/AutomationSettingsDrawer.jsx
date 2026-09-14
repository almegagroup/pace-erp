import DrawerBase from "../layer/DrawerBase.jsx";

function channelLabel(channel) {
  return String(channel || "").toUpperCase() === "EMAIL" ? "Email" : String(channel || "");
}

export default function AutomationSettingsDrawer({ visible, metadata, onClose }) {
  const canShow = visible === true && metadata?.visible === true;
  return (
    <DrawerBase
      visible={canShow}
      side="center"
      width="min(560px, calc(100vw - 24px))"
      title="Automation Settings"
      onEscape={onClose}
      onClose={onClose}
      actions={(
        <button
          type="button"
          onClick={onClose}
          className="border border-slate-400 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700"
        >
          Close
        </button>
      )}
    >
      <dl className="grid gap-4 text-sm">
        <div className="grid gap-1 border-b border-slate-200 pb-3">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Page</dt>
          <dd className="font-semibold text-slate-900">
            {metadata?.page?.tx_code} — {metadata?.page?.title}
          </dd>
        </div>
        <div className="grid gap-1 border-b border-slate-200 pb-3">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Surface</dt>
          <dd className="font-semibold text-slate-900">{metadata?.surface?.label}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Channel</dt>
          <dd className="font-semibold text-slate-900">{channelLabel(metadata?.channel)}</dd>
        </div>
      </dl>
    </DrawerBase>
  );
}
