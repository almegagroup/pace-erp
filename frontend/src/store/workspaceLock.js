let state = {
  visible: false,
  loading: false,
  error: "",
};

let listeners = [];

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

export function lockWorkspace() {
  state = {
    visible: true,
    loading: false,
    error: "",
  };
  emit();
}

export function unlockWorkspaceLocally() {
  state = {
    visible: false,
    loading: false,
    error: "",
  };
  emit();
}

export function clearWorkspaceLock() {
  unlockWorkspaceLocally();
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
