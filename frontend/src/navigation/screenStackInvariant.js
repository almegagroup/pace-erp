/*
 * File-ID: 8.2A
 * File-Path: frontend/src/navigation/screenStackInvariant.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Enforce single active navigation stack invariant
 * Authority: Frontend
 */

import { getStackSnapshot } from "./screenStackEngine.js";

export function assertSingleActiveStack() {
  const stack = getStackSnapshot();

  if (!Array.isArray(stack)) {
    throw new Error("[STACK_INVARIANT] Stack is not an array");
  }

  if (stack.length === 0) {
    throw new Error("[STACK_INVARIANT] Empty stack is invalid");
  }
}
