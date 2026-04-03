import { useEffect, useMemo, useState } from "react";

function loadVisibleColumnKeys(storageKey, columnDefs, defaultColumnKeys) {
  if (typeof window === "undefined") {
    return [...defaultColumnKeys];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      return [...defaultColumnKeys];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [...defaultColumnKeys];
    }

    const allowedKeys = parsed.filter((key) =>
      columnDefs.some((column) => column.key === key)
    );

    return allowedKeys.length > 0 ? allowedKeys : [...defaultColumnKeys];
  } catch {
    return [...defaultColumnKeys];
  }
}

export function useErpVisibleColumns({
  storageKey,
  columnDefs,
  defaultColumnKeys,
}) {
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() =>
    loadVisibleColumnKeys(storageKey, columnDefs, defaultColumnKeys)
  );

  const visibleColumns = useMemo(
    () =>
      visibleColumnKeys
        .map((key) => columnDefs.find((column) => column.key === key) ?? null)
        .filter(Boolean),
    [columnDefs, visibleColumnKeys]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(visibleColumnKeys));
  }, [storageKey, visibleColumnKeys]);

  function toggleColumn(columnKey) {
    setVisibleColumnKeys((current) => {
      if (current.includes(columnKey)) {
        if (current.length === 1) {
          return current;
        }

        return current.filter((key) => key !== columnKey);
      }

      return columnDefs
        .map((column) => column.key)
        .filter((key) => current.includes(key) || key === columnKey);
    });
  }

  function resetColumns() {
    setVisibleColumnKeys([...defaultColumnKeys]);
  }

  return {
    visibleColumns,
    visibleColumnKeys,
    toggleColumn,
    resetColumns,
  };
}
