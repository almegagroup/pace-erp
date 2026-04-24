/*
 * File-ID: 9.15B-FRONT
 * File-Path: frontend/src/admin/sa/screens/SASessions.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin session governance surface for listing and revoking ERP sessions
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import ErpCompactFilterSelect from "../../../components/inputs/ErpCompactFilterSelect.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpPagination } from "../../../hooks/useErpPagination.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";

const FILTERS = Object.freeze([
  { key: "ALL", label: "All Sessions" },
  { key: "ACTIVE", label: "Active" },
  { key: "REVOKED", label: "Revoked" },
  { key: "IDLE", label: "Idle" },
  { key: "EXPIRED", label: "Expired" },
]);

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchSessions() {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/sessions`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json.data)) {
    throw new Error("SESSION_LIST_READ_FAILED");
  }

  return json.data;
}

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

function shortId(value) {
  if (!value) return "N/A";
  return String(value).slice(0, 8);
}

function formatSessionIdentity(session) {
  if (session.user_code && session.name) {
    return `${session.user_code} ${session.name}`;
  }

  if (session.user_code) {
    return session.user_code;
  }

  if (session.name) {
    return session.name;
  }

  return `Auth ${shortId(session.auth_user_id)}`;
}

function getStatusTone(status) {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-50 text-emerald-700";
    case "REVOKED":
      return "bg-rose-50 text-rose-700";
    case "IDLE":
      return "bg-amber-50 text-amber-700";
    case "EXPIRED":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-sky-50 text-sky-700";
  }
}

export default function SASessions() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [revokingSessionId, setRevokingSessionId] = useState("");
  const actionBarRefs = useRef([]);
  const filterRefs = useRef([]);
  const rowActionRefs = useRef([]);
  const searchInputRef = useRef(null);

  useEffect(() => {
    let alive = true;

    async function loadSessions() {
      setLoading(true);
      setError("");

      try {
        const data = await fetchSessions();

        if (!alive) return;

        setSessions(data);
      } catch {
        if (!alive) return;
        setError("Unable to load ERP sessions right now.");
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void loadSessions();

    return () => {
      alive = false;
    };
  }, []);

  async function handleRefresh() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchSessions();
      setSessions(data);
    } catch {
      setError("Unable to refresh the session list right now.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(sessionRow) {
    const approved = await openActionConfirm({
      eyebrow: "SA Session Governance",
      title: "Revoke ERP Session",
      message: `Revoke the session for ${formatSessionIdentity(sessionRow)} now?`,
      confirmLabel: "Revoke",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setRevokingSessionId(sessionRow.session_id);
    setError("");

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE}/api/admin/sessions/revoke`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ session_id: sessionRow.session_id }),
        }
      );

      const json = await readJsonSafe(response);

      if (!response.ok || !json?.ok || json?.data?.revoked !== true) {
        throw new Error("SESSION_REVOKE_FAILED");
      }

      const refreshedSessions = await fetchSessions();
      const revokedSession = refreshedSessions.find(
        (session) => session.session_id === sessionRow.session_id
      );

      setSessions(refreshedSessions);

      if (revokedSession?.status !== "REVOKED") {
        throw new Error("SESSION_REVOKE_NOT_FINALIZED");
      }
    } catch {
      setError("Session revoke was not finalized by the backend.");
    } finally {
      setRevokingSessionId("");
    }
  }

  const statusFilteredSessions = useMemo(
    () =>
      filter === "ALL"
        ? sessions
        : sessions.filter((session) => session.status === filter),
    [filter, sessions]
  );

  const filteredSessions = useMemo(
    () =>
      applyQuickFilter(statusFilteredSessions, searchQuery, [
        "session_id",
        "user_code",
        "name",
        "parent_company_name",
        "designation_hint",
        "auth_user_id",
        "status",
      ]),
    [searchQuery, statusFilteredSessions]
  );
  const sessionPagination = useErpPagination(filteredSessions, 10);
  const { getRowProps } = useErpListNavigation(sessionPagination.pageItems, {
    onActivate: (_row, index) => {
      rowActionRefs.current[index]?.focus();
    },
  });

  useErpScreenCommands([
    {
      id: "sa-sessions-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing sessions..." : "Refresh session inventory",
      keywords: ["refresh", "sessions", "session list"],
      disabled: loading,
      perform: () => void handleRefresh(),
      order: 10,
    },
    {
      id: "sa-sessions-focus-search",
      group: "Current Screen",
      label: "Focus session search",
      keywords: ["search", "filter", "sessions"],
      perform: () => searchInputRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-sessions-open-control-panel",
      group: "Current Screen",
      label: "Open control panel",
      keywords: ["control panel", "sa"],
      perform: () => openScreen("SA_CONTROL_PANEL", { mode: "reset" }),
      order: 30,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void handleRefresh(),
    },
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => filterRefs.current[0]?.focus(),
    },
  });

  const topActions = [
    {
      key: "control-panel",
      label: "Control Panel",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[0] = element;
      },
      onClick: () => openScreen("SA_CONTROL_PANEL", { mode: "reset" }),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "refresh-sessions",
      label: loading ? "Refreshing..." : "Refresh Sessions",
      hint: "Alt+R",
      tone: "primary",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => void handleRefresh(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  const filterSection = {
    eyebrow: "Session Filter",
    title: "Session Inventory",
    aside: (
      <ErpCompactFilterSelect
        label="Session View"
        value={filter}
        options={FILTERS}
        onChange={setFilter}
        selectRef={(element) => {
          filterRefs.current[0] = element;
        }}
        primaryFocus={true}
        helperText="Compact filtering reduces pre-list keyboard travel in dense governance inventories."
      />
    ),
    children: (
      <QuickFilterInput
        inputRef={searchInputRef}
        label="Quick Search"
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search by session, user, company, designation, auth, or status"
        hint="Visible quick filter for the session inventory. Alt+Shift+F jumps here, Alt+Shift+P returns to the filter selector."
      />
    ),
  };

  const listSection = {
    eyebrow: "Session Rows",
    title: loading
      ? "Refreshing session inventory"
      : `${filteredSessions.length} visible session${filteredSessions.length === 1 ? "" : "s"}`,
    children:
      filteredSessions.length === 0 ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
          {loading
            ? "Loading session inventory..."
            : "No sessions match the selected filter right now."}
        </div>
      ) : (
        <>
          <ErpPaginationStrip
            page={sessionPagination.page}
            setPage={sessionPagination.setPage}
            totalPages={sessionPagination.totalPages}
            startIndex={sessionPagination.startIndex}
            endIndex={sessionPagination.endIndex}
            totalItems={filteredSessions.length}
          />
          <ErpDenseGrid
            columns={[
              {
                key: "session",
                label: "Session",
                render: (session) => (
                  <div>
                    <p className="font-medium leading-tight">{shortId(session.session_id)}</p>
                    <p className="text-[10px] text-slate-500 truncate max-w-[120px]">{session.session_id}</p>
                  </div>
                ),
              },
              {
                key: "user",
                label: "ERP User",
                render: (session) => (
                  <div>
                    <p className="font-medium leading-tight">{formatSessionIdentity(session)}</p>
                    <p className="text-[10px] text-slate-500">{session.parent_company_name ?? "Company Not Captured"}</p>
                  </div>
                ),
              },
              {
                key: "status",
                label: "Status",
                render: (session) => (
                  <span className={`inline-flex border px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.14em] ${getStatusTone(session.status)}`}>
                    {session.status}
                  </span>
                ),
              },
              {
                key: "created",
                label: "Created",
                render: (session) => formatDateTime(session.created_at),
              },
              {
                key: "last_seen",
                label: "Last Seen",
                render: (session) => formatDateTime(session.last_seen_at),
              },
              {
                key: "expires",
                label: "Expires",
                render: (session) => formatDateTime(session.expires_at),
              },
              {
                key: "revoked",
                label: "Revoked",
                render: (session) => formatDateTime(session.revoked_at),
              },
              {
                key: "action",
                label: "Action",
                render: (session, index) =>
                  session.status === "ACTIVE" ? (
                    <button
                      ref={(element) => {
                        rowActionRefs.current[index] = element;
                      }}
                      type="button"
                      onClick={() => void handleRevoke(session)}
                      disabled={revokingSessionId === session.session_id}
                      onKeyDown={(event) =>
                        handleLinearNavigation(event, {
                          index,
                          refs: rowActionRefs.current,
                          orientation: "vertical",
                        })
                      }
                      className="border border-rose-300 bg-rose-50 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {revokingSessionId === session.session_id ? "Revoking..." : "Revoke"}
                    </button>
                  ) : (
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                      Read Only
                    </span>
                  ),
              },
            ]}
            rows={sessionPagination.pageItems}
            rowKey={(session) => session.session_id}
            getRowProps={(_session, index) => getRowProps(index)}
            emptyMessage="No sessions match the selected filter right now."
          />
        </>
      ),
  };

  return (
    <ErpMasterListTemplate
      eyebrow="SA Session Governance"
      title="ERP Sessions"
      actions={topActions}
      notices={
        error
          ? [
              {
                key: "error",
                tone: "error",
                message: error,
              },
            ]
          : []
      }
      footerHints={["Arrow Keys Navigate", "Enter Focus Action", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
      filterSection={filterSection}
      listSection={listSection}
    />
  );
}


