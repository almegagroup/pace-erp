/*
 * File-Path: frontend/src/store/screenBackInterceptor.js
 * Domain: FRONT
 * Purpose: Let the currently mounted screen intercept a Back action (shell
 *          Esc/Back button or actual browser Back) and handle it internally
 *          (e.g. step from an internal "results" view back to "filters")
 *          instead of the shell popping the whole screen off the stack.
 * Authority: Frontend
 */

let interceptor = null;

export function setScreenBackInterceptor(fn) {
  interceptor = typeof fn === "function" ? fn : null;
}

export function clearScreenBackInterceptor(fn) {
  if (!fn || interceptor === fn) {
    interceptor = null;
  }
}

// Returns true if the interceptor handled the Back action itself — callers
// must not proceed with their own pop/navigate logic in that case.
export function runScreenBackInterceptor() {
  if (!interceptor) return false;
  return Boolean(interceptor());
}
