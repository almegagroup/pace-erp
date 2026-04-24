import { useEffect, useMemo, useRef, useState } from "react";

function syncHorizontalScroll(source, target) {
  if (!source || !target) return;
  if (target.scrollLeft !== source.scrollLeft) {
    target.scrollLeft = source.scrollLeft;
  }
}

export default function ErpStickyDataTable({
  columns,
  rows,
  rowKey,
  renderCell,
  getRowProps,
  emptyCellValue = "-",
  maxBodyHeightClass = "max-h-[65vh]",
  tableClassName = "min-w-full border-collapse text-xs",
}) {
  const topScrollRef = useRef(null);
  const topScrollInnerRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const tableRef = useRef(null);
  const syncingRef = useRef(false);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);

  const normalizedColumns = useMemo(() => columns ?? [], [columns]);
  const normalizedRows = useMemo(() => rows ?? [], [rows]);

  useEffect(() => {
    const topScroll = topScrollRef.current;
    const bodyScroll = bodyScrollRef.current;
    const topScrollInner = topScrollInnerRef.current;
    const table = tableRef.current;

    if (!topScroll || !bodyScroll || !topScrollInner || !table) {
      return undefined;
    }

    function refreshMeasurements() {
      const tableWidth = table.scrollWidth || 0;
      const viewportWidth = bodyScroll.clientWidth || 0;
      topScrollInner.style.width = `${tableWidth}px`;
      setHasHorizontalOverflow(tableWidth > viewportWidth + 1);
    }

    function handleTopScroll() {
      if (syncingRef.current) return;
      syncingRef.current = true;
      syncHorizontalScroll(topScroll, bodyScroll);
      window.requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    }

    function handleBodyScroll() {
      if (syncingRef.current) return;
      syncingRef.current = true;
      syncHorizontalScroll(bodyScroll, topScroll);
      window.requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    }

    refreshMeasurements();
    topScroll.addEventListener("scroll", handleTopScroll);
    bodyScroll.addEventListener("scroll", handleBodyScroll);

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => refreshMeasurements())
        : null;

    resizeObserver?.observe(table);
    resizeObserver?.observe(bodyScroll);
    window.addEventListener("resize", refreshMeasurements);

    return () => {
      topScroll.removeEventListener("scroll", handleTopScroll);
      bodyScroll.removeEventListener("scroll", handleBodyScroll);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", refreshMeasurements);
    };
  }, [normalizedColumns, normalizedRows]);

  return (
    <div className="grid gap-2">
      <div
        ref={topScrollRef}
        className={`overflow-x-auto overflow-y-hidden border border-slate-200 bg-slate-50 ${
          hasHorizontalOverflow ? "block" : "hidden"
        }`}
      >
        <div ref={topScrollInnerRef} className="h-4" />
      </div>

      <div
        ref={bodyScrollRef}
        className={`overflow-auto border border-slate-200 ${maxBodyHeightClass}`}
      >
        <table ref={tableRef} className={tableClassName}>
          <thead className="bg-slate-100">
            <tr>
              {normalizedColumns.map((column) => (
                <th
                  key={column.key}
                  className="sticky top-0 z-10 border border-slate-200 bg-slate-100 px-2 py-2 text-left font-semibold uppercase tracking-[0.12em] text-slate-500"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {normalizedRows.map((row, index) => (
              <tr key={rowKey ? rowKey(row, index) : index} {...(getRowProps ? getRowProps(row, index) : {})}>
                {normalizedColumns.map((column) => (
                  <td key={column.key} className="border border-slate-200 px-2 py-2 text-slate-700">
                    {renderCell
                      ? renderCell(row, column, index)
                      : row?.[column.key] || emptyCellValue}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
