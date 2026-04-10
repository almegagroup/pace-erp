/*
 * File-ID: 8.4G
 * File-Path: frontend/src/store/erpPaginationHotkeys.js
 * Gate: 8
 * Phase: 8
 * Domain: FRONT
 * Purpose: Maintain a shared pagination hotkey controller for keyboard-first ERP lists
 * Authority: Frontend
 */

const paginationControllers = new Map();
let activePaginationOwnerId = "";

function getFallbackOwnerId() {
  const owners = Array.from(paginationControllers.keys());
  return owners[owners.length - 1] ?? "";
}

function resolveActiveController() {
  const ownerId =
    activePaginationOwnerId && paginationControllers.has(activePaginationOwnerId)
      ? activePaginationOwnerId
      : getFallbackOwnerId();

  return ownerId ? paginationControllers.get(ownerId) ?? null : null;
}

export function registerErpPaginationController(ownerId, controller) {
  if (!ownerId || !controller) {
    return () => {};
  }

  paginationControllers.set(ownerId, controller);

  if (!activePaginationOwnerId || activePaginationOwnerId === ownerId) {
    activePaginationOwnerId = ownerId;
  }

  return () => {
    paginationControllers.delete(ownerId);

    if (activePaginationOwnerId === ownerId) {
      activePaginationOwnerId = getFallbackOwnerId();
    }
  };
}

export function activateErpPaginationController(ownerId) {
  if (!ownerId || !paginationControllers.has(ownerId)) {
    return;
  }

  activePaginationOwnerId = ownerId;
}

export function executeErpPaginationHotkey(direction) {
  const controller = resolveActiveController();

  if (!controller) {
    return false;
  }

  if (direction === "previous") {
    if (!controller.canPrevious) {
      return false;
    }

    controller.previous();
    return true;
  }

  if (direction === "next") {
    if (!controller.canNext) {
      return false;
    }

    controller.next();
    return true;
  }

  return false;
}
