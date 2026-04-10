import { useEffect, useId } from "react";
import {
  activateErpPaginationController,
  registerErpPaginationController,
} from "../store/erpPaginationHotkeys.js";

export default function ErpPaginationStrip({
  page,
  setPage,
  totalPages,
  startIndex,
  endIndex,
  totalItems,
}) {
  const ownerId = useId();
  const canPrevious = page > 1;
  const canNext = page < totalPages;

  useEffect(() => {
    if (totalItems <= 0) {
      return () => {};
    }

    return registerErpPaginationController(ownerId, {
      canPrevious,
      canNext,
      previous: () => setPage((current) => Math.max(1, current - 1)),
      next: () => setPage((current) => Math.min(totalPages, current + 1)),
    });
  }, [canNext, canPrevious, ownerId, setPage, totalItems, totalPages]);

  useEffect(() => {
    if (totalItems <= 0) {
      return;
    }

    activateErpPaginationController(ownerId);
  }, [ownerId, page, totalItems]);

  if (totalItems <= 0) {
    return null;
  }

  return (
    <div
      onMouseEnter={() => activateErpPaginationController(ownerId)}
      onFocusCapture={() => activateErpPaginationController(ownerId)}
      className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-slate-100 px-3 py-2"
    >
      <div className="grid gap-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Rows {startIndex}-{endIndex} of {totalItems}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Alt+PgUp Prev | Alt+PgDn Next
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canPrevious}
          onFocus={() => activateErpPaginationController(ownerId)}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          className="border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Prev
        </button>
        <span className="min-w-[92px] text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Page {page}/{totalPages}
        </span>
        <button
          type="button"
          disabled={!canNext}
          onFocus={() => activateErpPaginationController(ownerId)}
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          className="border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
