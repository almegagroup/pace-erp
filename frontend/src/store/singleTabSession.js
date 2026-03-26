const TAB_ID_KEY = "__PACE_SINGLE_TAB_ID__";
const OWNER_KEY = "__PACE_SINGLE_TAB_OWNER__";

function createTabId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getCurrentTabId() {
  try {
    const existing = sessionStorage.getItem(TAB_ID_KEY);
    if (existing) {
      return existing;
    }

    const next = createTabId();
    sessionStorage.setItem(TAB_ID_KEY, next);
    return next;
  } catch {
    return createTabId();
  }
}

function readOwnerSnapshot() {
  try {
    const raw = localStorage.getItem(OWNER_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.tabId !== "string") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function claimSingleTabOwnership() {
  const snapshot = {
    tabId: getCurrentTabId(),
    claimedAt: Date.now(),
  };

  try {
    localStorage.setItem(OWNER_KEY, JSON.stringify(snapshot));
  } catch {
    // Best effort only. Cross-tab enforcement degrades gracefully.
  }

  return snapshot;
}

export function releaseSingleTabOwnership() {
  try {
    const current = readOwnerSnapshot();
    if (current?.tabId === getCurrentTabId()) {
      localStorage.removeItem(OWNER_KEY);
    }
  } catch {
    // Local release must never block logout/navigation.
  }
}

export function subscribeSingleTabOwnership(listener) {
  const handleStorage = (event) => {
    if (event.key !== OWNER_KEY) return;
    listener(readOwnerSnapshot());
  };

  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

export function isOwnedByCurrentTab() {
  const current = readOwnerSnapshot();
  return current?.tabId === getCurrentTabId();
}
