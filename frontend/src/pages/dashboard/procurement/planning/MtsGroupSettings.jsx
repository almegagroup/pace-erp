/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/MtsGroupSettings.jsx
 * Domain: PROCUREMENT / MTS PLANNING
 * Purpose: PO22 Material Settings — Group Settings (owner 2026-10-22): for each material group of
 *          this company's MTS Strokes / Pack BOMs, which member is used first. PO22 planning and
 *          the MTS production auto-derive both follow it. No setting = default.
 * Authority: Frontend (validation and saving are on the backend)
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pushToast } from "../../../../store/uiToast.js";
import { getMtsGroupUsageOrder, saveMtsGroupUsageOrder } from "../procurementApi.js";

const MODE_LABEL = {
  MOST_STOCK_FIRST: "Most stock first",
  LEAST_STOCK_FIRST: "Least stock first",
  FIXED_ORDER: "Fixed order",
};
const INPUT = "h-7 border border-sky-300 bg-sky-50 px-1.5 text-xs text-sky-900 outline-none focus:border-sky-600";

function fmtQty(value) {
  return Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}
function memberLabel(member) {
  return member ? `${member.material_code ? `${member.material_code} — ` : ""}${member.material_name}` : "—";
}

export default function MtsGroupSettings({ companyId, asOf, today, canEdit }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const groupsQ = useQuery({
    queryKey: ["procurement", "mts-requirement", "group-usage-order", companyId, asOf],
    queryFn: () => getMtsGroupUsageOrder({ company_id: companyId, as_of: asOf }),
    enabled: Boolean(companyId) && open,
  });
  const rows = useMemo(() => groupsQ.data?.rows ?? [], [groupsQ.data]);
  const editable = canEdit && groupsQ.data?.can_edit !== false;

  function draftOf(row) {
    return drafts[row.material_group_id] ?? {
      order_mode: row.setting?.order_mode ?? "",
      member_order: row.setting?.member_order?.length ? row.setting.member_order : row.members.map((m) => m.material_id),
      effective_from: today,
      remarks: "",
    };
  }
  function setDraft(row, patch) {
    setDrafts((current) => ({ ...current, [row.material_group_id]: { ...draftOf(row), ...patch } }));
  }
  function move(row, index, step) {
    const order = [...draftOf(row).member_order];
    const target = index + step;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setDraft(row, { member_order: order });
  }
  const dirtyIds = Object.keys(drafts).filter((id) => drafts[id].order_mode);

  async function handleSave() {
    setSaving(true);
    try {
      const payload = dirtyIds.map((id) => ({
        material_group_id: id,
        effective_from: drafts[id].effective_from,
        order_mode: drafts[id].order_mode,
        member_order: drafts[id].order_mode === "FIXED_ORDER" ? drafts[id].member_order : [],
        remarks: drafts[id].remarks || null,
      }));
      await saveMtsGroupUsageOrder({ company_id: companyId, rows: payload });
      pushToast({ message: `Saved ${payload.length} group setting(s). Recalculate the Requirement to apply; production uses it from the next Process PO.`, tone: "success" });
      setDrafts({});
      await queryClient.invalidateQueries({ queryKey: ["procurement", "mts-requirement"] });
    } catch (error) {
      pushToast({ message: errorText(error), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-300 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
      >
        <span>Group Settings — which member is used first</span>
        <span className="text-xs text-slate-500">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-slate-200 p-3">
          <p className="text-xs text-slate-600">
            When a Stroke / Pack BOM line can use several members of a group, this decides which one is used first — in the
            Requirement / Planning / Store Report and in MTS production (Process PO auto-pick). No setting = default:
            planning uses <b>Most stock first</b> (Method C); production keeps its own rule (own item first, then the
            alternate with the least stock). Protected stock (Target / Critical of a member's own exclusive use) still applies.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!editable || saving || dirtyIds.length === 0}
              className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : `Save ${dirtyIds.length || ""}`.trim()}
            </button>
            <button
              type="button"
              onClick={() => setDrafts({})}
              disabled={dirtyIds.length === 0 || saving}
              className="h-8 border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Discard changes
            </button>
          </div>
          {groupsQ.isLoading ? <p className="text-xs text-slate-500">Loading…</p> : null}
          {groupsQ.error ? <p className="text-xs text-rose-700">{errorText(groupsQ.error)}</p> : null}
          {!groupsQ.isLoading && rows.length === 0 && !groupsQ.error ? (
            <p className="text-xs text-slate-500">No material groups on this company&apos;s MTS Strokes / Pack BOMs.</p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead className="bg-slate-100 text-left text-slate-700">
                <tr>
                  <th className="border border-slate-200 px-2 py-1">Group</th>
                  <th className="border border-slate-200 px-2 py-1">RM / PM</th>
                  <th className="border border-slate-200 px-2 py-1">Members (unrestricted stock)</th>
                  <th className="border border-slate-200 px-2 py-1">In force now</th>
                  <th className="border border-slate-200 px-2 py-1">Use first</th>
                  <th className="border border-slate-200 px-2 py-1">Effective From</th>
                  <th className="border border-slate-200 px-2 py-1">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const draft = draftOf(row);
                  const dirty = Boolean(drafts[row.material_group_id]?.order_mode);
                  const memberById = new Map(row.members.map((m) => [m.material_id, m]));
                  return (
                    <tr key={row.material_group_id} className={dirty ? "bg-sky-50 align-top" : "align-top"}>
                      <td className="border border-slate-200 px-2 py-1 font-semibold">{row.group_name}</td>
                      <td className="border border-slate-200 px-2 py-1">{row.kind}</td>
                      <td className="border border-slate-200 px-2 py-1">
                        {draft.order_mode === "FIXED_ORDER" ? (
                          <ol className="grid gap-1">
                            {draft.member_order.map((id, index) => (
                              <li key={id} className="flex items-center gap-1">
                                <span className="w-4 text-slate-500">{index + 1}.</span>
                                <span className="flex-1">{memberLabel(memberById.get(id))} ({fmtQty(memberById.get(id)?.unrestricted_stock)})</span>
                                <button type="button" disabled={!editable || index === 0} onClick={() => move(row, index, -1)} className="h-6 w-6 border border-slate-300 bg-white disabled:opacity-40" title="Move up">↑</button>
                                <button type="button" disabled={!editable || index === draft.member_order.length - 1} onClick={() => move(row, index, 1)} className="h-6 w-6 border border-slate-300 bg-white disabled:opacity-40" title="Move down">↓</button>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <ul className="grid gap-0.5">
                            {row.members.map((m) => <li key={m.material_id}>{memberLabel(m)} ({fmtQty(m.unrestricted_stock)} {m.base_uom_code ?? ""})</li>)}
                          </ul>
                        )}
                      </td>
                      <td className="border border-slate-200 px-2 py-1">
                        {row.setting ? (
                          <span>
                            {MODE_LABEL[row.setting.order_mode] ?? row.setting.order_mode} from {row.setting.effective_from}
                            <span className="block text-slate-500">by {row.setting.updated_by}</span>
                          </span>
                        ) : <span className="text-slate-500">Default</span>}
                        {row.future_settings.map((f) => (
                          <span key={f.effective_from} className="block text-amber-700">{MODE_LABEL[f.order_mode] ?? f.order_mode} from {f.effective_from}</span>
                        ))}
                      </td>
                      <td className="border border-slate-200 px-2 py-1">
                        <select
                          className={INPUT}
                          disabled={!editable}
                          value={draft.order_mode}
                          onChange={(event) => setDraft(row, { order_mode: event.target.value })}
                        >
                          {!row.setting ? <option value="">Default (Method C)</option> : null}
                          {Object.entries(MODE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </td>
                      <td className="border border-slate-200 px-2 py-1">
                        <input type="date" className={INPUT} disabled={!editable} value={draft.effective_from} onChange={(event) => setDraft(row, { effective_from: event.target.value })} />
                      </td>
                      <td className="border border-slate-200 px-2 py-1">
                        <input className={`${INPUT} w-48`} disabled={!editable} value={draft.remarks} maxLength={500} onChange={(event) => setDraft(row, { remarks: event.target.value })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
