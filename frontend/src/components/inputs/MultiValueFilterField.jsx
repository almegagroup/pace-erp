import { useEffect, useMemo, useRef, useState } from "react";
import DrawerBase from "../layer/DrawerBase.jsx";

// searchFn-based callers (Batch Number, Packing PO Number) never pass
// `options` at all -- without a stable default, the `options = []`
// destructuring default below would create a BRAND NEW empty array on every
// render, and `options` is one of the debounced search effect's own
// dependencies. A fresh array reference every render re-triggers that
// effect (and fires a new search request) on every unrelated parent
// re-render, not just when the user types -- this was the picker-drawer
// flicker reported live 2026-08-11, still happening after stabilizing
// searchFn alone. Confirmed via a Network-tab capture showing 20+ repeated
// fetches to the same search endpoint with no typing in between.
const EMPTY_OPTIONS = [];

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
  value = EMPTY_OPTIONS,
  onChange,
  options = EMPTY_OPTIONS,
  searchFn,
  disabled = false,
  // Options-branch (no searchFn) callers back this field with a react-query
  // result the caller owns (e.g. useMaterialOptionsQuery) -- if THAT query
  // failed, this component previously had no way to know and just rendered
  // "No matching values.", identical to a genuinely-empty result. Pass the
  // query's error message here so a real fetch failure is distinguishable
  // from an empty list (found live 2026-08-11 while investigating IN02/IN03's
  // Material picker showing empty with no diagnosable signal).
  loadError = "",
}) {
  const [open, setOpen] = useState(false);
  const [draftValues, setDraftValues] = useState(value);
  const [inputValue, setInputValue] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  // business owner, 2026-09-26: this drawer used to clear the search text
  // the moment an item was added (addEntries below), which also wiped out
  // the filter itself -- since searchResults is keyed off inputValue, that
  // silently reverted the list back to its unfiltered/default state. A
  // user searching "DYN" to multi-select several DYN materials had to
  // retype "DYN" from scratch after every single pick. Fixed by leaving
  // inputValue alone on add -- the filtered list now stays put across
  // picks, and only clears when the user themselves edits/clears the box
  // (matching how ErpComboboxField's own highlightIndex keyboard-nav
  // pattern works, mirrored below for Arrow/Enter support here too).
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

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

  // Keep highlightIndex in bounds when the filtered list changes (mirrors
  // ErpComboboxField's own pattern).
  useEffect(() => {
    setHighlightIndex((prev) => Math.min(prev, Math.max(searchResults.length - 1, 0)));
  }, [searchResults.length]);

  // Scroll the keyboard-highlighted row into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-multi-filter-item]");
    items[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  function addEntries(entries) {
    const next = new Map(selectedMap);
    entries.map(normalizeOption).filter(Boolean).forEach((entry) => {
      next.set(entry.value, entry);
    });
    setDraftValues([...next.values()]);
    // inputValue is deliberately left as-is -- see the comment on its
    // declaration above.
  }

  function handleInputKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = searchResults[highlightIndex];
      if (entry && !selectedMap.has(entry.value)) {
        addEntries([entry]);
      }
    }
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
              onChange={(event) => { setInputValue(event.target.value); setHighlightIndex(0); }}
              onKeyDown={handleInputKeyDown}
              onPaste={handlePaste}
              placeholder="Type to search, or paste newline/comma/tab-separated values — Up/Down to browse, Enter to add"
              className="min-h-10 border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
            {searchError ? (
              <div className="text-xs text-rose-700">{searchError}</div>
            ) : loadError ? (
              <div className="text-xs text-rose-700">Failed to load options: {loadError}</div>
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
            <div ref={listRef} className="max-h-72 overflow-auto border border-slate-200 bg-white">
              {loading ? (
                <div className="px-3 py-4 text-sm text-slate-500">Searching…</div>
              ) : searchResults.length === 0 ? (
                <div className="px-3 py-4 text-sm text-slate-500">
                  {loadError ? "Unable to load options — see error above." : "No matching values."}
                </div>
              ) : (
                searchResults.map((entry, index) => {
                  const selected = selectedMap.has(entry.value);
                  const highlighted = index === highlightIndex;
                  return (
                    <button
                      key={entry.value}
                      type="button"
                      data-multi-filter-item
                      onClick={() => addEntries([entry])}
                      onMouseEnter={() => setHighlightIndex(index)}
                      disabled={selected}
                      className={`flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-900 last:border-b-0 disabled:bg-slate-50 disabled:text-slate-400 ${highlighted && !selected ? "bg-sky-50" : ""}`}
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
