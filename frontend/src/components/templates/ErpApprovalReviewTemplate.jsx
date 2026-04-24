/*
 * File-ID: 9.13-FRONT
 * File-Path: frontend/src/components/templates/ErpApprovalReviewTemplate.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Provide the keyboard-native approval and review template on the shared work-canvas grammar
 * Authority: Frontend
 */

import ErpScreenScaffold from "./ErpScreenScaffold.jsx";
import ErpSelectionSection from "../forms/ErpSelectionSection.jsx";
import ErpRegisterHeader from "../data/ErpRegisterHeader.jsx";

export default function ErpApprovalReviewTemplate({
  eyebrow,
  title,
  actions = [],
  notices = [],
  filterSection = null,
  reviewSection = null,
  bottomSection = null,
  footerHints = [
    "↑↓ Navigate",
    "Enter View",
    "A Approve",
    "R Reject",
    "F8 Refresh",
    "Esc Back",
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
        {reviewSection ? (
          <section className="grid gap-2">
            {reviewSection.eyebrow ? (
              <ErpSelectionSection label={reviewSection.eyebrow} />
            ) : null}
            {reviewSection.title != null ? (
              <ErpRegisterHeader
                title={reviewSection.title}
                count={reviewSection.count}
                filterValue={reviewSection.filterValue}
                onFilterChange={reviewSection.onFilterChange}
                filterRef={reviewSection.filterRef}
                filterPlaceholder={reviewSection.filterPlaceholder}
              />
            ) : null}
            {reviewSection.aside ? (
              <div className="justify-self-start">{reviewSection.aside}</div>
            ) : null}
            <div>{reviewSection.children}</div>
          </section>
        ) : null}
        {bottomSection ? <div>{bottomSection}</div> : null}
      </div>
    </ErpScreenScaffold>
  );
}
