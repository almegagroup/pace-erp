/*
 * PIDNumberEntryStep — shared "Page 1" for MI04/MI05's standalone entry (§MI04-MI05-sidebar-
 * restore). SAP's MI04/MI05 transaction codes open blank and ask for the document number
 * directly, rather than requiring the user to already be on a specific document — this mirrors
 * that (same visual convention as ProductionPOCreatePage.jsx's Page 1/Page 2 stepper).
 */
import { useState } from "react";
import { resolvePIDByNumber } from "../procurementApi.js";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

export default function PIDNumberEntryStep({ heading, helperText, onResolved, extraValidate }) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);

  async function handleLoad() {
    const documentNumber = value.trim();
    if (!documentNumber) {
      setError("Enter a PID number.");
      return;
    }
    setLoading(true);
    setError("");
    setPreview(null);
    try {
      const doc = await resolvePIDByNumber(documentNumber);
      const validationError = extraValidate ? extraValidate(doc) : null;
      if (validationError) {
        setError(validationError);
        return;
      }
      setPreview(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not look up this PID number.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Page 1</p>
        <h3 className="text-lg font-semibold text-slate-900">{heading}</h3>
        {helperText ? <p className="mt-1 text-sm text-slate-600">{helperText}</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-600">
          PID Number <span className="text-rose-500">*</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setPreview(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleLoad();
            }}
            placeholder="e.g. PI0000123"
            className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => void handleLoad()}
            disabled={loading}
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</div>
      ) : null}

      {preview ? (
        <>
          <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Company <b>{preview.company_code || preview.company_name || "—"}</b> · Count date{" "}
            <b>{formatDate(preview.count_date)}</b>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => onResolved(preview)}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
            >
              Continue
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
