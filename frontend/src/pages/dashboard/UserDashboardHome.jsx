import { useEffect, useMemo, useRef, useState } from "react";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../components/templates/ErpScreenScaffold.jsx";
import { useErpScreenCommands } from "../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../hooks/useErpScreenHotkeys.js";
import { handleLinearNavigation } from "../../navigation/erpRovingFocus.js";
import { openRoute } from "../../navigation/screenStackEngine.js";
import { useMenu } from "../../context/useMenu.js";
import { openErpCommandPalette } from "../../store/erpCommandPalette.js";
import {
  listLeaveApprovalInbox,
  listOutWorkApprovalInbox,
} from "./hr/hrApi.js";

function canOpenApprovalInbox(menuSnapshot) {
  const rows = Array.isArray(menuSnapshot) ? menuSnapshot : [];

  return rows.some(
    (row) =>
      row?.resource_code === "HR_LEAVE_APPROVAL_INBOX" ||
      row?.resource_code === "HR_OUT_WORK_APPROVAL_INBOX" ||
      row?.route_path === "/dashboard/hr/leave/approval-inbox" ||
      row?.route_path === "/dashboard/hr/out-work/approval-inbox",
  );
}

function hasRoute(menuSnapshot, routePath) {
  return Array.isArray(menuSnapshot)
    ? menuSnapshot.some((row) => row?.route_path === routePath)
    : false;
}

function findFirstRoute(menuSnapshot, routePaths = []) {
  return routePaths.find((routePath) => hasRoute(menuSnapshot, routePath)) ?? "";
}

async function loadApprovalSummary(canViewApprovalInbox) {
  if (!canViewApprovalInbox) {
    return { approvalsToday: 0 };
  }

  const [leaveRows, outWorkRows] = await Promise.allSettled([
    listLeaveApprovalInbox(),
    listOutWorkApprovalInbox(),
  ]);

  const leaveCount =
    leaveRows.status === "fulfilled" ? (leaveRows.value?.length ?? 0) : 0;
  const outWorkCount =
    outWorkRows.status === "fulfilled" ? (outWorkRows.value?.length ?? 0) : 0;

  return { approvalsToday: leaveCount + outWorkCount };
}

function normalizeMenuRows(menu) {
  const seenRoutes = new Set();

  return (Array.isArray(menu) ? menu : [])
    .filter((row) => row?.route_path)
    .filter((row) => {
      if (seenRoutes.has(row.route_path)) {
        return false;
      }

      seenRoutes.add(row.route_path);
      return true;
    })
    .sort((left, right) => {
      const moduleCompare = String(left?.module_code ?? "").localeCompare(
        String(right?.module_code ?? ""),
        "en",
        { numeric: true, sensitivity: "base" },
      );

      if (moduleCompare !== 0) {
        return moduleCompare;
      }

      return String(left?.title ?? "").localeCompare(String(right?.title ?? ""), "en", {
        numeric: true,
        sensitivity: "base",
      });
    });
}

function groupMenuRowsByModule(rows) {
  return rows.reduce((groups, row) => {
    const key = row?.module_code || "GENERAL";
    const existing = groups.get(key);

    if (existing) {
      existing.rows.push(row);
      return groups;
    }

    groups.set(key, {
      moduleCode: key,
      moduleName: row?.module_name || key,
      rows: [row],
    });
    return groups;
  }, new Map());
}

function assignIndexedRef(refObject, index, element) {
  if (!refObject || typeof refObject !== "object") {
    return;
  }

  refObject.current[index] = element;
}

function TaskButton({ action, index, refs }) {
  return (
    <button
      ref={(element) => {
        assignIndexedRef(refs, index, element);
      }}
      data-workspace-primary-focus={index === 0 ? "true" : undefined}
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      onKeyDown={(event) =>
        handleLinearNavigation(event, {
          index,
          refs: refs.current,
          orientation: "vertical",
        })
      }
      className={`grid w-full grid-cols-[92px_minmax(0,1fr)_128px] items-center border px-4 py-3 text-left transition ${
        action.disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
          : "border-slate-300 bg-white hover:border-sky-300 hover:bg-sky-50"
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
        {action.badge}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">
          {action.title}
        </span>
        <span className="mt-1 block truncate text-xs text-slate-500">
          {action.description}
        </span>
      </span>
      <span className="justify-self-end text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {action.hint}
      </span>
    </button>
  );
}

function WorkspaceRow({ row }) {
  return (
    <button
      type="button"
      onClick={() => openRoute(row.route_path)}
      className="grid w-full grid-cols-[minmax(0,1fr)_140px] items-center border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-sky-300 hover:bg-sky-50"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">
          {row?.title || row?.resource_code || row?.route_path}
        </span>
        <span className="mt-1 block truncate text-[11px] uppercase tracking-[0.12em] text-slate-500">
          {row?.resource_code || row?.route_path}
        </span>
      </span>
      <span className="justify-self-end text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        Open Route
      </span>
    </button>
  );
}

export default function UserDashboardHome() {
  const topActionRefs = useRef([]);
  const taskRefs = useRef([]);
  const { menu, runtimeContext, shellProfile } = useMenu();
  const [approvalSummary, setApprovalSummary] = useState({
    approvalsToday: 0,
  });
  const canViewApprovalInbox = useMemo(() => canOpenApprovalInbox(menu), [menu]);
  const priorityRoute = useMemo(
    () =>
      findFirstRoute(menu, [
        "/dashboard/hr/leave/my-requests",
        "/dashboard/hr/out-work/my-requests",
        "/dashboard/hr/leave/apply",
        "/dashboard/hr/out-work/apply",
      ]),
    [menu],
  );
  const approvalRoute = useMemo(
    () =>
      findFirstRoute(menu, [
        "/dashboard/hr/leave/approval-inbox",
        "/dashboard/hr/out-work/approval-inbox",
      ]),
    [menu],
  );
  const reportingRoute = useMemo(
    () =>
      findFirstRoute(menu, [
        "/dashboard/hr/leave/register",
        "/dashboard/hr/out-work/register",
        "/dashboard/hr/leave/approval-history",
        "/dashboard/hr/out-work/approval-history",
      ]),
    [menu],
  );

  useEffect(() => {
    let alive = true;

    async function refreshApprovalSummary() {
      try {
        const nextSummary = await loadApprovalSummary(canViewApprovalInbox);
        if (alive) {
          setApprovalSummary(nextSummary);
        }
      } catch {
        if (alive) {
          setApprovalSummary({ approvalsToday: 0 });
        }
      }
    }

    void refreshApprovalSummary();

    function handleFocus() {
      void refreshApprovalSummary();
    }

    function handleWorkflowChange() {
      void refreshApprovalSummary();
    }

    window.addEventListener("focus", handleFocus);
    window.addEventListener("erp:workflow-changed", handleWorkflowChange);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      alive = false;
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("erp:workflow-changed", handleWorkflowChange);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [canViewApprovalInbox]);

  const normalizedMenu = useMemo(() => normalizeMenuRows(menu), [menu]);
  const groupedWorkspaces = useMemo(
    () => Array.from(groupMenuRowsByModule(normalizedMenu).values()),
    [normalizedMenu],
  );
  const availableCompanyCount = runtimeContext?.availableCompanies?.length ?? 0;
  const availableWorkAreaCount = runtimeContext?.availableWorkContexts?.length ?? 0;

  const currentCompanyLabel = runtimeContext?.currentCompany
    ? `${runtimeContext.currentCompany.company_code} | ${runtimeContext.currentCompany.company_name}`
    : "No company selected";
  const currentWorkAreaLabel = runtimeContext?.selectedWorkContext
    ? `${runtimeContext.selectedWorkContext.work_context_code} | ${runtimeContext.selectedWorkContext.work_context_name}`
    : "No work area selected";

  const quickTasks = [
    {
      badge: "Work",
      title: "Continue Current Queue",
      description: priorityRoute
        ? "Open the first request workspace exposed by the current ACL access map."
        : "No request workspace is available in the current access map.",
      hint: priorityRoute ? "Enter Open" : "Unavailable",
      disabled: !priorityRoute,
      onClick: () => {
        if (priorityRoute) {
          openRoute(priorityRoute);
        }
      },
    },
    {
      badge: "Approval",
      title: "Review Pending Decisions",
      description: approvalRoute
        ? `Open the approval inbox. Current pending count: ${approvalSummary.approvalsToday}.`
        : "No approval inbox is available in the current access map.",
      hint: approvalRoute ? "Enter Open" : "Unavailable",
      disabled: !approvalRoute,
      onClick: () => {
        if (approvalRoute) {
          openRoute(approvalRoute);
        }
      },
    },
    {
      badge: "Report",
      title: "Open Current Registers",
      description: reportingRoute
        ? "Open the best available history or register page from the current scope."
        : "No direct register route is available right now. Use command search.",
      hint: reportingRoute ? "Enter Open" : "Ctrl+K / F9",
      disabled: false,
      onClick: () => {
        if (reportingRoute) {
          openRoute(reportingRoute);
          return;
        }

        openErpCommandPalette();
      },
    },
  ];

  useErpScreenCommands([
    {
      id: "user-home-focus-primary-task",
      group: "Current Screen",
      label: "Focus primary task list",
      keywords: ["acl", "home", "task", "focus"],
      perform: () => {
        const target = document.querySelector("[data-workspace-primary-focus='true']");
        target?.focus?.();
      },
      order: 10,
    },
    {
      id: "user-home-open-command-search",
      group: "Current Screen",
      label: "Open command search",
      keywords: ["acl", "home", "command", "search"],
      perform: () => openErpCommandPalette(),
      order: 20,
    },
  ]);

  useErpScreenHotkeys({
    focusPrimary: {
      perform: () => {
        const target = document.querySelector("[data-workspace-primary-focus='true']");
        target?.focus?.();
      },
    },
  });

  return (
    <ErpScreenScaffold
      eyebrow="ACL Workspace"
      title="Work Start"
      notices={[
        {
          key: "acl-home-scope",
          tone: "info",
          message:
            "Access comes from ACL packs and scope. Approval and report authority remain separately scoped by rules.",
        },
      ]}
      topActions={[
        {
          key: "focus-primary-task",
          label: "Focus Tasks",
          hint: "Alt+Shift+P",
          tone: "primary",
          buttonRef: (element) => {
            topActionRefs.current[0] = element;
          },
          onClick: () => {
            const target = document.querySelector("[data-workspace-primary-focus='true']");
            target?.focus?.();
          },
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 0,
              refs: topActionRefs.current,
              orientation: "horizontal",
            }),
        },
        {
          key: "open-command-search",
          label: "Command Search",
          hint: "Ctrl+K / F9",
          tone: "neutral",
          buttonRef: (element) => {
            topActionRefs.current[1] = element;
          },
          onClick: () => openErpCommandPalette(),
          onKeyDown: (event) =>
            handleLinearNavigation(event, {
              index: 1,
              refs: topActionRefs.current,
              orientation: "horizontal",
            }),
        },
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[0.94fr_1.06fr]">
        <div className="grid gap-4">
          <ErpSectionCard
            eyebrow="Current Scope"
            title="Operator Identity"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <ErpFieldPreview
                label="Name"
                value={shellProfile?.name || "Unknown name"}
                caption="Current signed-in ACL operator name."
              />
              <ErpFieldPreview
                label="User"
                value={shellProfile?.userCode || "Unknown user"}
                caption="Current signed-in ACL operator."
              />
              <ErpFieldPreview
                label="Role"
                value={shellProfile?.roleCode || "Unknown role"}
                caption="Authority class from the role ladder."
              />
              <ErpFieldPreview
                label="Current Company"
                value={currentCompanyLabel}
                caption={`Accessible companies in scope: ${availableCompanyCount}.`}
              />
              <ErpFieldPreview
                label="Current Work Area"
                value={currentWorkAreaLabel}
                caption={`Available work areas in scope: ${availableWorkAreaCount}.`}
              />
            </div>
          </ErpSectionCard>

          <ErpSectionCard
            eyebrow="Immediate Tasks"
            title="Open Work"
          >
            <div className="grid gap-2">
              {quickTasks.map((action, index) => (
                <TaskButton
                  key={action.title}
                  action={action}
                  index={index}
                  refs={taskRefs}
                />
              ))}
            </div>
          </ErpSectionCard>
        </div>

        <ErpSectionCard
          eyebrow="Available Workspaces"
          title="Open What ACL Allows"
        >
          <div className="grid gap-4">
            {groupedWorkspaces.length === 0 ? (
              <div className="border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                No route is currently exposed in this ACL snapshot.
              </div>
            ) : (
              groupedWorkspaces.map((group) => (
                <section key={group.moduleCode} className="grid gap-2">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Module
                      </p>
                      <h3 className="mt-1 text-sm font-semibold text-slate-900">
                        {group.moduleName}
                      </h3>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {group.rows.length} Route{group.rows.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {group.rows.map((row) => (
                      <WorkspaceRow key={row.route_path} row={row} />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
