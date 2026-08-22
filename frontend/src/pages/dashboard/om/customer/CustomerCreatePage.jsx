/*
 * File-ID: 15.12
 * File-Path: frontend/src/pages/dashboard/om/customer/CustomerCreatePage.jsx
 * Gate: 15 / 113
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Standalone MM04 create page — wraps the shared CustomerCreateForm
 *          with a required Company dropdown (§113.7 "SELECT" mode). The
 *          inline SO01 "+New Customer" modal uses the same form in "LOCKED"
 *          mode instead.
 * Authority: Frontend
 */

import { useMemo } from "react";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import CustomerCreateForm from "./CustomerCreateForm.jsx";

export default function CustomerCreatePage() {
  const { runtimeContext } = useMenu();

  const companyOptions = useMemo(
    () => (runtimeContext?.availableCompanies ?? []).map((entry) => ({
      value: entry.id,
      label: entry.company_name || entry.company_code || entry.id,
    })),
    [runtimeContext?.availableCompanies]
  );

  function handleSaved(customer) {
    openScreen(OPERATION_SCREENS.OM_CUSTOMER_DETAIL.screen_code, { mode: "replace", context: { id: customer?.id } });
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="Operation Management"
      title="Create FG Sales Customer"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
      ]}
      formEyebrow="Customer Setup"
      formTitle="Create a new RM/PM sales customer row"
      formContent={
        <CustomerCreateForm
          companyMode="SELECT"
          companyOptions={companyOptions}
          onSaved={handleSaved}
          onCancel={() => popScreen()}
          submitLabel="Save Customer"
        />
      }
    />
  );
}
