/*
 * File-ID: 27.FE-PR24-MTS-REGISTER-MODAL
 * File-Path: frontend/src/pages/dashboard/production/MtsRegisterModal.jsx
 * Gate: 27
 * Domain: PRODUCTION
 * Purpose: PR24 "MTS Production Register" Company + Production Date range modal. See feasibility doc §143.
 * Authority: Frontend
 */

import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";

export default function MtsRegisterModal({ runtimeContext, companyId, dateFrom, dateTo, error, onChange, onSubmit, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-sm rounded border border-slate-200 bg-white p-4 shadow-lg">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">MTS Production Register — select company and production date range</h3>
        {error ? <p className="mb-2 text-xs font-medium text-rose-600">{error}</p> : null}
        <div className="flex flex-col gap-3">
          <TransactionCompanySelector
            runtimeContext={runtimeContext}
            value={companyId}
            onChange={(value) => onChange("companyId", value)}
            label="Company"
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Production Date From</label>
            <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={dateFrom} onChange={(e) => onChange("dateFrom", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Production Date To</label>
            <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={dateTo} onChange={(e) => onChange("dateTo", e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={onSubmit} className="rounded bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">View Register</button>
        </div>
      </div>
    </div>
  );
}
