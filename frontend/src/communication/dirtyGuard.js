/**
 * Shared "ask before you navigate away from unsaved work" gate.
 *
 * Every caller (company change, tab/surface change, or any future context
 * transition) must ask BEFORE applying the change, not react to it after the
 * fact -- only then does "Cancel"/"Keep Editing" genuinely prevent the
 * transition instead of promising a choice it doesn't honor.
 *
 * Contract:
 * - not dirty -> apply immediately, no prompt.
 * - dirty + confirm() resolves false -> nothing happens: no discard, no
 *   apply. The caller's current state (company, surface, editor) is
 *   untouched, so a draft is never transplanted into a context it didn't
 *   come from.
 * - dirty + confirm() resolves true -> onDiscard() runs first (clearing the
 *   dirty/editor state), then apply() runs.
 */
export async function withDirtyGuard({ isDirty, confirm, onDiscard, apply }) {
  if (!isDirty) {
    apply();
    return true;
  }
  const approved = await confirm();
  if (!approved) return false;
  onDiscard();
  apply();
  return true;
}
