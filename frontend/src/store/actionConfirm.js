let state = {
  visible: false,
  eyebrow: "",
  title: "",
  message: "",
  confirmLabel: "Confirm",
  cancelLabel: "Cancel",
};

let listeners = [];
let resolver = null;

function emit() {
  listeners.forEach((listener) => listener({ ...state }));
}

export function subscribeActionConfirm(listener) {
  listeners.push(listener);
  listener({ ...state });
}

export function unsubscribeActionConfirm(listener) {
  listeners = listeners.filter((entry) => entry !== listener);
}

export function openActionConfirm(config) {
  if (resolver) {
    return Promise.resolve(false);
  }

  state = {
    visible: true,
    eyebrow: config?.eyebrow ?? "Action Confirmation",
    title: config?.title ?? "Confirm Action",
    message: config?.message ?? "Do you want to continue?",
    confirmLabel: config?.confirmLabel ?? "Confirm",
    cancelLabel: config?.cancelLabel ?? "Cancel",
  };
  emit();

  return new Promise((resolve) => {
    resolver = resolve;
  });
}

export function resolveActionConfirm(approved) {
  const currentResolver = resolver;
  resolver = null;

  state = {
    visible: false,
    eyebrow: "",
    title: "",
    message: "",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
  };
  emit();

  if (currentResolver) {
    currentResolver(approved);
  }
}
