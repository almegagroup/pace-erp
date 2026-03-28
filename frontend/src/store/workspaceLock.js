import { broadcastClusterMessage } from "./sessionCluster.js";

let state = {
  visible: false,
  loading: false,
  error: "",
};

let listeners = [];
const STORAGE_KEY = "__PACE_WORKSPACE_LOCK__";

function setWorkspaceLockPersistence(locked) {
  try {
    if (locked) {
      sessionStorage.setItem(STORAGE_KEY, "1");
      return;
    }

    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Session storage is a best-effort security hint for refresh handling.
  }
}

function emit() {
  const snapshot = { ...state };
  listeners.forEach((listener) => listener(snapshot));
}

export function subscribeWorkspaceLock(fn) {
  listeners.push(fn);
  fn({ ...state });
}

export function unsubscribeWorkspaceLock(fn) {
  listeners = listeners.filter((listener) => listener !== fn);
}

export function lockWorkspace(options = {}) {
  const { broadcast = true } = options;

  setWorkspaceLockPersistence(true);
  state = {
    visible: true,
    loading: false,
    error: "",
  };
  emit();

  if (broadcast) {
    broadcastClusterMessage({
      type: "WORKSPACE_LOCK",
    });
  }
}

export function unlockWorkspaceLocally(options = {}) {
  const { broadcast = true } = options;

  setWorkspaceLockPersistence(false);
  state = {
    visible: false,
    loading: false,
    error: "",
  };
  emit();

  if (broadcast) {
    broadcastClusterMessage({
      type: "WORKSPACE_UNLOCK",
    });
  }
}

export function clearWorkspaceLock() {
  unlockWorkspaceLocally({ broadcast: false });
}

export function consumeLockedRefreshFlag() {
  try {
    const locked = sessionStorage.getItem(STORAGE_KEY) === "1";
    sessionStorage.removeItem(STORAGE_KEY);
    return locked;
  } catch {
    return false;
  }
}

export async function requestWorkspaceLockLogout(options = {}) {
  const {
    keepalive = false,
    fetchImpl = globalThis.fetch,
  } = options;

  try {
    await fetchImpl(`${import.meta.env.VITE_API_BASE}/api/logout`, {
      method: "POST",
      credentials: "include",
      keepalive,
    });
  } catch {
    // Best effort only. Startup hard logout will still clear the local shell.
  }
}

export async function submitWorkspaceUnlock(password) {
  if (!password) {
    state = {
      ...state,
      error: "Password is required.",
    };
    emit();
    return false;
  }

  state = {
    ...state,
    loading: true,
    error: "",
  };
  emit();

  try {
    const response = await globalThis.fetch(
      `${import.meta.env.VITE_API_BASE}/api/unlock`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      }
    );

    let json = null;
    try {
      json = await response.clone().json();
    } catch {
      json = null;
    }

    if (!response.ok || !json?.ok) {
      state = {
        ...state,
        loading: false,
        error: "Invalid password. Please try again.",
      };
      emit();
      return false;
    }

    unlockWorkspaceLocally();
    return true;
  } catch {
    state = {
      ...state,
      loading: false,
      error: "Unable to verify password right now.",
    };
    emit();
    return false;
  }
}
