/*
 * File-ID: UI-SESSION-CLUSTER-1
 * File-Path: frontend/src/store/sessionCluster.js
 * Gate: UI
 * Phase: UI
 * Domain: FRONT
 * Purpose: Frontend coordination store for backend-authoritative session clusters and governed multi-window membership.
 * Authority: Frontend (COORDINATION ONLY)
 */

const WINDOW_INSTANCE_KEY = "__PACE_CLUSTER_WINDOW_INSTANCE__";
const ADMISSION_KEY = "__PACE_CLUSTER_ADMISSION__";
const STORAGE_EVENT_KEY = "__PACE_CLUSTER_EVENT__";
const OWNER_KEY_PREFIX = "__PACE_CLUSTER_OWNER__:";
const CHANNEL_NAME = "pace-erp-session-cluster";
const OWNER_HEARTBEAT_MS = 5000;
const OWNER_STALE_MS = 15000;
const CLUSTER_WINDOW_FEATURES =
  "popup=yes,width=1440,height=900,left=80,top=80,resizable=yes,scrollbars=yes";
const RUNTIME_WINDOW_ID = createUuid();

let admissionState = readAdmissionState();
let listeners = [];
let messageListeners = [];
let broadcastChannel = null;
let storageListenerBound = false;

function createUuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `cluster-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readAdmissionState() {
  try {
    const raw = sessionStorage.getItem(ADMISSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.clusterId !== "string" ||
      typeof parsed.windowToken !== "string" ||
      typeof parsed.windowSlot !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function emitAdmission() {
  const snapshot = admissionState ? { ...admissionState } : null;
  listeners.forEach((listener) => listener(snapshot));
}

function emitMessage(message) {
  messageListeners.forEach((listener) => listener(message));
}

function ensureStorageListener() {
  if (storageListenerBound || typeof window === "undefined") {
    return;
  }

  const handleStorage = (event) => {
    if (event.key !== STORAGE_EVENT_KEY || !event.newValue) return;

    try {
      const payload = JSON.parse(event.newValue);
      if (!payload || payload.sourceWindowId === getWindowInstanceId()) {
        return;
      }

      emitMessage(payload.message);
    } catch {
      // Ignore malformed cross-window payloads.
    }
  };

  window.addEventListener("storage", handleStorage);
  storageListenerBound = true;
}

function ownerKey(windowToken) {
  return `${OWNER_KEY_PREFIX}${windowToken}`;
}

function readOwnerSnapshot(windowToken) {
  try {
    const raw = localStorage.getItem(ownerKey(windowToken));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.runtimeWindowId !== "string" ||
      typeof parsed.claimedAt !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeOwnerSnapshot(windowToken) {
  try {
    localStorage.setItem(
      ownerKey(windowToken),
      JSON.stringify({
        runtimeWindowId: RUNTIME_WINDOW_ID,
        claimedAt: Date.now(),
      })
    );
  } catch {
    // Best-effort only.
  }
}

export function releaseClusterWindowOwnership(windowToken = admissionState?.windowToken) {
  if (!windowToken) {
    return;
  }

  try {
    const current = readOwnerSnapshot(windowToken);
    if (current?.runtimeWindowId === RUNTIME_WINDOW_ID) {
      localStorage.removeItem(ownerKey(windowToken));
    }
  } catch {
    // Local release must never block navigation/logout.
  }
}

function ensureBroadcastChannel() {
  if (!admissionState?.clusterId) {
    if (broadcastChannel) {
      broadcastChannel.close();
      broadcastChannel = null;
    }
    return null;
  }

  if (broadcastChannel) {
    return broadcastChannel;
  }

  if (typeof BroadcastChannel === "undefined") {
    return null;
  }

  broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  broadcastChannel.onmessage = (event) => {
    const payload = event?.data;
    if (!payload || payload.sourceWindowId === getWindowInstanceId()) {
      return;
    }

    if (payload.clusterId !== admissionState?.clusterId) {
      return;
    }

    emitMessage(payload.message);
  };

  return broadcastChannel;
}

export function getWindowInstanceId() {
  try {
    const existing = sessionStorage.getItem(WINDOW_INSTANCE_KEY);
    if (existing) {
      return existing;
    }

    const next = createUuid();
    sessionStorage.setItem(WINDOW_INSTANCE_KEY, next);
    return next;
  } catch {
    return createUuid();
  }
}

export function getClusterAdmission() {
  return admissionState ? { ...admissionState } : null;
}

function buildClusterJoinUrl(homePath, joinToken) {
  const url = new URL(homePath, globalThis.location.origin);
  url.searchParams.set("cluster_join", joinToken);
  return url;
}

function primeClusterPopupWindow(openedWindow) {
  try {
    openedWindow.document.title = "Opening Pace ERP window...";
    openedWindow.document.body.innerHTML = `
      <div style="margin:0;min-height:100vh;display:grid;place-items:center;background:#e6eef3;color:#102939;font:600 16px Segoe UI,sans-serif;">
        <div style="text-align:center">
          <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.7">Pace ERP</div>
          <div style="margin-top:10px">Preparing your new workspace window...</div>
        </div>
      </div>
    `;
  } catch {
    // Some browsers restrict placeholder writes after navigation; ignore.
  }
}

export function openPendingClusterWindow() {
  const openedWindow = globalThis.open(
    "about:blank",
    "_blank",
    CLUSTER_WINDOW_FEATURES
  );

  if (!openedWindow) {
    return null;
  }

  primeClusterPopupWindow(openedWindow);
  return openedWindow;
}

export function subscribeClusterAdmission(listener) {
  listeners.push(listener);
  listener(admissionState ? { ...admissionState } : null);
}

export function unsubscribeClusterAdmission(listener) {
  listeners = listeners.filter((entry) => entry !== listener);
}

export function subscribeClusterMessages(listener) {
  ensureStorageListener();
  ensureBroadcastChannel();
  messageListeners.push(listener);
}

export function unsubscribeClusterMessages(listener) {
  messageListeners = messageListeners.filter((entry) => entry !== listener);
}

export function setClusterAdmission(admission) {
  admissionState = {
    clusterId: admission.clusterId,
    clusterWindowId: admission.clusterWindowId ?? null,
    windowToken: admission.windowToken,
    windowSlot: admission.windowSlot,
    maxWindowCount: admission.maxWindowCount ?? 3,
  };

  try {
    sessionStorage.setItem(ADMISSION_KEY, JSON.stringify(admissionState));
  } catch {
    // Best-effort only.
  }

  ensureBroadcastChannel();
  emitAdmission();
}

export function clearClusterAdmission() {
  releaseClusterWindowOwnership();
  admissionState = null;

  try {
    sessionStorage.removeItem(ADMISSION_KEY);
  } catch {
    // Best-effort only.
  }

  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
  }

  emitAdmission();
}

export function getClusterFetchHeaders() {
  if (!admissionState?.windowToken) {
    return {};
  }

  return {
    "x-erp-window-token": admissionState.windowToken,
  };
}

export function broadcastClusterMessage(message) {
  if (!admissionState?.clusterId) {
    return;
  }

  const payload = {
    clusterId: admissionState.clusterId,
    sourceWindowId: getWindowInstanceId(),
    message,
  };

  const channel = ensureBroadcastChannel();
  channel?.postMessage(payload);

  try {
    localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(payload));
    localStorage.removeItem(STORAGE_EVENT_KEY);
  } catch {
    // Storage fallback is best-effort only.
  }
}

export function claimClusterWindowOwnership() {
  if (!admissionState?.windowToken) {
    return true;
  }

  const existing = readOwnerSnapshot(admissionState.windowToken);

  if (
    existing &&
    existing.runtimeWindowId !== RUNTIME_WINDOW_ID &&
    Date.now() - existing.claimedAt < OWNER_STALE_MS
  ) {
    return false;
  }

  writeOwnerSnapshot(admissionState.windowToken);
  return true;
}

export function startClusterWindowOwnershipGuard(onOwnershipLost) {
  if (!admissionState?.windowToken) {
    return () => {};
  }

  let active = true;
  const token = admissionState.windowToken;

  const enforce = () => {
    if (!active) return;

    const existing = readOwnerSnapshot(token);
    if (
      existing &&
      existing.runtimeWindowId !== RUNTIME_WINDOW_ID &&
      Date.now() - existing.claimedAt < OWNER_STALE_MS
    ) {
      active = false;
      onOwnershipLost?.();
      return;
    }

    writeOwnerSnapshot(token);
  };

  const handleStorage = (event) => {
    if (event.key !== ownerKey(token)) return;
    enforce();
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      enforce();
    }
  };

  enforce();

  const intervalId = window.setInterval(enforce, OWNER_HEARTBEAT_MS);
  window.addEventListener("storage", handleStorage);
  window.addEventListener("focus", enforce);
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    active = false;
    window.clearInterval(intervalId);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("focus", enforce);
    document.removeEventListener("visibilitychange", handleVisibility);
    releaseClusterWindowOwnership(token);
  };
}

export async function requestSessionClusterAdmission(joinToken = null) {
  const response = await globalThis.fetch(
    `${import.meta.env.VITE_API_BASE}/api/session/cluster/admit`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        window_instance_id: getWindowInstanceId(),
        join_token: joinToken,
      }),
    }
  );

  const json = await response.clone().json().catch(() => null);

  if (!response.ok || !json?.ok) {
    return {
      ok: false,
      code: json?.code ?? "SESSION_CLUSTER_ADMISSION_FAILED",
    };
  }

  setClusterAdmission({
    clusterId: json.data?.cluster_id,
    clusterWindowId: json.data?.cluster_window_id,
    windowToken: json.data?.window_token,
    windowSlot: json.data?.window_slot,
    maxWindowCount: json.data?.max_window_count,
  });

  return { ok: true };
}

export async function requestOpenClusterWindow(homePath, options = {}) {
  const { openedWindow = null } = options;
  const popupWindow =
    openedWindow && !openedWindow.closed
      ? openedWindow
      : openPendingClusterWindow();

  if (!popupWindow) {
    return {
      ok: false,
      code: "SESSION_CLUSTER_WINDOW_POPUP_BLOCKED",
    };
  }

  const response = await globalThis.fetch(
    `${import.meta.env.VITE_API_BASE}/api/session/cluster/open-window`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...getClusterFetchHeaders(),
      },
      body: JSON.stringify({}),
    }
  );

  const json = await response.clone().json().catch(() => null);

  if (!response.ok || !json?.ok || !json?.data?.join_token) {
    try {
      popupWindow.close();
    } catch {
      // Best-effort only.
    }

    return {
      ok: false,
      code: json?.code ?? "SESSION_CLUSTER_OPEN_WINDOW_FAILED",
    };
  }

  const url = buildClusterJoinUrl(homePath, json.data.join_token);

  try {
    popupWindow.location.replace(url.toString());
    popupWindow.focus?.();
  } catch {
    try {
      popupWindow.close();
    } catch {
      // Best-effort only.
    }

    return {
      ok: false,
      code: "SESSION_CLUSTER_WINDOW_NAVIGATION_FAILED",
    };
  }

  return { ok: true };
}

export async function requestCloseCurrentClusterWindow(options = {}) {
  const {
    keepalive = false,
    fetchImpl = globalThis.fetch,
  } = options;

  if (!admissionState?.clusterId || !admissionState?.windowToken) {
    return;
  }

  try {
    await fetchImpl(`${import.meta.env.VITE_API_BASE}/api/session/cluster/window-close`, {
      method: "POST",
      credentials: "include",
      keepalive,
      headers: {
        "Content-Type": "application/json",
        ...getClusterFetchHeaders(),
      },
      body: JSON.stringify({
        reason: "WINDOW_CLOSED",
      }),
    });
  } catch {
    // Best-effort only.
  }
}
