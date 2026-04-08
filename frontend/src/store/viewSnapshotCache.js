function getStorageKey(key) {
  return `pace.erp.view.snapshot.${key}`;
}

function canUseStorage() {
  return typeof window !== "undefined" && !!window.sessionStorage;
}

export function readViewSnapshotCache(key) {
  if (!canUseStorage() || !key) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(getStorageKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeViewSnapshotCache(key, value) {
  if (!canUseStorage() || !key) {
    return;
  }

  try {
    window.sessionStorage.setItem(getStorageKey(key), JSON.stringify(value));
  } catch {
    // View cache is best-effort only.
  }
}

export function clearViewSnapshotCache(key) {
  if (!canUseStorage() || !key) {
    return;
  }

  try {
    window.sessionStorage.removeItem(getStorageKey(key));
  } catch {
    // Best-effort only.
  }
}
