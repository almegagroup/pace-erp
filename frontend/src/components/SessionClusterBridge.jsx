/*
 * File-ID: UI-SESSION-CLUSTER-2
 * File-Path: frontend/src/components/SessionClusterBridge.jsx
 * Gate: UI
 * Phase: UI
 * Domain: FRONT
 * Purpose: Apply same-cluster coordination messages for warning, lock, unlock, and logout across admitted windows.
 * Authority: Frontend (COORDINATION ONLY)
 */

import { useEffect } from "react";
import {
  subscribeClusterMessages,
  unsubscribeClusterMessages,
} from "../store/sessionCluster.js";
import {
  clearWarning,
  hardLogout,
  showWarning,
} from "../store/sessionWarning.js";
import {
  lockWorkspace,
  unlockWorkspaceLocally,
} from "../store/workspaceLock.js";

export default function SessionClusterBridge() {
  useEffect(() => {
    const listener = (message) => {
      if (!message?.type) {
        return;
      }

      if (message.type === "SESSION_WARNING_SHOW" && message.warningType) {
        showWarning(message.warningType, null, { broadcast: false });
        return;
      }

      if (message.type === "SESSION_WARNING_CLEAR") {
        void clearWarning(message.reason ?? "remote", { broadcast: false });
        return;
      }

      if (message.type === "WORKSPACE_LOCK") {
        lockWorkspace({ broadcast: false });
        return;
      }

      if (message.type === "WORKSPACE_UNLOCK") {
        unlockWorkspaceLocally({ broadcast: false });
        return;
      }

      if (message.type === "SESSION_LOGOUT") {
        hardLogout({ broadcast: false });
      }
    };

    subscribeClusterMessages(listener);
    return () => unsubscribeClusterMessages(listener);
  }, []);

  return null;
}
