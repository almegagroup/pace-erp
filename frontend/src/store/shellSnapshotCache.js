const SHELL_SNAPSHOT_STORAGE_KEY = "pace.erp.shell.snapshot.v1";

const EMPTY_SHELL_PROFILE = Object.freeze({
  userCode: "",
  roleCode: "",
  tagline: "Process Automation & Control Environment",
});

const EMPTY_RUNTIME_CONTEXT = Object.freeze({
  isAdmin: false,
  selectedCompanyId: "",
  currentCompany: null,
  availableCompanies: [],
  availableWorkContexts: [],
  selectedWorkContext: null,
  shellIssueCode: "",
  shellIssueMessage: "",
});

function canUseStorage() {
  return typeof window !== "undefined" && !!window.sessionStorage;
}

function normalizeShellProfile(profile) {
  return {
    userCode: profile?.userCode ?? "",
    roleCode: profile?.roleCode ?? "",
    tagline: profile?.tagline ?? EMPTY_SHELL_PROFILE.tagline,
  };
}

function normalizeRuntimeContext(context) {
  return {
    isAdmin: context?.isAdmin === true,
    selectedCompanyId: context?.selectedCompanyId ?? "",
    currentCompany: context?.currentCompany ?? null,
    availableCompanies: Array.isArray(context?.availableCompanies)
      ? context.availableCompanies
      : [],
    availableWorkContexts: Array.isArray(context?.availableWorkContexts)
      ? context.availableWorkContexts
      : [],
    selectedWorkContext: context?.selectedWorkContext ?? null,
    shellIssueCode: context?.shellIssueCode ?? "",
    shellIssueMessage: context?.shellIssueMessage ?? "",
  };
}

export function buildShellSnapshot({
  menu,
  shellProfile,
  runtimeContext,
  cachedAt = Date.now(),
} = {}) {
  return {
    cachedAt,
    menu: Array.isArray(menu) ? menu : [],
    shellProfile: normalizeShellProfile(shellProfile),
    runtimeContext: normalizeRuntimeContext(runtimeContext),
  };
}

export function readShellSnapshotCache() {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(SHELL_SNAPSHOT_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const snapshot = buildShellSnapshot(parsed);

    if (
      snapshot.menu.length === 0 ||
      !snapshot.shellProfile.userCode ||
      !snapshot.shellProfile.roleCode
    ) {
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

export function writeShellSnapshotCache(snapshot) {
  if (!canUseStorage()) {
    return;
  }

  try {
    const nextSnapshot = buildShellSnapshot(snapshot);
    window.sessionStorage.setItem(
      SHELL_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(nextSnapshot)
    );
  } catch {
    // Session cache is best-effort only.
  }
}

export function clearShellSnapshotCache() {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(SHELL_SNAPSHOT_STORAGE_KEY);
  } catch {
    // Session cache cleanup is best-effort only.
  }
}

export function getShellSnapshotAgeMs(snapshot) {
  if (!snapshot?.cachedAt) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Date.now() - snapshot.cachedAt);
}

export { EMPTY_RUNTIME_CONTEXT, EMPTY_SHELL_PROFILE };
