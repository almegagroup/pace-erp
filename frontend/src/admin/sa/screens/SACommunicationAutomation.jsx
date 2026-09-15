/*
 * Communication Automation — Phase 2 central enrollment control.
 *
 * This screen intentionally configures page/surface enrollment only.  It
 * neither renders a PO11 action nor creates rules, recipients, providers,
 * schedules, or delivery work.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { pushToast } from "../../../store/uiToast.js";
import {
  getCommunicationEnrollment,
  saveCommunicationEnrollment,
  searchCommunicationPages,
} from "./communicationAdminApi.js";

const SEARCH_DEBOUNCE_MS = 300;

function asSelectedSurfaceKeys(state) {
  return (state?.surfaces ?? [])
    .filter((surface) => surface?.selected === true)
    .map((surface) => surface.key)
    .filter(Boolean)
    .sort();
}

function createDraft(state) {
  return {
    emailEnabled: state?.page?.email_enabled === true,
    surfaceKeys: asSelectedSurfaceKeys(state),
  };
}

function sameKeys(left, right) {
  const normalizedLeft = [...new Set(left ?? [])].sort();
  const normalizedRight = [...new Set(right ?? [])].sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((key, index) => key === normalizedRight[index]);
}

function communicationStatusLabel(row) {
  return row?.communication_capable === true
    ? "Communication Ready"
    : "Not communication-ready";
}

function formatPageIdentity(page) {
  const txCode = page?.tx_code ?? page?.menu_code ?? "PACE Page";
  return page?.title ? `${txCode} — ${page.title}` : txCode;
}

function formatError(error, fallback) {
  if (error?.code === "ADMIN_ONLY") {
    return "Administrator access is required for Communication Automation.";
  }
  return error?.message || fallback;
}

function StatusBadge({ tone, children }) {
  const toneClass = tone === "ready"
    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
    : tone === "enlisted"
      ? "border-sky-300 bg-sky-50 text-sky-800"
      : "border-slate-300 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.12em] ${toneClass}`}>
      {children}
    </span>
  );
}

export default function SACommunicationAutomation() {
  const searchInputRef = useRef(null);
  const searchRequestRef = useRef(0);
  const [searchText, setSearchText] = useState("");
  const [searchRows, setSearchRows] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchRefreshNonce, setSearchRefreshNonce] = useState(0);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canonicalState, setCanonicalState] = useState(null);
  const [draft, setDraft] = useState({ emailEnabled: false, surfaceKeys: [] });

  const trimmedSearch = searchText.trim();
  const canonicalDraft = useMemo(() => createDraft(canonicalState), [canonicalState]);
  const dirty = Boolean(canonicalState) && (
    draft.emailEnabled !== canonicalDraft.emailEnabled
    || !sameKeys(draft.surfaceKeys, canonicalDraft.surfaceKeys)
  );
  const selectedPage = canonicalState?.page ?? null;

  const updateGridEnrollment = useCallback((pageMenuId, enlisted) => {
    setSearchRows((rows) => rows.map((row) => (
      row.page_menu_id === pageMenuId ? { ...row, enlisted } : row
    )));
  }, []);

  const applyCanonicalState = useCallback((state) => {
    setCanonicalState(state);
    setDraft(createDraft(state));
    setSelectedPageId(state?.page?.page_menu_id ?? "");
    if (state?.page?.page_menu_id) {
      updateGridEnrollment(state.page.page_menu_id, state.page.enlisted === true);
    }
  }, [updateGridEnrollment]);

  useEffect(() => {
    if (!trimmedSearch) {
      setSearchRows([]);
      setSearching(false);
      setSearchError("");
      return undefined;
    }

    const requestNumber = searchRequestRef.current + 1;
    searchRequestRef.current = requestNumber;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        setSearchError("");
        try {
          const data = await searchCommunicationPages(trimmedSearch);
          if (searchRequestRef.current === requestNumber) {
            setSearchRows(Array.isArray(data?.pages) ? data.pages : []);
          }
        } catch (error) {
          if (searchRequestRef.current === requestNumber) {
            const message = formatError(error, "Unable to search PACE pages.");
            setSearchRows([]);
            setSearchError(message);
            pushToast({ message, tone: "error" });
          }
        } finally {
          if (searchRequestRef.current === requestNumber) {
            setSearching(false);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [trimmedSearch, searchRefreshNonce]);

  const loadEnrollment = useCallback(async (pageMenuId) => {
    setDrawerLoading(true);
    try {
      const state = await getCommunicationEnrollment(pageMenuId);
      applyCanonicalState(state);
      return true;
    } catch (error) {
      const message = formatError(error, "Unable to load communication settings.");
      pushToast({ message, tone: "error" });
      return false;
    } finally {
      setDrawerLoading(false);
    }
  }, [applyCanonicalState]);

  const confirmDiscardChanges = useCallback(async () => {
    if (saving) return false;
    if (!dirty) return true;

    const approved = await openActionConfirm({
      eyebrow: "Communication Automation",
      title: "Discard Unsaved Changes",
      message: "You have unsaved changes. Discard them?",
      confirmLabel: "Discard",
      cancelLabel: "Keep Editing",
    });
    if (!approved) return false;

    setDraft(canonicalDraft);
    return true;
  }, [canonicalDraft, dirty, saving]);

  const requestCloseDrawer = useCallback(async () => {
    if (!await confirmDiscardChanges()) return false;
    setDrawerOpen(false);
    return true;
  }, [confirmDiscardChanges]);

  const selectPage = useCallback(async (row) => {
    if (row.communication_capable !== true) {
      pushToast({
        message: `${formatPageIdentity(row)} is not communication-ready and cannot be enlisted.`,
        tone: "info",
      });
      return;
    }

    if (drawerOpen && !await confirmDiscardChanges()) {
      return;
    }

    const hadCanonicalPage = Boolean(canonicalState?.page?.page_menu_id);
    setDrawerOpen(true);
    const loaded = await loadEnrollment(row.page_menu_id);
    if (!loaded && !hadCanonicalPage) {
      setDrawerOpen(false);
    }
  }, [canonicalState?.page?.page_menu_id, confirmDiscardChanges, drawerOpen, loadEnrollment]);

  const { getRowProps } = useErpListNavigation(searchRows, {
    onActivate: (row) => void selectPage(row),
  });

  const toggleSurface = useCallback((surfaceKey) => {
    setDraft((current) => ({
      ...current,
      surfaceKeys: current.surfaceKeys.includes(surfaceKey)
        ? current.surfaceKeys.filter((key) => key !== surfaceKey)
        : [...current.surfaceKeys, surfaceKey].sort(),
    }));
  }, []);

  const refreshCanonicalState = useCallback(async (pageMenuId) => {
    const refreshed = await getCommunicationEnrollment(pageMenuId);
    applyCanonicalState(refreshed);
    return refreshed;
  }, [applyCanonicalState]);

  const saveEnrollment = useCallback(async () => {
    if (!selectedPage || saving || draft.surfaceKeys.length === 0) return;

    setSaving(true);
    try {
      await saveCommunicationEnrollment({
        page_menu_id: selectedPage.page_menu_id,
        email_enabled: draft.emailEnabled,
        active: true,
        surface_keys: draft.surfaceKeys,
      });
      await refreshCanonicalState(selectedPage.page_menu_id);
      pushToast({ message: "Communication settings saved", tone: "success" });
    } catch (error) {
      pushToast({
        message: formatError(error, "Unable to save communication settings"),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }, [draft.emailEnabled, draft.surfaceKeys, refreshCanonicalState, saving, selectedPage]);

  const deEnlist = useCallback(async () => {
    if (!selectedPage || saving || selectedPage.enlisted !== true) return;

    const approved = await openActionConfirm({
      eyebrow: "Communication Automation",
      title: "De-enlist This Page",
      message: "Disable Communication Automation for this page? Existing historical records will remain.",
      confirmLabel: "De-enlist",
      cancelLabel: "Cancel",
    });
    if (!approved) return;

    setSaving(true);
    try {
      await saveCommunicationEnrollment({
        page_menu_id: selectedPage.page_menu_id,
        email_enabled: false,
        active: false,
        surface_keys: [],
      });
      await refreshCanonicalState(selectedPage.page_menu_id);
      pushToast({ message: "Page de-enlisted", tone: "success" });
    } catch (error) {
      pushToast({
        message: formatError(error, "Unable to de-enlist this page"),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }, [refreshCanonicalState, saving, selectedPage]);

  useErpScreenCommands([
    {
      id: "communication-automation-focus-search",
      group: "Current Screen",
      label: "Focus page search",
      keywords: ["communication", "automation", "search", "tx code", "page name"],
      perform: () => searchInputRef.current?.focus(),
      order: 10,
    },
    {
      id: "communication-automation-refresh-search",
      group: "Current Screen",
      label: "Refresh page search",
      keywords: ["communication", "automation", "refresh"],
      disabled: !trimmedSearch || searching,
      perform: () => setSearchRefreshNonce((value) => value + 1),
      order: 20,
    },
  ]);

  useErpScreenHotkeys({
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
    },
    refresh: {
      disabled: !trimmedSearch || searching,
      perform: () => setSearchRefreshNonce((value) => value + 1),
    },
    save: {
      disabled: !drawerOpen || !dirty || saving || draft.surfaceKeys.length === 0,
      perform: () => void saveEnrollment(),
    },
  });

  const drawerTitle = selectedPage ? formatPageIdentity(selectedPage) : "Communication Automation";

  return (
    <ErpScreenScaffold
      eyebrow="Administration"
      title="Communication Automation"
      actions={[
        {
          key: "communication-focus-search",
          label: "Search Pages",
          hint: "Alt+Shift+F",
          tone: "primary",
          onClick: () => searchInputRef.current?.focus(),
        },
      ]}
      footerHints={["↑↓ Navigate", "Enter Configure", "F8 Refresh", "Alt+Shift+F Search", "Ctrl+S Save", "Esc Back", "Ctrl+K Command Bar"]}
    >
      <ErpSectionCard
        eyebrow="Search"
        title="PACE Page Search"
        aside={trimmedSearch && !searching ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {searchRows.length} result{searchRows.length === 1 ? "" : "s"}
          </span>
        ) : null}
      >
        <QuickFilterInput
          label="Search TX Code or Page Name"
          value={searchText}
          onChange={setSearchText}
          inputRef={searchInputRef}
          primaryFocus
          placeholder="PO11 or Procurement Planning"
          hint="Searches the existing PACE page catalog. Select a communication-ready page to configure it."
        />
      </ErpSectionCard>

      {!trimmedSearch ? (
        <ErpSectionCard>
          <p className="text-sm text-slate-600">
            Search by TX Code or Page Name to configure Communication Automation.
          </p>
        </ErpSectionCard>
      ) : (
        <ErpSectionCard
          eyebrow="Results"
          title={searching ? "Searching PACE pages" : "PACE Pages"}
        >
          {searchError ? (
            <div className="mb-3 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {searchError}
            </div>
          ) : null}
          {searching ? (
            <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Searching PACE pages...
            </div>
          ) : (
            <ErpDenseGrid
              columns={[
                {
                  key: "tx_code",
                  label: "TX Code",
                  width: "130px",
                  render: (row) => <span className="font-semibold text-slate-900">{row.tx_code ?? row.menu_code}</span>,
                },
                {
                  key: "title",
                  label: "Page",
                  render: (row) => <span className="font-semibold text-slate-900">{row.title}</span>,
                },
                {
                  key: "communication_status",
                  label: "Communication Status",
                  width: "210px",
                  render: (row) => (
                    <StatusBadge tone={row.communication_capable === true ? "ready" : "neutral"}>
                      {communicationStatusLabel(row)}
                    </StatusBadge>
                  ),
                },
                {
                  key: "enlisted",
                  label: "Enlisted",
                  width: "120px",
                  render: (row) => (
                    <StatusBadge tone={row.enlisted === true ? "enlisted" : "neutral"}>
                      {row.enlisted === true ? "Yes" : "No"}
                    </StatusBadge>
                  ),
                },
              ]}
              rows={searchRows}
              rowKey={(row) => row.page_menu_id}
              getRowProps={(row, index) => ({
                ...getRowProps(index),
                onClick: () => void selectPage(row),
                className: selectedPageId === row.page_menu_id ? "bg-sky-50" : "",
              })}
              emptyMessage="No matching PACE page found."
              maxHeight="min(520px, calc(100vh - 370px))"
            />
          )}
        </ErpSectionCard>
      )}

      <DrawerBase
        visible={drawerOpen}
        side="center"
        width="min(700px, calc(100vw - 24px))"
        title={drawerTitle}
        onEscape={() => void requestCloseDrawer()}
        onClose={() => void requestCloseDrawer()}
        actions={(
          <>
            <button
              type="button"
              disabled={saving || selectedPage?.enlisted !== true}
              onClick={() => void deEnlist()}
              className="mr-auto border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              De-enlist
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void requestCloseDrawer()}
              className="border border-slate-400 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Close
            </button>
            <button
              type="button"
              disabled={saving || !dirty || draft.surfaceKeys.length === 0}
              onClick={() => void saveEnrollment()}
              className="border border-sky-700 bg-sky-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        )}
      >
        {drawerLoading || !selectedPage ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading canonical communication settings...
          </div>
        ) : (
          <div className="grid gap-5">
            <section className="grid gap-2 border border-slate-300 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Communication Status
                </span>
                <StatusBadge tone="ready">Communication Ready</StatusBadge>
              </div>
              <p className="text-sm font-semibold text-slate-900">
                {selectedPage.enlisted === true ? "Currently enlisted" : "Not enlisted yet"}
              </p>
            </section>

            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">Email</p>
                  <p className="mt-1 text-xs text-slate-500">Enable or disable Email for this page enrollment.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.emailEnabled}
                  disabled={saving}
                  onClick={() => setDraft((current) => ({ ...current, emailEnabled: !current.emailEnabled }))}
                  className={`inline-flex min-w-20 items-center justify-center border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-50 ${
                    draft.emailEnabled
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                      : "border-slate-400 bg-white text-slate-700"
                  }`}
                >
                  {draft.emailEnabled ? "On" : "Off"}
                </button>
              </div>
            </section>

            <section className="grid gap-2 border-t border-slate-200 pt-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">
                  Show Automation Settings On
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Select the developer-declared page surfaces where a future Automation Settings action may appear.
                </p>
              </div>
              <div className="grid gap-1">
                {(canonicalState?.surfaces ?? []).map((surface) => {
                  const checked = draft.surfaceKeys.includes(surface.key);
                  return (
                    <label
                      key={surface.key}
                      className={`flex cursor-pointer items-center gap-3 border px-3 py-2 text-sm ${
                        checked ? "border-sky-300 bg-sky-50 text-sky-950" : "border-slate-300 bg-white text-slate-700"
                      } ${saving ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={saving}
                        onChange={() => toggleSurface(surface.key)}
                        className="h-4 w-4 accent-sky-700"
                      />
                      <span className="font-medium">{surface.label}</span>
                    </label>
                  );
                })}
              </div>
              {draft.surfaceKeys.length === 0 ? (
                <p className="text-xs text-amber-700">Select at least one valid surface before saving an active enrollment.</p>
              ) : null}
            </section>
          </div>
        )}
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
