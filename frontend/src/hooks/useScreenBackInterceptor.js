/*
 * File-Path: frontend/src/hooks/useScreenBackInterceptor.js
 * Domain: FRONT
 * Purpose: Register a page-local handler for the shell's Back action (Esc /
 *          Back button / browser Back). Return true from the handler to
 *          indicate it was handled internally (e.g. stepped back to an
 *          internal "filters" view) — the shell will not pop the screen.
 * Authority: Frontend
 */

import { useEffect, useRef } from "react";
import { setScreenBackInterceptor, clearScreenBackInterceptor } from "../store/screenBackInterceptor.js";

export function useScreenBackInterceptor(handler) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const proxy = () => Boolean(handlerRef.current?.());
    setScreenBackInterceptor(proxy);
    return () => clearScreenBackInterceptor(proxy);
  }, []);
}
