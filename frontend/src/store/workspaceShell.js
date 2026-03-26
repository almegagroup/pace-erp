let state = {
  sidebarCollapsed: false,
};

let listeners = [];

function emit() {
  const snapshot = { ...state };
  listeners.forEach((listener) => listener(snapshot));
}

export function subscribeWorkspaceShell(fn) {
  listeners.push(fn);
  fn({ ...state });
}

export function unsubscribeWorkspaceShell(fn) {
  listeners = listeners.filter((listener) => listener !== fn);
}

export function setSidebarCollapsed(collapsed) {
  if (state.sidebarCollapsed === collapsed) return;

  state = {
    ...state,
    sidebarCollapsed: collapsed,
  };
  emit();
}

export function showSidebar() {
  setSidebarCollapsed(false);
}

export function hideSidebar() {
  setSidebarCollapsed(true);
}

export function toggleSidebarCollapsed() {
  setSidebarCollapsed(!state.sidebarCollapsed);
}
