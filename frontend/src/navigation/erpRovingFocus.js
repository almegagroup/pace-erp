function isFocusableTarget(target) {
  return (
    target instanceof HTMLElement &&
    !target.hasAttribute("disabled") &&
    target.getAttribute("aria-hidden") !== "true"
  );
}

function findNextIndex(items, startIndex, step) {
  if (!Array.isArray(items) || items.length === 0) {
    return -1;
  }

  for (let offset = 1; offset <= items.length; offset += 1) {
    const nextIndex = (startIndex + step * offset + items.length) % items.length;
    if (isFocusableTarget(items[nextIndex])) {
      return nextIndex;
    }
  }

  return -1;
}

export function focusLinearItem(items, index) {
  const target = Array.isArray(items) ? items[index] : null;

  if (isFocusableTarget(target)) {
    target.focus();
    return true;
  }

  return false;
}

export function handleLinearNavigation(event, { index, refs, orientation = "horizontal" }) {
  const items = Array.isArray(refs) ? refs : [];
  if (items.length === 0) {
    return;
  }

  let nextIndex = -1;

  if (event.key === "Home") {
    nextIndex = findNextIndex(items, -1, 1);
  }

  if (event.key === "End") {
    nextIndex = findNextIndex(items, 0, -1);
  }

  if (orientation === "horizontal") {
    if (event.key === "ArrowRight") {
      nextIndex = findNextIndex(items, index, 1);
    }

    if (event.key === "ArrowLeft") {
      nextIndex = findNextIndex(items, index, -1);
    }
  }

  if (orientation === "vertical") {
    if (event.key === "ArrowDown") {
      nextIndex = findNextIndex(items, index, 1);
    }

    if (event.key === "ArrowUp") {
      nextIndex = findNextIndex(items, index, -1);
    }
  }

  if (nextIndex === -1) {
    return;
  }

  event.preventDefault();
  focusLinearItem(items, nextIndex);
}

function findGridTarget(gridRefs, rowIndex, columnIndex) {
  const row = Array.isArray(gridRefs?.[rowIndex]) ? gridRefs[rowIndex] : null;
  if (!row) {
    return null;
  }

  const exactTarget = row[columnIndex];
  if (isFocusableTarget(exactTarget)) {
    return exactTarget;
  }

  return row.find((item) => isFocusableTarget(item)) ?? null;
}

function findNextRowIndex(gridRefs, startRowIndex, step, columnIndex) {
  const rowCount = Array.isArray(gridRefs) ? gridRefs.length : 0;
  if (rowCount === 0) {
    return -1;
  }

  for (let offset = 1; offset <= rowCount; offset += 1) {
    const nextRowIndex = (startRowIndex + step * offset + rowCount) % rowCount;
    if (findGridTarget(gridRefs, nextRowIndex, columnIndex)) {
      return nextRowIndex;
    }
  }

  return -1;
}

export function handleGridNavigation(event, { rowIndex, columnIndex, gridRefs }) {
  if (!Array.isArray(gridRefs) || gridRefs.length === 0) {
    return;
  }

  const row = Array.isArray(gridRefs[rowIndex]) ? gridRefs[rowIndex] : [];
  let nextTarget = null;

  if (event.key === "ArrowRight") {
    nextTarget =
      findGridTarget([row], 0, columnIndex + 1) ??
      findGridTarget([row], 0, 0);
  }

  if (event.key === "ArrowLeft") {
    nextTarget =
      findGridTarget([row], 0, columnIndex - 1) ??
      row
        .slice()
        .reverse()
        .find((item) => isFocusableTarget(item)) ??
      null;
  }

  if (event.key === "Home") {
    nextTarget = row.find((item) => isFocusableTarget(item)) ?? null;
  }

  if (event.key === "End") {
    nextTarget =
      row
        .slice()
        .reverse()
        .find((item) => isFocusableTarget(item)) ?? null;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const step = event.key === "ArrowDown" ? 1 : -1;
    const nextRowIndex = findNextRowIndex(gridRefs, rowIndex, step, columnIndex);
    if (nextRowIndex >= 0) {
      nextTarget = findGridTarget(gridRefs, nextRowIndex, columnIndex);
    }
  }

  if (!(nextTarget instanceof HTMLElement)) {
    return;
  }

  event.preventDefault();
  nextTarget.focus();
}
