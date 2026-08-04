import { useEffect, useMemo, useRef, useState } from "react";
import DrawerBase from "../layer/DrawerBase.jsx";

function splitPastedValues(rawValue) {
  return String(rawValue || "")
    .split(/[\n,\t]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOption(option) {
  if (!option || typeof option !== "object") {
    return null;
  }
  const value = String(option.value ?? "").trim();
  if (!value) {
    return null;
  }
  return {
    value,
    label: String(option.label ?? value).trim() || value,
  };
}

export default function MultiValueFilterField({
  label,
  placeholder = "Select values",
  value = [],
  onChange,
  options = [],
  searchFn,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [draftValues, setDraftValues] = useState(value);
  const [inputValue, setInputValue] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setDraftValues(value);
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const trimmed = inputValue.trim();
    const timer = window.setTimeout(async () => {
      if (typeof searchFn !== "function") {
        const normalizedOptions = options
          .map(normalizeOption)
          .filter(Boolean)
          .filter((option) => !trimmed || option.label.toLowerCase().includes(trimmed.toLowerCase()) || option.value.toLowerCase().includes(trimmed.toLowerCase()));
        setSearchResults(normalizedOptions);
        setSearchError("");
        return;
      }
      setLoading(true);
      setSearchError("");
      try {
        const remoteOptions = await searchFn(trimmed);
        setSearchResults((Array.isArray(remoteOptions) ? remoteOptions : []).map(normalizeOption).filter(Boolean));
      } catch (error) {
        setSearchResults([]);
        setSearchError(error instanceof Error ? error.message : "Search failed");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [inputValue, open, options, searchFn]);

  const selectedMap = useMemo(
    () => new Map((draftValues ?? []).map((entry) => [String(entry.value), entry])),
    [draftValues],
  );

  function addEntries(entries) {
    const next = new Map(selectedMap);
    entries.map(normalizeOption).filter(Boolean).forEach((entry) => {
      next.set(entry.value, entry);
    });
    setDraftValues([...next.values()]);
    setInputValue("");
  }

  function handlePaste(event) {
    const pastedText = event.clipboardData?.getData("text") ?? "";
    const tokens = splitPastedValues(pastedText);
    if (tokens.length <= 1) {
      return;
    }
    event.preventDefault();
    addEntries(tokens.map((token) => ({ value: token, label: token })));
  }

  function removeValue(targetValue) {
    setDraftValues((current) => current.filter((entry) => entry.value !== targetValue));
  }

  function confirmSelection() {
    onChange?.(draftValues);
    setOpen(false);
  }

  const summaryText = value.length > 0 ? `${value.length} values selected` : placeholder;

  return (
    <>
      <label className="grid gap-1 text-sm text-slate-700">
        <span className="font-medium text-slate-800">{label}</span>
        <button
          type="button"
          onClick={() => !disabled && setOpen(true)}
          disabled={disabled}
          className="min-h-9 border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        >
          {summaryText}
        </button>
      </label>

      <DrawerBase
        visible={open}
        title={`Select ${label}`}
        onClose={() => setOpen(false)}
        onEscape={() => setOpen(false)}
        initialFocusRef={inputRef}
        width="min(620px, calc(100vw - 24px))"
        actions={(
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmSelection}
              className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950"
            >
              Confirm
            </button>
          </>
        )}
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onPaste={handlePaste}
              placeholder="Type to search, or paste newline/comma/tab-separated values"
              className="min-h-10 border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
            {searchError ? (
              <div className="text-xs text-rose-700">{searchError}</div>
            ) : null}
          </div>

          <div className="grid gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              Selected
            </div>
            {draftValues.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                No values selected yet.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {draftValues.map((entry) => (
                  <span
                    key={entry.value}
                    className="inline-flex items-center gap-2 border border-sky-200 bg-sky-50 px-3 py-1 text-sm text-sky-950"
                  >
                    <span>{entry.label}</span>
                    <button
                      type="button"
                      onClick={() => removeValue(entry.value)}
                      className="text-xs font-semibold uppercase tracking-[0.08em] text-sky-700"
                    >
                      Remove
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              Search Results
            </div>
            <div className="max-h-72 overflow-auto border border-slate-200 bg-white">
              {loading ? (
                <div className="px-3 py-4 text-sm text-slate-500">Searching…</div>
              ) : searchResults.length === 0 ? (
                <div className="px-3 py-4 text-sm text-slate-500">No matching values.</div>
              ) : (
                searchResults.map((entry) => {
                  const selected = selectedMap.has(entry.value);
                  return (
                    <button
                      key={entry.value}
                      type="button"
                      onClick={() => addEntries([entry])}
                      disabled={selected}
                      className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-900 last:border-b-0 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <span>{entry.label}</span>
                      <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
                        {selected ? "Selected" : "Add"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </DrawerBase>
    </>
  );
}
