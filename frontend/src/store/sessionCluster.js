/*
 * File-ID: UI-SESSION-CLUSTER-1
 * File-Path: frontend/src/store/sessionCluster.js
 * Gate: UI
 * Phase: UI
 * Domain: FRONT
 * Purpose: Frontend coordination store for backend-authoritative session clusters and governed multi-window membership.
 * Authority: Frontend (COORDINATION ONLY)
 */

import paceBackground from "../assets/pace-bgr.png";
import { pickRandomRedirectTip } from "../auth/redirectGuidance.js";

const WINDOW_INSTANCE_KEY = "__PACE_CLUSTER_WINDOW_INSTANCE__";
const ADMISSION_KEY = "__PACE_CLUSTER_ADMISSION__";
const STORAGE_EVENT_KEY = "__PACE_CLUSTER_EVENT__";
const OWNER_KEY_PREFIX = "__PACE_CLUSTER_OWNER__:";
const CHANNEL_NAME = "pace-erp-session-cluster";
const OWNER_HEARTBEAT_MS = 5000;
const OWNER_STALE_MS = 15000;
const CLUSTER_WINDOW_FEATURES =
  "popup=yes,width=1440,height=900,left=80,top=80,resizable=yes,scrollbars=yes";
const POPUP_SESSION_RESET_KEYS = Object.freeze([
  WINDOW_INSTANCE_KEY,
  ADMISSION_KEY,
  "__PACE_NAV_STACK__",
  "__PACE_WORKSPACE_LOCK__",
  "__PACE_SINGLE_TAB_ID__",
]);
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
  const tip = pickRandomRedirectTip();

  try {
    POPUP_SESSION_RESET_KEYS.forEach((key) => {
      openedWindow.sessionStorage.removeItem(key);
    });
  } catch {
    // Session storage reset is best-effort only.
  }

  try {
    openedWindow.document.title = "Opening Pace ERP window...";
    openedWindow.document.body.innerHTML = `
      <div style="margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:radial-gradient(circle at top, rgba(145,188,214,0.24), transparent 38%), linear-gradient(135deg, #edf4f8 0%, #f7fbfd 48%, #e4eef4 100%);color:#102939;font:600 16px 'Segoe UI',sans-serif;">
        <div style="width:min(680px,100%);border:1px solid rgba(24,52,71,0.12);border-radius:28px;background:rgba(255,255,255,0.92);box-shadow:0 28px 80px rgba(16,41,57,0.14);padding:32px;box-sizing:border-box;">
          <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 12px;border-radius:999px;background:#dfeef7;color:#245574;font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:800;">
            <span style="width:10px;height:10px;border-radius:999px;background:#2f7db1;animation:pace-window-pulse 1s ease-in-out infinite;"></span>
            Secure Window Launch
          </div>
          <div style="margin-top:22px;display:flex;justify-content:center;">
            <img src="${paceBackground}" alt="Pace ERP" style="width:min(220px,58vw);height:auto;object-fit:contain;filter:drop-shadow(0 10px 20px rgba(16,41,57,0.12));" />
          </div>
          <div style="margin-top:18px;font-size:29px;line-height:1.1;letter-spacing:-.04em;font-weight:700;">Preparing your new ERP window</div>
          <div style="margin-top:10px;font-size:15px;line-height:1.7;color:#4a6273;">
            We are validating the window admission ticket and loading the correct governed workspace surface.
          </div>
          <div style="margin-top:22px;height:10px;border-radius:999px;overflow:hidden;background:#dbe8ef;">
            <div style="width:38%;height:100%;border-radius:999px;background:linear-gradient(90deg, #2f7db1 0%, #7ecbff 100%);animation:pace-window-slide 1.25s ease-in-out infinite;transform-origin:left center;"></div>
          </div>
          <div style="margin-top:16px;border:1px solid #d7e5ee;border-radius:18px;background:#f8fbfd;padding:18px 18px 16px;min-height:122px;">
            <div style="margin:0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#628099;font-weight:800;">Security And Data Hygiene</div>
            <div style="margin-top:12px;font-size:18px;line-height:1.7;color:#17354a;font-weight:500;">${tip}</div>
          </div>
        </div>
      </div>
      <style>
        @keyframes pace-window-slide {
          0% { transform: translateX(-40%) scaleX(0.75); opacity: 0.55; }
          50% { transform: translateX(145%) scaleX(1); opacity: 1; }
          100% { transform: translateX(250%) scaleX(0.8); opacity: 0.55; }
        }

        @keyframes pace-window-pulse {
          0%, 100% { transform: scale(0.9); opacity: 0.55; }
          50% { transform: scale(1.05); opacity: 1; }
        }
      </style>
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
