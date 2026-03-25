let state = {
  visible: false,
  title: "",
  message: "",
};

let listeners = [];
let resolver = null;

function emit() {
  listeners.forEach((listener) => listener({ ...state }));
}

export function subscribeLogoutConfirm(fn) {
  listeners.push(fn);
  fn({ ...state });
}

export function unsubscribeLogoutConfirm(fn) {
  listeners = listeners.filter((listener) => listener !== fn);
}

export function openLogoutConfirm() {
  if (resolver) {
    return Promise.resolve(false);
  }

  state = {
    visible: true,
    title: "Logout Confirmation",
    message: "You are at the main dashboard. Do you want to logout now?",
  };
  emit();

  return new Promise((resolve) => {
    resolver = resolve;
  });
}

export function resolveLogoutConfirm(approved) {
  const currentResolver = resolver;
  resolver = null;

  state = {
    visible: false,
    title: "",
    message: "",
  };
  emit();

  if (currentResolver) {
    currentResolver(approved);
  }
}
