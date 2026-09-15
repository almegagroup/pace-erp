import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DrawerBase from "../layer/DrawerBase.jsx";
import { openActionConfirm } from "../../store/actionConfirm.js";
import {
  activateCommunicationRule,
  deactivateCommunicationRule,
  getCommunicationConfiguration,
  getCommunicationRule,
  saveCommunicationRule,
} from "../../communication/communicationRuntimeApi.js";

const RECIPIENT_TYPES = ["TO", "CC", "BCC"];
const SECTION = "grid gap-3 border-b border-slate-200 pb-5";
const LABEL = "grid gap-1 text-xs font-medium text-slate-700";
const INPUT = "h-9 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-600";

function copy(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

function reindex(rows) {
  return rows.map((row, index) => ({ ...row, display_order: index + 1 }));
}

function channelLabel(channel) {
  return String(channel || "").toUpperCase() === "EMAIL" ? "Email" : String(channel || "");
}

function newRule(configuration) {
  const dataset = configuration?.datasets?.[0] || null;
  return {
    id: null,
    rule_name: "",
    status: "DRAFT",
    dataset_key: dataset?.dataset_key || null,
    subject_template: "",
    schedule_kind: "MANUAL",
    schedule_time: null,
    schedule_timezone: configuration?.timezones?.[0] || "Asia/Kolkata",
    weekly_days: [],
    monthly_day: null,
    skip_empty: configuration?.skip_empty_default !== false,
    version_no: null,
    recipients: [],
    columns: reindex((dataset?.default_display_field_keys || []).map((field_key) => ({ field_key }))),
  };
}

function makePayload(rule) {
  return {
    id: rule.id || null,
    rule_name: rule.rule_name,
    dataset_key: rule.dataset_key || null,
    subject_template: rule.subject_template || "",
    schedule_kind: rule.schedule_kind,
    schedule_time: rule.schedule_time || null,
    schedule_timezone: rule.schedule_timezone || "Asia/Kolkata",
    weekly_days: rule.weekly_days || [],
    monthly_day: rule.monthly_day || null,
    skip_empty: rule.skip_empty !== false,
    version_no: rule.version_no || null,
    recipients: reindex(rule.recipients || []),
    columns: reindex(rule.columns || []),
  };
}

function getContext(metadata, companyId) {
  return {
    txCode: metadata?.page?.tx_code,
    resourceCode: metadata?.page?.resource_code,
    surfaceKey: metadata?.surface?.key,
    companyId,
    channel: metadata?.channel || "EMAIL",
  };
}

export default function AutomationSettingsDrawer({
  visible,
  metadata,
  companyId,
  contextKey,
  onClose,
  onDirtyChange,
}) {
  const canShow = visible === true && metadata?.visible === true;
  const input = getContext(metadata, companyId);
  const [selectedRuleId, setSelectedRuleId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [loadingRule, setLoadingRule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const configuration = useQuery({
    queryKey: ["communication", "configuration", contextKey || "", input.companyId || ""],
    enabled: canShow && Boolean(input.txCode && input.resourceCode && input.surfaceKey && input.companyId),
    queryFn: () => getCommunicationConfiguration(input),
    staleTime: 0,
  });

  useEffect(() => {
    setSelectedRuleId(null);
    setEditor(null);
    setDirty(false);
    setMessage("");
    setError("");
  }, [contextKey]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const datasets = configuration.data?.datasets || [];
  const selectedDataset = datasets.find((dataset) => dataset.dataset_key === editor?.dataset_key) || null;
  const noDataset = configuration.isSuccess && datasets.length === 0;
  const summaries = configuration.data?.rules || [];

  function change(updater) {
    setEditor((current) => updater(copy(current)));
    setDirty(true);
    setMessage("");
    setError("");
  }

  async function confirmDiscard(title, text) {
    if (!dirty) return true;
    return await openActionConfirm({
      eyebrow: "Automation Settings",
      title,
      message: text,
      confirmLabel: "Discard Changes",
      cancelLabel: "Keep Editing",
    });
  }

  async function loadRule(ruleId) {
    setLoadingRule(true);
    setError("");
    try {
      const result = await getCommunicationRule({ ...input, ruleId });
      setSelectedRuleId(ruleId);
      setEditor(copy(result.rule));
      setDirty(false);
    } catch (loadError) {
      setError(loadError.message || "Unable to load this automation rule.");
    } finally {
      setLoadingRule(false);
    }
  }

  async function selectRule(ruleId) {
    if (!ruleId || ruleId === selectedRuleId) return;
    if (!await confirmDiscard("Discard unsaved rule changes?", "The current rule has unsaved changes.")) return;
    await loadRule(ruleId);
  }

  async function createRule() {
    if (!await confirmDiscard("Discard unsaved rule changes?", "The current rule has unsaved changes.")) return;
    setSelectedRuleId(null);
    setEditor(newRule(configuration.data));
    setDirty(false);
    setMessage("");
    setError("");
  }

  async function requestClose() {
    if (!await confirmDiscard("Discard unsaved rule changes?", "This automation rule has unsaved changes.")) return;
    onClose?.();
  }

  async function persist(action) {
    if (!editor) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      // "SAVE" never carries a target status: a new rule is created DRAFT and
      // an existing rule keeps whatever status it already has. Only
      // "ACTIVATE" (below) and Deactivate may change lifecycle status.
      const result = action === "ACTIVATE"
        ? await activateCommunicationRule({ ...input, rule: makePayload(editor) })
        : await saveCommunicationRule({ ...input, rule: makePayload(editor) });
      setEditor(copy(result.rule));
      setSelectedRuleId(result.rule.id);
      setDirty(false);
      setMessage(action === "ACTIVATE" ? "Rule activated." : "Saved.");
      await configuration.refetch();
    } catch (saveError) {
      setError(saveError.code === "COMMUNICATION_RULE_VERSION_CONFLICT"
        ? "This rule changed in another session. Reload it before saving."
        : (saveError.message || "Unable to save this rule."));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!editor?.id) return;
    const approved = await openActionConfirm({
      eyebrow: "Automation Settings",
      title: "Deactivate this rule?",
      message: "The rule remains saved, but it will not be eligible for future scheduling.",
      confirmLabel: "Deactivate",
      cancelLabel: "Cancel",
    });
    if (!approved) return;
    setSaving(true);
    setError("");
    try {
      const result = await deactivateCommunicationRule({ ...input, rule_id: editor.id, version_no: editor.version_no });
      setEditor(copy(result.rule));
      setDirty(false);
      setMessage("Rule deactivated.");
      await configuration.refetch();
    } catch (saveError) {
      setError(saveError.code === "COMMUNICATION_RULE_VERSION_CONFLICT"
        ? "This rule changed in another session. Reload it before deactivating."
        : (saveError.message || "Unable to deactivate this rule."));
    } finally {
      setSaving(false);
    }
  }

  function chooseDataset(datasetKey) {
    const dataset = datasets.find((item) => item.dataset_key === datasetKey) || null;
    change((current) => ({
      ...current,
      dataset_key: dataset?.dataset_key || null,
      columns: reindex((dataset?.default_display_field_keys || []).map((field_key) => ({ field_key }))),
    }));
  }

  function toggleColumn(fieldKey) {
    change((current) => {
      const included = current.columns.some((column) => column.field_key === fieldKey);
      const columns = included
        ? current.columns.filter((column) => column.field_key !== fieldKey)
        : [...current.columns, { field_key: fieldKey }];
      return { ...current, columns: reindex(columns) };
    });
  }

  function moveColumn(fieldKey, direction) {
    change((current) => {
      const index = current.columns.findIndex((column) => column.field_key === fieldKey);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.columns.length) return current;
      const columns = [...current.columns];
      [columns[index], columns[nextIndex]] = [columns[nextIndex], columns[index]];
      return { ...current, columns: reindex(columns) };
    });
  }

  function addRecipient() {
    change((current) => ({ ...current, recipients: reindex([
      ...current.recipients,
      { recipient_type: "TO", email: "", active: true },
    ]) }));
  }

  function updateRecipient(index, patch) {
    change((current) => ({
      ...current,
      recipients: current.recipients.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row),
    }));
  }

  function removeRecipient(index) {
    change((current) => ({
      ...current,
      recipients: reindex(current.recipients.filter((_row, rowIndex) => rowIndex !== index)),
    }));
  }

  function selectSchedule(scheduleKind) {
    change((current) => ({
      ...current,
      schedule_kind: scheduleKind,
      schedule_time: scheduleKind === "MANUAL" ? null : current.schedule_time,
      weekly_days: scheduleKind === "WEEKLY" ? current.weekly_days : [],
      monthly_day: scheduleKind === "MONTHLY" ? current.monthly_day : null,
    }));
  }

  function toggleWeekday(day) {
    change((current) => ({
      ...current,
      weekly_days: current.weekly_days.includes(day)
        ? current.weekly_days.filter((item) => item !== day)
        : [...current.weekly_days, day].sort((left, right) => left - right),
    }));
  }

  return (
    <DrawerBase
      visible={canShow}
      side="center"
      width="min(840px, calc(100vw - 24px))"
      title="Automation Settings"
      onEscape={requestClose}
      onClose={requestClose}
      actions={(
        <>
          {editor && !noDataset ? <>
            {/* Actions match status exactly -- a normal Save never offers a
                path back to DRAFT for an ACTIVE/INACTIVE rule, and Activate
                only appears where activation is actually the next step. */}
            <button type="button" onClick={() => void persist("SAVE")} disabled={saving} className="border border-slate-400 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 disabled:opacity-50">{editor.status === "ACTIVE" || editor.status === "INACTIVE" ? "Save" : "Save Draft"}</button>
            {editor.status !== "ACTIVE" ? <button type="button" onClick={() => void persist("ACTIVATE")} disabled={saving} className="border border-emerald-700 bg-emerald-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-950 disabled:opacity-50">Activate</button> : null}
            {editor.id && editor.status === "ACTIVE" ? <button type="button" onClick={() => void deactivate()} disabled={saving} className="border border-amber-700 bg-amber-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-950 disabled:opacity-50">Deactivate</button> : null}
          </> : null}
          <button type="button" onClick={() => void requestClose()} className="border border-slate-400 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">Close</button>
        </>
      )}
    >
      <div className="grid gap-5 text-sm">
        <dl className="grid gap-3 border-b border-slate-200 pb-4 sm:grid-cols-3">
          <div className="grid gap-1"><dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Page</dt><dd className="font-semibold text-slate-900">{metadata?.page?.tx_code} — {metadata?.page?.title}</dd></div>
          <div className="grid gap-1"><dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Surface</dt><dd className="font-semibold text-slate-900">{metadata?.surface?.label}</dd></div>
          <div className="grid gap-1"><dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Channel</dt><dd className="font-semibold text-slate-900">{channelLabel(metadata?.channel)}</dd></div>
        </dl>

        {configuration.isLoading || loadingRule ? <p className="text-sm text-slate-600">Loading automation configuration…</p> : null}
        {configuration.isError ? <p className="border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{configuration.error?.message || "Unable to load automation configuration."}</p> : null}
        {error ? <p className="border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
        {message ? <p className="border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
        {noDataset ? <p className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">No automation dataset is available for this surface.</p> : null}

        {configuration.isSuccess && !noDataset ? <>
          <section className={SECTION}>
            <div className="flex flex-wrap items-end gap-3">
              <label className={`${LABEL} min-w-[260px] flex-1`}><span>Rule</span><select value={selectedRuleId || ""} onChange={(event) => void selectRule(event.target.value)} className={INPUT}><option value="">{editor?.id ? "Select another rule" : "Select a saved rule"}</option>{summaries.map((rule) => <option key={rule.id} value={rule.id}>{rule.rule_name} — {rule.status}</option>)}</select></label>
              <button type="button" onClick={() => void createRule()} className="h-9 border border-sky-700 bg-sky-100 px-3 text-xs font-semibold uppercase tracking-wide text-sky-950">New Rule</button>
            </div>
            {!editor ? <p className="text-xs text-slate-600">Select a saved rule or create a new rule.</p> : null}
          </section>

          {editor ? <>
            <section className={SECTION}>
              <h3 className="text-sm font-semibold text-slate-900">General</h3>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_120px]">
                <label className={LABEL}><span>Rule Name</span><input value={editor.rule_name} onChange={(event) => change((current) => ({ ...current, rule_name: event.target.value }))} className={INPUT} maxLength="160" /></label>
                <label className={LABEL}><span>Status</span><input value={editor.status || "DRAFT"} readOnly className={`${INPUT} bg-slate-100`} /></label>
                <label className={LABEL}><span>Channel</span><input value="Email" readOnly className={`${INPUT} bg-slate-100`} /></label>
              </div>
            </section>

            <section className={SECTION}>
              <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">Recipients</h3><button type="button" onClick={addRecipient} className="border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">Add Recipient</button></div>
              {editor.recipients.length === 0 ? <p className="text-xs text-slate-600">Add at least one active TO recipient before activating.</p> : null}
              <div className="grid gap-2">{editor.recipients.map((recipient, index) => <div key={`${recipient.display_order}-${index}`} className="grid gap-2 sm:grid-cols-[100px_minmax(0,1fr)_94px_auto]">
                <select value={recipient.recipient_type} onChange={(event) => updateRecipient(index, { recipient_type: event.target.value })} className={INPUT}>{RECIPIENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                <input type="email" value={recipient.email} onChange={(event) => updateRecipient(index, { email: event.target.value })} placeholder="name@example.com" className={INPUT} />
                <label className="flex h-9 items-center gap-2 border border-slate-300 bg-white px-2 text-xs text-slate-700"><input type="checkbox" checked={recipient.active !== false} onChange={(event) => updateRecipient(index, { active: event.target.checked })} />Active</label>
                <button type="button" onClick={() => removeRecipient(index)} className="border border-rose-300 bg-rose-50 px-2 text-xs font-semibold text-rose-800">Remove</button>
              </div>)}</div>
            </section>

            <section className={SECTION}>
              <h3 className="text-sm font-semibold text-slate-900">Subject</h3>
              <label className={LABEL}><span>Plain-text subject</span><input value={editor.subject_template} onChange={(event) => change((current) => ({ ...current, subject_template: event.target.value }))} className={INPUT} maxLength="500" placeholder="{{company_name}} Planning Alert — {{date}}" /></label>
              <p className="text-[11px] text-slate-500">Allowed tokens: {configuration.data.subject_tokens.join(", ")}</p>
            </section>

            <section className={SECTION}>
              <h3 className="text-sm font-semibold text-slate-900">Schedule</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className={LABEL}><span>Schedule</span><select value={editor.schedule_kind} onChange={(event) => selectSchedule(event.target.value)} className={INPUT}><option value="MANUAL">Manual Only</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label>
                {editor.schedule_kind !== "MANUAL" ? <label className={LABEL}><span>Time</span><input type="time" value={editor.schedule_time || ""} onChange={(event) => change((current) => ({ ...current, schedule_time: event.target.value || null }))} className={INPUT} /></label> : null}
                <label className={LABEL}><span>Timezone</span><select value={editor.schedule_timezone} onChange={(event) => change((current) => ({ ...current, schedule_timezone: event.target.value }))} className={INPUT}>{configuration.data.timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></label>
                {editor.schedule_kind === "MONTHLY" ? <label className={LABEL}><span>Day of Month</span><input type="number" min="1" max="31" value={editor.monthly_day || ""} onChange={(event) => change((current) => ({ ...current, monthly_day: event.target.value ? Number(event.target.value) : null }))} className={INPUT} /></label> : null}
                <label className="flex h-9 items-center gap-2 self-end border border-slate-300 bg-white px-2 text-xs text-slate-700"><input type="checkbox" checked={editor.skip_empty !== false} onChange={(event) => change((current) => ({ ...current, skip_empty: event.target.checked }))} />Skip when output is empty</label>
              </div>
              {editor.schedule_kind === "WEEKLY" ? <div className="flex flex-wrap gap-2">{[[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]].map(([day, label]) => <label key={day} className="flex items-center gap-1 border border-slate-300 bg-white px-2 py-1 text-xs"><input type="checkbox" checked={editor.weekly_days.includes(day)} onChange={() => toggleWeekday(day)} />{label}</label>)}</div> : null}
            </section>

            <section className={SECTION}>
              <h3 className="text-sm font-semibold text-slate-900">Dataset</h3>
              <label className={`${LABEL} max-w-lg`}><span>Report Manifest dataset</span><select value={editor.dataset_key || ""} onChange={(event) => chooseDataset(event.target.value)} className={INPUT}><option value="">Select dataset</option>{datasets.map((dataset) => <option key={dataset.dataset_key} value={dataset.dataset_key}>{dataset.label}</option>)}</select></label>
              {selectedDataset?.description ? <p className="text-xs text-slate-600">{selectedDataset.description}</p> : null}
            </section>

            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-slate-900">Columns</h3>
              {!selectedDataset ? <p className="text-xs text-slate-600">Select a dataset to choose display columns.</p> : <div className="grid gap-2">{selectedDataset.fields.map((field) => {
                const index = editor.columns.findIndex((column) => column.field_key === field.field_key);
                const selected = index >= 0;
                return <div key={field.field_key} className="grid items-center gap-2 border border-slate-200 bg-white p-2 sm:grid-cols-[minmax(0,1fr)_110px_auto_auto]"><label className="flex items-center gap-2 text-xs font-medium text-slate-800"><input type="checkbox" checked={selected} onChange={() => toggleColumn(field.field_key)} />{field.label}</label><span className="text-[11px] text-slate-500">{field.data_type}</span>{selected ? <button type="button" onClick={() => moveColumn(field.field_key, -1)} disabled={index === 0} className="border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">Up</button> : null}{selected ? <button type="button" onClick={() => moveColumn(field.field_key, 1)} disabled={index === editor.columns.length - 1} className="border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">Down</button> : null}</div>;
              })}</div>}
            </section>
          </> : null}
        </> : null}
      </div>
    </DrawerBase>
  );
}
