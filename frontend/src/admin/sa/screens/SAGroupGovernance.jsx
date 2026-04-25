import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import {
  formatCompanyAddress,
  formatCompanyLabel,
} from "../../../shared/companyDisplay.js";

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchJson(path) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    credentials: "include",
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "REQUEST_FAILED");
  }

  return json.data;
}

async function postJson(path, payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.code ?? "REQUEST_FAILED");
  }

  return json.data;
}

async function patchJson(path, payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.message ?? json?.code ?? "REQUEST_FAILED");
  }

  return json.data;
}

async function deleteJson(path, payload) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.message ?? json?.code ?? "REQUEST_FAILED");
  }

  return json.data;
}

function normalize(value) {
  return String(value ?? "").trim();
}

function sortGroups(rows) {
  return [...rows].sort((left, right) => {
    const leftValue = `${left.group_code ?? ""} ${left.name ?? ""}`.trim();
    const rightValue = `${right.group_code ?? ""} ${right.name ?? ""}`.trim();
    return leftValue.localeCompare(rightValue, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function sortCompanies(rows) {
  return [...rows].sort((left, right) => {
    const leftValue = `${left.company_code ?? ""} ${left.company_name ?? ""}`.trim();
    const rightValue = `${right.company_code ?? ""} ${right.company_name ?? ""}`.trim();
    return leftValue.localeCompare(rightValue, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function groupSearchValue(row) {
  return [row.group_code, row.name, row.state]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function companySearchValue(row) {
  return [
    row.company_code,
    row.company_name,
    row.gst_number,
    row.status,
    row.group_code,
    row.group_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function SAGroupGovernance() {
  const navigate = useNavigate();
  const topActionRefs = useRef([]);
  const createInputRef = useRef(null);
  const groupSearchRef = useRef(null);
  const companySearchRef = useRef(null);
  const [groups, setGroups] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [selectedGroupNameDraft, setSelectedGroupNameDraft] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadGovernance() {
    setLoading(true);
    setError("");

    try {
      const [groupData, companyData] = await Promise.all([
        fetchJson("/api/admin/groups"),
        fetchJson("/api/admin/companies"),
      ]);

      const nextGroups = sortGroups(groupData?.groups ?? []);
      const nextCompanies = sortCompanies(companyData?.companies ?? []);

      setGroups(nextGroups);
      setCompanies(nextCompanies);
      setSelectedGroupId((current) => {
        if (current && nextGroups.some((row) => String(row.id) === String(current))) {
          return current;
        }

        return nextGroups[0]?.id ?? null;
      });
    } catch {
      setError("Group governance inventory could not be loaded right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGovernance();
  }, []);

  const filteredGroups = useMemo(() => {
    const needle = normalize(groupSearch).toLowerCase();

    if (!needle) {
      return groups;
    }

    return groups.filter((row) => groupSearchValue(row).includes(needle));
  }, [groupSearch, groups]);

  const { getRowProps: getGroupRowProps } = useErpListNavigation(filteredGroups);

  useEffect(() => {
    if (filteredGroups.length === 0) {
      if (selectedGroupId !== null) {
        setSelectedGroupId(null);
      }
      return;
    }

    if (!filteredGroups.some((row) => String(row.id) === String(selectedGroupId))) {
      setSelectedGroupId(filteredGroups[0].id);
    }
  }, [filteredGroups, selectedGroupId]);

  const selectedGroup = useMemo(
    () => groups.find((row) => String(row.id) === String(selectedGroupId)) ?? null,
    [groups, selectedGroupId]
  );

  useEffect(() => {
    setSelectedGroupNameDraft(selectedGroup?.name ?? "");
  }, [selectedGroup]);

  const filteredCompanies = useMemo(() => {
    const needle = normalize(companySearch).toLowerCase();

    if (!needle) {
      return companies;
    }

    return companies.filter((row) => companySearchValue(row).includes(needle));
  }, [companies, companySearch]);

  const mappedCompanies = useMemo(() => {
    if (!selectedGroup) {
      return [];
    }

    return companies.filter((row) => String(row.group_id) === String(selectedGroup.id));
  }, [companies, selectedGroup]);

  async function handleCreateGroup() {
    const name = normalize(groupDraft);

    if (!name) {
      setError("Enter a group name before creating a group.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "SA Group Governance",
      title: "Create Group",
      message: `Create group ${name}?`,
      confirmLabel: "Create Group",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const data = await postJson("/api/admin/group", { name });
      setGroupDraft("");
      setNotice(`Group ${data.group.group_code} created successfully.`);
      await loadGovernance();
      setSelectedGroupId(data.group.id);
    } catch {
      setError("Group could not be created right now.");
    } finally {
      setSaving(false);
    }
  }

  async function handleGroupStateChange(nextStatus) {
    if (!selectedGroup) {
      setError("Select a group before changing state.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "SA Group Governance",
      title: `${nextStatus === "ACTIVE" ? "Activate" : "Inactivate"} Group`,
      message: `${nextStatus === "ACTIVE" ? "Activate" : "Inactivate"} ${selectedGroup.group_code}?`,
      confirmLabel: nextStatus === "ACTIVE" ? "Activate" : "Inactivate",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await postJson("/api/admin/group/state", {
        group_id: selectedGroup.id,
        next_status: nextStatus,
      });
      setNotice(`Group ${selectedGroup.group_code} is now ${nextStatus}.`);
      await loadGovernance();
    } catch {
      setError("Group state could not be updated right now.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateGroup() {
    if (!selectedGroup) {
      setError("Select a group before saving changes.");
      return;
    }

    const nextName = normalize(selectedGroupNameDraft);

    if (!nextName || nextName.length < 2) {
      setError("Group name must be at least 2 characters.");
      return;
    }

    if (nextName === selectedGroup.name) {
      setNotice("No group name change to save.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "SA Group Governance",
      title: "Rename Group",
      message: `Rename ${selectedGroup.group_code} to ${nextName}?`,
      confirmLabel: "Save Name",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await patchJson("/api/admin/group", {
        group_id: selectedGroup.id,
        name: nextName,
      });
      setNotice(`Group ${selectedGroup.group_code} renamed successfully.`);
      await loadGovernance();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Group rename failed. ${err.message}`
          : "Group rename failed right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteGroup() {
    if (!selectedGroup) {
      setError("Select a group before removing it.");
      return;
    }

    const approved = await openActionConfirm({
      eyebrow: "SA Group Governance",
      title: "Remove Group",
      message: `Delete ${selectedGroup.group_code}? This only works when no company is still mapped.`,
      confirmLabel: "Delete Group",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await deleteJson("/api/admin/group", {
        group_id: selectedGroup.id,
      });
      setNotice(`Group ${selectedGroup.group_code} deleted successfully.`);
      await loadGovernance();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Group delete failed. ${err.message}`
          : "Group delete failed right now.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleMapCompany(company) {
    if (!selectedGroup) {
      setError("Select a target group before mapping companies.");
      return;
    }

    const targetLabel = `${selectedGroup.group_code} | ${selectedGroup.name}`;
    const currentLabel = company.group_code
      ? `${company.group_code}${company.group_name ? ` | ${company.group_name}` : ""}`
      : "No group";
    const verb = company.group_id ? "Move" : "Map";

    const approved = await openActionConfirm({
      eyebrow: "SA Group Governance",
      title: `${verb} Company`,
      message: `${verb} ${company.company_code} from ${currentLabel} to ${targetLabel}?`,
      confirmLabel: verb,
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await postJson("/api/admin/group/map-company", {
        company_id: company.id,
        group_id: selectedGroup.id,
      });
      setNotice(`Company ${company.company_code} mapped to ${selectedGroup.group_code}.`);
      await loadGovernance();
    } catch {
      setError("Company mapping could not be saved right now.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnmapCompany(company) {
    const approved = await openActionConfirm({
      eyebrow: "SA Group Governance",
      title: "Unmap Company",
      message: `Remove ${company.company_code} from ${company.group_code ?? "its current group"}?`,
      confirmLabel: "Unmap",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await postJson("/api/admin/company-group/unmap", {
        company_id: company.id,
      });
      setNotice(`Company ${company.company_code} was unmapped from its group.`);
      await loadGovernance();
    } catch {
      setError("Company unmap could not be saved right now.");
    } finally {
      setSaving(false);
    }
  }

  useErpScreenCommands([
    {
      id: "sa-group-governance-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing group governance..." : "Refresh group governance",
      keywords: ["refresh", "groups", "mapping"],
      disabled: loading,
      perform: () => void loadGovernance(),
      order: 10,
    },
    {
      id: "sa-group-governance-create",
      group: "Current Screen",
      label: "Focus create group",
      keywords: ["create group", "group name"],
      perform: () => createInputRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-group-governance-company-manage",
      group: "Current Screen",
      label: "Open company manage",
      keywords: ["company manage", "companies"],
      perform: () => {
        openScreen("SA_COMPANY_MANAGE", { mode: "replace" });
        navigate("/sa/company/manage");
      },
      order: 30,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadGovernance(),
    },
    focusPrimary: {
      perform: () => createInputRef.current?.focus(),
    },
    focusSearch: {
      perform: () => groupSearchRef.current?.focus(),
    },
  });

  const notices = [
    error ? { tone: "error", message: error } : null,
    notice ? { tone: "success", message: notice } : null,
  ].filter(Boolean);

  return (
    <ErpScreenScaffold
      eyebrow="SA Group Governance"
      title="Group Create, Manage, And Company Mapping"
      notices={notices}
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "primary",
          buttonRef: (element) => {
            topActionRefs.current[0] = element;
          },
          onClick: () => void loadGovernance(),
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 0,
              refs: topActionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "company-manage",
          label: "Company Manage",
          tone: "neutral",
          buttonRef: (element) => {
            topActionRefs.current[1] = element;
          },
          onClick: () => {
            openScreen("SA_COMPANY_MANAGE", { mode: "replace" });
            navigate("/sa/company/manage");
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 1,
              refs: topActionRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
      footerHints={["↑↓ Navigate", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <ErpSelectionSection label="Create Global Group" />
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <label className="grid gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Group Name
                </span>
                <input
                  ref={createInputRef}
                  value={groupDraft}
                  onChange={(event) => setGroupDraft(event.target.value)}
                  className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                  placeholder="Example Holdings Group"
                />
              </label>

              <button
                type="button"
                disabled={saving}
                onClick={() => void handleCreateGroup()}
                className="self-end border border-sky-300 bg-sky-50 px-2 py-[3px] text-[11px] font-semibold text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                Create Group
              </button>
            </div>
          </div>

          <div className="grid gap-1">
            <ErpSelectionSection label="Group Roster" />
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Filter Groups
              </span>
              <input
                ref={groupSearchRef}
                value={groupSearch}
                onChange={(event) => setGroupSearch(event.target.value)}
                className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                placeholder="Search group code, name, or state"
              />
            </label>

            <div className="mt-4 grid gap-2">
              {filteredGroups.length === 0 ? (
                <p className="border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  No group matches the current filter.
                </p>
              ) : (
                filteredGroups.map((group, index) => {
                  const selected = String(group.id) === String(selectedGroupId);

                  return (
                    <button
                      key={group.id}
                      {...getGroupRowProps(index)}
                      type="button"
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`border px-4 py-3 text-left ${
                        selected
                          ? "border-sky-300 bg-sky-50 text-sky-900"
                          : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      <div className="font-semibold">
                        {group.group_code} | {group.name}
                      </div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                        {group.state ?? "UNKNOWN"} | {group.company_count ?? 0} companies
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <ErpSelectionSection label={selectedGroup ? `${selectedGroup.group_code} | ${selectedGroup.name}` : "Choose A Group"} />
            {selectedGroup ? (
              <>
                <div className="border border-slate-300 bg-white">
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">State</span>
                    <span className="text-[11px] font-semibold text-slate-900">{selectedGroup.state ?? "UNKNOWN"}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">Company Count</span>
                    <span className="text-[11px] font-semibold text-slate-900">{selectedGroup.company_count ?? 0}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 px-2 py-[3px]">
                    <span className="text-[11px] text-slate-500">Created</span>
                    <span className="text-[11px] font-semibold text-slate-900">{selectedGroup.created_at ? new Date(selectedGroup.created_at).toLocaleDateString() : "Unknown"}</span>
                  </div>
                </div>

                <label className="mt-2 grid grid-cols-[100px_1fr] items-center gap-x-2">
                  <span className="text-[11px] text-slate-600">Group Name</span>
                  <input
                    value={selectedGroupNameDraft}
                    onChange={(event) => setSelectedGroupNameDraft(event.target.value)}
                    className="h-7 border border-slate-300 bg-[#fffef7] px-2 py-0.5 text-[12px] text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white"
                    placeholder="Edit group name"
                  />
                </label>

                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleUpdateGroup()}
                    className="border border-sky-300 bg-sky-50 px-2 py-[3px] text-[11px] font-semibold text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Save Name
                  </button>
                  <button
                    type="button"
                    disabled={saving || selectedGroup.state === "ACTIVE"}
                    onClick={() => void handleGroupStateChange("ACTIVE")}
                    className="border border-emerald-300 bg-emerald-50 px-2 py-[3px] text-[11px] font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Activate
                  </button>
                  <button
                    type="button"
                    disabled={saving || selectedGroup.state === "INACTIVE"}
                    onClick={() => void handleGroupStateChange("INACTIVE")}
                    className="border border-rose-300 bg-rose-50 px-2 py-[3px] text-[11px] font-semibold text-rose-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Inactivate
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleDeleteGroup()}
                    className="border border-slate-400 bg-white px-2 py-[3px] text-[11px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Remove Group
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                Select a group from the roster to manage it.
              </p>
            )}
          </div>

          <div className="grid gap-1">
            <ErpSelectionSection label="Company To Group Mapping" />
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Filter Companies
              </span>
              <input
                ref={companySearchRef}
                value={companySearch}
                onChange={(event) => setCompanySearch(event.target.value)}
                className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400"
                placeholder="Search company code, company name, GST, or group"
              />
            </label>

            <div className="mt-4 grid gap-2">
              {filteredCompanies.length === 0 ? (
                <p className="border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  No company matches the current filter.
                </p>
              ) : (
                filteredCompanies.map((company) => {
                  const mappedToSelected = selectedGroup &&
                    String(company.group_id) === String(selectedGroup.id);

                  return (
                    <div
                      key={company.id}
                      className={`grid gap-3 border px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] ${
                        mappedToSelected
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-slate-300 bg-white"
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-slate-900">
                          {formatCompanyLabel(company)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{formatCompanyAddress(company)}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                          {company.status ?? "UNKNOWN"} | {company.gst_number ?? "No GST"}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          {company.group_code
                            ? `Current group: ${company.group_code}${company.group_name ? ` | ${company.group_name}` : ""}`
                            : "Currently unmapped"}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        {mappedToSelected ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleUnmapCompany(company)}
                            className="border border-rose-300 bg-rose-50 px-2 py-[3px] text-[11px] font-semibold text-rose-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            Unmap
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={saving || !selectedGroup || selectedGroup.state !== "ACTIVE" || company.status !== "ACTIVE"}
                            onClick={() => void handleMapCompany(company)}
                            className="border border-sky-300 bg-sky-50 px-2 py-[3px] text-[11px] font-semibold text-sky-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            {company.group_id ? "Move Here" : "Map Here"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid gap-1">
            <ErpSelectionSection label="Mapped Company Read Model" />
            {selectedGroup ? (
              mappedCompanies.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No companies are mapped to this group yet.
                </p>
              ) : (
                <div className="grid gap-2">
                  {mappedCompanies.map((company) => (
                    <div
                      key={company.id}
                      className="border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      <div className="font-semibold text-slate-900">{formatCompanyLabel(company)}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatCompanyAddress(company)}</div>
                      <div className="mt-1 text-xs text-slate-500">{company.status ?? "UNKNOWN"}</div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <p className="text-sm text-slate-500">
                Select a group to see its mapped companies.
              </p>
            )}
          </div>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
