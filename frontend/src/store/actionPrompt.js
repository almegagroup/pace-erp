let state = {
  visible: false,
  eyebrow: "",
  title: "",
  label: "",
  placeholder: "",
  defaultValue: "",
  required: false,
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
    label: config?.label ?? "",
    placeholder: config?.placeholder ?? "",
    defaultValue: config?.defaultValue ?? "",
    required: config?.required ?? false,
  };
  emit();
  return new Promise((resolve) => { resolver = resolve; });
}

export function resolveActionPrompt(value) {
  const currentResolver = resolver;
  resolver = null;
  state = { visible: false, eyebrow: "", title: "", label: "", placeholder: "", defaultValue: "", required: false };
  emit();
  if (currentResolver) currentResolver(value);
}
