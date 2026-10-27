let state = {
  visible: false,
  eyebrow: "",
  title: "",
  message: "",
  label: "",
  placeholder: "",
  defaultValue: "",
  required: false,
  confirmOnly: false,
  confirmLabel: "Confirm",
  secondaryLabel: "",
  cancelLabel: "Cancel",
};

let listeners = [];
let resolver = null;

function emit() {
  listeners.forEach((listener) => listener({ ...state }));
}

export function subscribeActionPrompt(listener) {
  listeners.push(listener);
  listener({ ...state });
}

export function unsubscribeActionPrompt(listener) {
  listeners = listeners.filter((entry) => entry !== listener);
}

export function openActionPrompt(config) {
  if (resolver) return Promise.resolve(null);
  state = {
    visible: true,
    eyebrow: config?.eyebrow ?? "Input Required",
    title: config?.title ?? "",
    message: config?.message ?? "",
    label: config?.label ?? "",
    placeholder: config?.placeholder ?? "",
    defaultValue: config?.defaultValue ?? "",
    required: config?.required ?? false,
    confirmOnly: false,
    confirmLabel: config?.confirmLabel ?? "Confirm",
    secondaryLabel: "",
    cancelLabel: "Cancel",
  };
  emit();
  return new Promise((resolve) => { resolver = resolve; });
}

// Confirmation with an optional explicit secondary decision. When a
// secondary label is supplied, Escape/Cancel resolves null so it cannot be
// mistaken for that business decision.
export function openConfirmPrompt(config) {
  if (resolver) return Promise.resolve(false);
  state = {
    visible: true,
    eyebrow: config?.eyebrow ?? "Confirm",
    title: config?.title ?? "",
    message: config?.message ?? "",
    label: "",
    placeholder: "",
    defaultValue: "",
    required: false,
    confirmOnly: true,
    confirmLabel: config?.confirmLabel ?? "Confirm",
    secondaryLabel: config?.secondaryLabel ?? "",
    cancelLabel: config?.cancelLabel ?? "Cancel",
  };
  emit();
  return new Promise((resolve) => { resolver = resolve; });
}

export function resolveActionPrompt(value) {
  const currentResolver = resolver;
  resolver = null;
  state = {
    visible: false,
    eyebrow: "",
    title: "",
    message: "",
    label: "",
    placeholder: "",
    defaultValue: "",
    required: false,
    confirmOnly: false,
    confirmLabel: "Confirm",
    secondaryLabel: "",
    cancelLabel: "Cancel",
  };
  emit();
  if (currentResolver) currentResolver(value);
}
