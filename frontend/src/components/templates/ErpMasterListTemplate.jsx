/*
 * File-ID: 9.12-FRONT
 * File-Path: frontend/src/components/templates/ErpMasterListTemplate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the keyboard-native master list template with fixed control rail and dense work canvas
 * Authority: Frontend
 */

import ErpScreenScaffold from "./ErpScreenScaffold.jsx";
import ErpSelectionSection from "../forms/ErpSelectionSection.jsx";
import ErpRegisterHeader from "../data/ErpRegisterHeader.jsx";

const DEFAULT_FOOTER_HINTS = Object.freeze([
  "↑↓ Navigate",
  "Enter Open",
  "Space Select",
  "F8 Refresh",
  "Esc Back",
  "Ctrl+K Command Bar",
]);

export default function ErpMasterListTemplate({
  eyebrow,
  title,
  actions = [],
  notices = [],
  filterSection = null,
  listSection = null,
  bottomSection = null,
  footerHints = DEFAULT_FOOTER_HINTS,
}) {
  const showFilterHeader = Boolean(filterSection?.eyebrow || filterSection?.title);
  const showListHeader = Boolean(
    listSection?.eyebrow || listSection?.title || listSection?.count != null,
  );

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
            {showFilterHeader ? (
              <div className="grid gap-2">
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
              </div>
            ) : null}
            <div>{filterSection.children}</div>
          </section>
        ) : null}
        {listSection ? (
          <section className="grid gap-2">
            {showListHeader ? (
              <ErpRegisterHeader
                title={listSection.title ?? ""}
                count={listSection.count}
                filterValue={listSection.filterValue}
                onFilterChange={listSection.onFilterChange}
                filterRef={listSection.filterRef}
                filterPlaceholder={listSection.filterPlaceholder}
              />
            ) : null}
            {listSection.eyebrow && !showListHeader ? (
              <ErpSelectionSection label={listSection.eyebrow} />
            ) : null}
            {listSection.aside ? (
              <div className="justify-self-start">{listSection.aside}</div>
            ) : null}
            <div>{listSection.children}</div>
          </section>
        ) : null}
        {bottomSection ? <div>{bottomSection}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
