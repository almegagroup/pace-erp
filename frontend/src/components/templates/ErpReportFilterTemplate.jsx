/*
 * File-ID: 9.14-FRONT
 * File-Path: frontend/src/components/templates/ErpReportFilterTemplate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the keyboard-native report and filter template on the shared work-canvas grammar
 * Authority: Frontend
 */

import ErpScreenScaffold from "./ErpScreenScaffold.jsx";
import ErpSelectionSection from "../forms/ErpSelectionSection.jsx";
import ErpRegisterHeader from "../data/ErpRegisterHeader.jsx";

export default function ErpReportFilterTemplate({
  eyebrow,
  title,
  actions = [],
  notices = [],
  filterSection = null,
  reportSection = null,
  bottomSection = null,
  footerHints = [
    "↑↓ Navigate",
    "Enter Open",
    "Ctrl+S Export",
    "F8 Refresh",
    "Esc Back",
    "Ctrl+K Command Bar",
  ],
}) {
  return (
    <ErpScreenScaffold
      eyebrow={eyebrow}
      title={title}
      actions={actions}
      notices={notices}
      footerHints={footerHints}
    >
      <div className="grid gap-[var(--erp-section-gap)]">
        {filterSection ? (
          <section className="grid gap-2 border-b border-slate-300 pb-3">
            {filterSection.eyebrow ? (
              <ErpSelectionSection label={filterSection.eyebrow} />
            ) : null}
            {filterSection.title ? (
              <div className="text-sm font-semibold text-slate-900">
                {filterSection.title}
              </div>
            ) : null}
            {filterSection.aside ? (
              <div className="justify-self-start">{filterSection.aside}</div>
            ) : null}
            <div>{filterSection.children}</div>
          </section>
        ) : null}
        {reportSection ? (
          <section className="grid gap-2">
            {reportSection.eyebrow ? (
              <ErpSelectionSection label={reportSection.eyebrow} />
            ) : null}
            {reportSection.title != null ? (
              <ErpRegisterHeader
                title={reportSection.title}
                count={reportSection.count}
                filterValue={reportSection.filterValue}
                onFilterChange={reportSection.onFilterChange}
                filterRef={reportSection.filterRef}
                filterPlaceholder={reportSection.filterPlaceholder}
              />
            ) : null}
            {reportSection.aside ? (
              <div className="justify-self-start">{reportSection.aside}</div>
            ) : null}
            <div>{reportSection.children}</div>
          </section>
        ) : null}
        {bottomSection ? <div>{bottomSection}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
