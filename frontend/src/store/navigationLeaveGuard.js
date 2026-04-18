import { openActionConfirm } from "./actionConfirm.js";

let activeGuard = null;

export function setNavigationLeaveGuard(config) {
  if (!config || config.active !== true) {
    activeGuard = null;
    return;
  }

  activeGuard = {
    scope: config.scope ?? "global",
    title: config.title ?? "Leave Current Workspace?",
    message: config.message ?? "Do you want to leave this workspace?",
    confirmLabel: config.confirmLabel ?? "Leave Anyway",
    cancelLabel: config.cancelLabel ?? "Stay Here",
  };
}

export function clearNavigationLeaveGuard(scope = null) {
  if (!activeGuard) {
    return;
  }

  if (!scope || activeGuard.scope === scope) {
    activeGuard = null;
  }
}

export function hasNavigationLeaveGuard(scope = null) {
  if (!activeGuard) {
    return false;
  }

  return !scope || activeGuard.scope === scope;
}

export async function confirmNavigationLeaveIfNeeded(scope = null) {
  if (!hasNavigationLeaveGuard(scope)) {
    return true;
  }

  const guard = activeGuard;

  return await openActionConfirm({
    eyebrow: "ACL Version Center",
    title: guard.title,
    message: guard.message,
    confirmLabel: guard.confirmLabel,
    cancelLabel: guard.cancelLabel,
  });
}
