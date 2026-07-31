/*
 * File-ID: 7.6B
 * File-Path: frontend/src/router/AppRouter.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Central route definition with snapshot-based guards
 * Authority: Frontend
 */

import { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ScrollToTop from "./ScrollToTop.jsx";
import { MenuProvider } from "../context/MenuProvider.jsx";
import AuthBootstrap from "../auth/AuthBootstrap.jsx";
import AuthResolver from "../admin/AuthResolver.jsx";
import LandingPage from "../pages/public/LandingPage.jsx";
import LoginScreen from "../pages/public/LoginScreen.jsx";
import SignupInstructions from "../pages/public/SignupInstructions.jsx";
import SignupScreen from "../pages/public/SignupPage.jsx";
import AuthCallback from "../pages/public/AuthCallback.jsx";
import EmailVerified from "../pages/public/EmailVerified.jsx";
import SignupSubmittedPage from "../pages/public/SignupSubmittedPage.jsx";
import ForgotPassword from "../pages/public/ForgotPassword.jsx";
import ResetPassword from "../pages/public/ResetPassword.jsx";
import MenuShell from "../layout/MenuShell.jsx";
import SessionWatchdog from "../components/SessionWatchdog.jsx";
import WorkspaceLockOverlay from "../components/WorkspaceLockOverlay.jsx";
import DashboardShell from "../layout/DashboardShell.jsx";
import NavigationStackBridge from "../navigation/NavigationStackBridge.jsx";
import ProtectedBranchShell from "./ProtectedBranchShell.jsx";
import SADashboardShell from "../admin/sa/SADashboardShell.jsx";
import GADashboardShell from "../admin/ga/GADashboardShell.jsx";
import SAControlPanel from "../admin/sa/screens/SAControlPanel.jsx";
import SAAudit from "../admin/sa/screens/SAAudit.jsx";
import SAAuditDetail from "../admin/sa/screens/SAAuditDetail.jsx";
import SACompanyCreate from "../admin/sa/screens/SACompanyCreate.jsx";
import SACompanyManage from "../admin/sa/screens/SACompanyManage.jsx";
import SADepartmentMaster from "../admin/sa/screens/SADepartmentMaster.jsx";
import SAWorkContextMaster from "../admin/sa/screens/SAWorkContextMaster.jsx";
import SAGroupGovernance from "../admin/sa/screens/SAGroupGovernance.jsx";
import SASessions from "../admin/sa/screens/SASessions.jsx";
import SASystemHealth from "../admin/sa/screens/SASystemHealth.jsx";
import SAUsers from "../admin/sa/screens/SAUsers.jsx";
import SAUserRoles from "../admin/sa/screens/SAUserRoles.jsx";
import SAUserScope from "../admin/sa/screens/SAUserScope.jsx";
import SAUserScopeReport from "../admin/sa/screens/SAUserScopeReport.jsx";
import SAGovernanceSummaryReport from "../admin/sa/screens/SAGovernanceSummaryReport.jsx";
import SASignupRequests from "../admin/sa/screens/SASignupRequests.jsx";
import SAProjectMaster from "../admin/sa/screens/SAProjectMaster.jsx";
import SAProjectManage from "../admin/sa/screens/SAProjectManage.jsx";
import SACompanyProjectMap from "../admin/sa/screens/SACompanyProjectMap.jsx";
import SAModuleMaster from "../admin/sa/screens/SAModuleMaster.jsx";
import SAPageResourceRegistry from "../admin/sa/screens/SAPageResourceRegistry.jsx";
import SAModuleResourceMap from "../admin/sa/screens/SAModuleResourceMap.jsx";
import SARolePermissions from "../admin/sa/screens/SARolePermissions.jsx";
import SACapabilityGovernance from "../admin/sa/screens/SACapabilityGovernance.jsx";
import SAAclVersionCenter from "../admin/sa/screens/SAAclVersionCenter.jsx";
import SAApprovalRules from "../admin/sa/screens/SAApprovalRules.jsx";
import SAApprovalPolicy from "../admin/sa/screens/SAApprovalPolicy.jsx";
import SAReportVisibility from "../admin/sa/screens/SAReportVisibility.jsx";
import SACompanyModuleMap from "../admin/sa/screens/SACompanyModuleMap.jsx";
import SAMenuGovernance from "../admin/sa/screens/SAMenuGovernance.jsx";
import SAOmUomMaster from "../admin/sa/screens/SAOmUomMaster.jsx";
import SAOmStorageLocations from "../admin/sa/screens/SAOmStorageLocations.jsx";
import SAOmNumberSeries from "../admin/sa/screens/SAOmNumberSeries.jsx";
import SACostCenterMaster from "../admin/sa/screens/SACostCenterMaster.jsx";
import SAMachineMaster from "../admin/sa/screens/SAMachineMaster.jsx";
import SAMaterialMaster from "../admin/sa/screens/SAMaterialMaster.jsx";
import SAVendorMaster from "../admin/sa/screens/SAVendorMaster.jsx";
import SAProductionBatchSeriesPage from "../admin/sa/screens/SAProductionBatchSeriesPage.jsx";
import SAProductionSegmentLocationPage from "../admin/sa/screens/SAProductionSegmentLocationPage.jsx";
import SAPackCodeMasterPage from "../admin/sa/screens/SAPackCodeMasterPage.jsx";
import SAHome from "../admin/sa/screens/SAHome.jsx";
import GAHome from "../admin/ga/screens/GAHome.jsx";
import UserDashboardHome from "../pages/dashboard/UserDashboardHome.jsx";
import LeaveApplyPage from "../pages/dashboard/hr/leave/LeaveApplyPage.jsx";
import LeaveMyRequestsPage from "../pages/dashboard/hr/leave/LeaveMyRequestsPage.jsx";
import LeaveApprovalInboxPage from "../pages/dashboard/hr/leave/LeaveApprovalInboxPage.jsx";
import LeaveRequestDetailPage from "../pages/dashboard/hr/leave/LeaveRequestDetailPage.jsx";
import LeaveApprovalScopeHistoryPage from "../pages/dashboard/hr/leave/LeaveApprovalScopeHistoryPage.jsx";
import LeaveRegisterPage from "../pages/dashboard/hr/leave/LeaveRegisterPage.jsx";
import LeaveRegisterResultsPage from "../pages/dashboard/hr/leave/LeaveRegisterResultsPage.jsx";
import LeaveTypeManagementPage from "../pages/dashboard/hr/leave/LeaveTypeManagementPage.jsx";
import OutWorkApplyPage from "../pages/dashboard/hr/outWork/OutWorkApplyPage.jsx";
import OutWorkMyRequestsPage from "../pages/dashboard/hr/outWork/OutWorkMyRequestsPage.jsx";
import OutWorkApprovalInboxPage from "../pages/dashboard/hr/outWork/OutWorkApprovalInboxPage.jsx";
import OutWorkRequestDetailPage from "../pages/dashboard/hr/outWork/OutWorkRequestDetailPage.jsx";
import OutWorkApprovalScopeHistoryPage from "../pages/dashboard/hr/outWork/OutWorkApprovalScopeHistoryPage.jsx";
import OutWorkRegisterPage from "../pages/dashboard/hr/outWork/OutWorkRegisterPage.jsx";
import OutWorkRegisterResultsPage from "../pages/dashboard/hr/outWork/OutWorkRegisterResultsPage.jsx";
import HolidayCalendarPage from "../pages/dashboard/hr/calendar/HolidayCalendarPage.jsx";
import HrAttendanceCorrectionPage from "../pages/dashboard/hr/attendance/HrAttendanceCorrectionPage.jsx";
import HrCorrectionPendingListPage from "../pages/dashboard/hr/attendance/HrCorrectionPendingListPage.jsx";
import HrCorrectionRequestDetailPage from "../pages/dashboard/hr/attendance/HrCorrectionRequestDetailPage.jsx";
import HrCorrectionApprovalInboxPage from "../pages/dashboard/hr/attendance/HrCorrectionApprovalInboxPage.jsx";
import HrCorrectionApprovalHistoryPage from "../pages/dashboard/hr/attendance/HrCorrectionApprovalHistoryPage.jsx";
import HrMonthlyAttendanceSummaryPage from "../pages/dashboard/hr/attendance/HrMonthlyAttendanceSummaryPage.jsx";
import HrDailyAttendanceRegisterPage from "../pages/dashboard/hr/attendance/HrDailyAttendanceRegisterPage.jsx";
import HrYearlyLeaveSummaryPage from "../pages/dashboard/hr/attendance/HrYearlyLeaveSummaryPage.jsx";
import HrDepartmentAttendanceReportPage from "../pages/dashboard/hr/attendance/HrDepartmentAttendanceReportPage.jsx";
import HrLeaveUsageReportPage from "../pages/dashboard/hr/attendance/HrLeaveUsageReportPage.jsx";
import MaterialListPage from "../pages/dashboard/om/material/MaterialListPage.jsx";
import MaterialDetailPage from "../pages/dashboard/om/material/MaterialDetailPage.jsx";
import VendorListPage from "../pages/dashboard/om/vendor/VendorListPage.jsx";
import VendorDetailPage from "../pages/dashboard/om/vendor/VendorDetailPage.jsx";
import AslListPage from "../pages/dashboard/om/asl/AslListPage.jsx";
import AslCreatePage from "../pages/dashboard/om/asl/AslCreatePage.jsx";
import AslDetailPage from "../pages/dashboard/om/asl/AslDetailPage.jsx";
import CustomerListPage from "../pages/dashboard/om/customer/CustomerListPage.jsx";
import CustomerCreatePage from "../pages/dashboard/om/customer/CustomerCreatePage.jsx";
import CustomerDetailPage from "../pages/dashboard/om/customer/CustomerDetailPage.jsx";
import FgDispatchCustomerPage from "../pages/dashboard/om/FgDispatchCustomerPage.jsx";
import POListPage from "../pages/dashboard/procurement/po/POListPage.jsx";
import POCreatePage from "../pages/dashboard/procurement/po/POCreatePage.jsx";
import POCreateOpeningPage from "../pages/dashboard/procurement/po/POCreateOpeningPage.jsx";
import PODetailPage from "../pages/dashboard/procurement/po/PODetailPage.jsx";
import POOrderGroupListPage from "../pages/dashboard/procurement/po/POOrderGroupListPage.jsx";
import POOrderGroupDetailPage from "../pages/dashboard/procurement/po/POOrderGroupDetailPage.jsx";
import CSNTrackerPage from "../pages/dashboard/procurement/csn/CSNTrackerPage.jsx";
import CSNDetailPage from "../pages/dashboard/procurement/csn/CSNDetailPage.jsx";
import CSNAlertsPage from "../pages/dashboard/procurement/csn/CSNAlertsPage.jsx";
import GateEntryListPage from "../pages/dashboard/procurement/gate/GateEntryListPage.jsx";
import GateEntryCreatePage from "../pages/dashboard/procurement/gate/GateEntryCreatePage.jsx";
import GateEntryDetailPage from "../pages/dashboard/procurement/gate/GateEntryDetailPage.jsx";
import GateExitInboundDetailPage from "../pages/dashboard/procurement/gate/GateExitInboundDetailPage.jsx";
import GateExitEntryPage from "../pages/dashboard/procurement/gate/GateExitEntryPage.jsx";
import GateReportPage from "../pages/dashboard/procurement/gate/GateReportPage.jsx";
import GRNListPage from "../pages/dashboard/procurement/grn/GRNListPage.jsx";
import GRNDetailPage from "../pages/dashboard/procurement/grn/GRNDetailPage.jsx";
import GRNPostFlow from "../pages/dashboard/procurement/grn/GRNPostFlow.jsx";
import QAQueuePage from "../pages/dashboard/procurement/qa/QAQueuePage.jsx";
import STOListPage from "../pages/dashboard/procurement/sto/STOListPage.jsx";
import STOCreatePage from "../pages/dashboard/procurement/sto/STOCreatePage.jsx";
import STOCreateOpeningPage from "../pages/dashboard/procurement/sto/STOCreateOpeningPage.jsx";
import STODetailPage from "../pages/dashboard/procurement/sto/STODetailPage.jsx";
import RTVListPage from "../pages/dashboard/procurement/rtv/RTVListPage.jsx";
import RTVCreatePage from "../pages/dashboard/procurement/rtv/RTVCreatePage.jsx";
import RTVDetailPage from "../pages/dashboard/procurement/rtv/RTVDetailPage.jsx";
import DebitNoteListPage from "../pages/dashboard/procurement/rtv/DebitNoteListPage.jsx";
import DebitNoteDetailPage from "../pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx";
import ExchangeRefListPage from "../pages/dashboard/procurement/rtv/ExchangeRefListPage.jsx";
import IVListPage from "../pages/dashboard/procurement/accounts/IVListPage.jsx";
import IVCreatePage from "../pages/dashboard/procurement/accounts/IVCreatePage.jsx";
import IVDetailPage from "../pages/dashboard/procurement/accounts/IVDetailPage.jsx";
import BlockedIVListPage from "../pages/dashboard/procurement/accounts/BlockedIVListPage.jsx";
import ProcurementPlanningPage from "../pages/dashboard/procurement/planning/ProcurementPlanningPage.jsx";
import PlantTransferListPage from "../pages/dashboard/procurement/transfer/PlantTransferListPage.jsx";
import PlantTransferDetailPage from "../pages/dashboard/procurement/transfer/PlantTransferDetailPage.jsx";
import PaymentTermsMasterPage from "../pages/dashboard/procurement/masters/PaymentTermsMasterPage.jsx";
import PortMasterPage from "../pages/dashboard/procurement/masters/PortMasterPage.jsx";
import PortTransitMasterPage from "../pages/dashboard/procurement/masters/PortTransitMasterPage.jsx";
import MaterialCategoryMasterPage from "../pages/dashboard/procurement/masters/MaterialCategoryMasterPage.jsx";
import ImportLeadTimeMasterPage from "../pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx";
import TransporterMasterPage from "../pages/dashboard/procurement/masters/TransporterMasterPage.jsx";
import CHAMasterPage from "../pages/dashboard/procurement/masters/CHAMasterPage.jsx";
import StockLedgerReportPage from "../pages/dashboard/procurement/reports/StockLedgerReportPage.jsx";
import CurrentStockPage from "../pages/dashboard/procurement/reports/CurrentStockPage.jsx";
import StockValuationPage from "../pages/dashboard/procurement/reports/StockValuationPage.jsx";
import LandedCostListPage from "../pages/dashboard/procurement/accounts/LandedCostListPage.jsx";
import LandedCostDetailPage from "../pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx";
import SOListPage from "../pages/dashboard/procurement/sales/SOListPage.jsx";
import SOCreatePage from "../pages/dashboard/procurement/sales/SOCreatePage.jsx";
import SODetailPage from "../pages/dashboard/procurement/sales/SODetailPage.jsx";
import DOListPage from "../pages/dashboard/procurement/sales/DOListPage.jsx";
import DOCreatePage from "../pages/dashboard/procurement/sales/DOCreatePage.jsx";
import PgiInvoiceCreatePage from "../pages/dashboard/procurement/sales/PgiInvoiceCreatePage.jsx";
import DODetailPage from "../pages/dashboard/procurement/sales/DODetailPage.jsx";
import SalesInvoiceListPage from "../pages/dashboard/procurement/sales/SalesInvoiceListPage.jsx";
import SalesInvoiceDetailPage from "../pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx";
import PIDocumentListPage from "../pages/dashboard/procurement/inventory/PIDocumentListPage.jsx";
import PIDocumentDetailPage from "../pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx";
import OpeningStockListPage from "../pages/dashboard/procurement/opening-stock/OpeningStockListPage.jsx";
import OpeningStockDetailPage from "../pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx";
import OpeningStockApprovalPage from "../pages/dashboard/procurement/opening-stock/OpeningStockApprovalPage.jsx";

// Gate-27: L3 Production pages
import PlanFeedPage from "../pages/dashboard/production/PlanFeedPage.jsx";
import StrokeMasterPage from "../pages/dashboard/production/StrokeMasterPage.jsx";
import StrokeApprovalPage from "../pages/dashboard/production/StrokeApprovalPage.jsx";
import ChangeBomItemPage from "../pages/dashboard/production/ChangeBomItemPage.jsx";
import ChangeBomItemApprovalPage from "../pages/dashboard/production/ChangeBomItemApprovalPage.jsx";
import PackBomCreatePage from "../pages/dashboard/production/PackBomCreatePage.jsx";
import PackBomApprovalPage from "../pages/dashboard/production/PackBomApprovalPage.jsx";
import ChangePackBomPage from "../pages/dashboard/production/ChangePackBomPage.jsx";
import ChangePackBomApprovalPage from "../pages/dashboard/production/ChangePackBomApprovalPage.jsx";
import ProductionPOCreatePage from "../pages/dashboard/production/ProductionPOCreatePage.jsx";
import ProductionPOEditPage from "../pages/dashboard/production/ProductionPOEditPage.jsx";
import ProductionPOFinalPage from "../pages/dashboard/production/ProductionPOFinalPage.jsx";
import ProductionPOVerifyPage from "../pages/dashboard/production/ProductionPOVerifyPage.jsx";
import OrderListPage from "../pages/dashboard/production/OrderListPage.jsx";
import BatchVariancePage from "../pages/dashboard/production/BatchVariancePage.jsx";
import ReversalPage from "../pages/dashboard/production/ReversalPage.jsx";
import ProductionQAQueuePage from "../pages/dashboard/production/QAQueuePage.jsx";
import BatchNumberReleasePage from "../pages/dashboard/production/BatchNumberReleasePage.jsx";
import SfgResultRecordingPage from "../pages/dashboard/production/SfgResultRecordingPage.jsx";
import FgStockBreakdownPage from "../pages/dashboard/production/FgStockBreakdownPage.jsx";
import PartialBatchReversalPage from "../pages/dashboard/production/PartialBatchReversalPage.jsx";
import ConversionCostPage from "../pages/dashboard/production/ConversionCostPage.jsx";
import MtsSkuMonthlyRatePage from "../pages/dashboard/production/MtsSkuMonthlyRatePage.jsx";
import OldProcessPoPage from "../pages/dashboard/production/OldProcessPoPage.jsx";
import OldPackingPoPage from "../pages/dashboard/production/OldPackingPoPage.jsx";
import PartialReversalReportPage from "../pages/dashboard/production/PartialReversalReportPage.jsx";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <WorkspaceLockOverlay />

      <div id="app-shell">
        <MenuProvider>
          <AuthBootstrap>
            <SessionWatchdog />
            <NavigationStackBridge />

            <Suspense fallback={null}>
              <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginScreen />} />
              <Route
                path="/signup-instructions"
                element={<SignupInstructions />}
              />
              <Route path="/signup" element={<SignupScreen />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/email-verified" element={<EmailVerified />} />
              <Route
                path="/signup-submitted"
                element={<SignupSubmittedPage />}
              />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/app" element={<AuthResolver />} />

              <Route
                path="/sa"
                element={
                  <ProtectedBranchShell
                    rootScreenCode="SA_HOME"
                    routePrefix="/sa"
                  />
                }
              >
                <Route element={<SADashboardShell />}>
                  <Route element={<MenuShell />}>
                    <Route path="home" element={<SAHome />} />
                    <Route
                      path="control-panel"
                      element={<SAControlPanel />}
                    />
                    <Route path="audit" element={<SAAudit />} />
                    <Route path="audit/detail" element={<SAAuditDetail />} />
                    <Route path="sessions" element={<SASessions />} />
                    <Route
                      path="system-health"
                      element={<SASystemHealth />}
                    />
                    <Route
                      path="company/create"
                      element={<SACompanyCreate />}
                    />
                    <Route
                      path="company/manage"
                      element={<SACompanyManage />}
                    />
                    <Route
                      path="department-master"
                      element={<SADepartmentMaster />}
                    />
                    <Route
                      path="work-contexts"
                      element={<SAWorkContextMaster />}
                    />
                    <Route path="groups" element={<SAGroupGovernance />} />
                    <Route path="users" element={<SAUsers />} />
                    <Route path="users/roles" element={<SAUserRoles />} />
                    <Route path="users/scope" element={<SAUserScope />} />
                    <Route path="users/report" element={<SAUserScopeReport />} />
                    <Route
                      path="acl/governance-summary-report"
                      element={<SAGovernanceSummaryReport />}
                    />
                    <Route path="project-master" element={<SAProjectMaster />} />
                    <Route path="projects/manage" element={<SAProjectManage />} />
                    <Route path="projects/map" element={<SACompanyProjectMap />} />
                    <Route path="module-master" element={<SAModuleMaster />} />
                    <Route path="page-registry" element={<SAPageResourceRegistry />} />
                    <Route path="module-pages" element={<SAModuleResourceMap />} />
                    <Route
                      path="acl/role-permissions"
                      element={<SARolePermissions />}
                    />
                    <Route
                      path="acl/capabilities"
                      element={<SACapabilityGovernance />}
                    />
                    <Route
                      path="acl/version-center"
                      element={<SAAclVersionCenter />}
                    />
                    <Route
                      path="approval-rules"
                      element={<SAApprovalRules />}
                    />
                    <Route
                      path="approval-policy"
                      element={<SAApprovalPolicy />}
                    />
                    <Route
                      path="report-visibility"
                      element={<SAReportVisibility />}
                    />
                    <Route
                      path="acl/company-modules"
                      element={<SACompanyModuleMap />}
                    />
                    <Route path="menu" element={<SAMenuGovernance />} />
                    <Route
                      path="signup-requests"
                      element={<SASignupRequests />}
                    />
                    <Route path="om/uom-master" element={<SAOmUomMaster />} />
                    <Route
                      path="om/storage-locations"
                      element={<SAOmStorageLocations />}
                    />
                    <Route
                      path="om/number-series"
                      element={<SAOmNumberSeries />}
                    />
                    <Route
                      path="om/cost-centers"
                      element={<SACostCenterMaster />}
                    />
                    <Route
                      path="om/machines"
                      element={<SAMachineMaster />}
                    />
                    <Route
                      path="om/materials"
                      element={<SAMaterialMaster />}
                    />
                    <Route path="om/vendors" element={<SAVendorMaster />} />

                    {/* Gate-27: L3 Production SA config */}
                    <Route
                      path="om/pack-code-master"
                      element={<SAPackCodeMasterPage />}
                    />
                    <Route
                      path="production/batch-series"
                      element={<SAProductionBatchSeriesPage />}
                    />
                    <Route
                      path="production/segment-locations"
                      element={<SAProductionSegmentLocationPage />}
                    />

                  </Route>
                </Route>
              </Route>

              <Route
                path="/ga"
                element={
                  <ProtectedBranchShell
                    rootScreenCode="GA_HOME"
                    routePrefix="/ga"
                  />
                }
              >
                <Route element={<GADashboardShell />}>
                  <Route element={<MenuShell />}>
                    <Route path="home" element={<GAHome />} />
                  </Route>
                </Route>
              </Route>

              <Route
                path="/dashboard"
                element={
                  <ProtectedBranchShell
                    rootScreenCode="DASHBOARD_HOME"
                    routePrefix="/dashboard"
                  />
                }
              >
                <Route element={<DashboardShell />}>
                  <Route index element={<UserDashboardHome />} />
                  <Route path="hr/leave/apply" element={<LeaveApplyPage />} />
                  <Route
                    path="hr/leave/my-requests"
                    element={<LeaveMyRequestsPage />}
                  />
                  <Route
                    path="hr/leave/request-detail"
                    element={<LeaveRequestDetailPage />}
                  />
                  <Route
                    path="hr/leave/approval-inbox"
                    element={<LeaveApprovalInboxPage />}
                  />
                  <Route
                    path="hr/leave/approval-history"
                    element={<LeaveApprovalScopeHistoryPage />}
                  />
                  <Route path="hr/leave/register" element={<LeaveRegisterPage />} />
                  <Route
                    path="hr/leave/register/results"
                    element={<LeaveRegisterResultsPage />}
                  />
                  <Route
                    path="hr/leave/types"
                    element={<LeaveTypeManagementPage />}
                  />
                  <Route
                    path="hr/out-work/apply"
                    element={<OutWorkApplyPage />}
                  />
                  <Route
                    path="hr/out-work/my-requests"
                    element={<OutWorkMyRequestsPage />}
                  />
                  <Route
                    path="hr/out-work/request-detail"
                    element={<OutWorkRequestDetailPage />}
                  />
                  <Route
                    path="hr/out-work/approval-inbox"
                    element={<OutWorkApprovalInboxPage />}
                  />
                  <Route
                    path="hr/out-work/approval-history"
                    element={<OutWorkApprovalScopeHistoryPage />}
                  />
                  <Route
                    path="hr/out-work/register"
                    element={<OutWorkRegisterPage />}
                  />
                  <Route
                    path="hr/out-work/register/results"
                    element={<OutWorkRegisterResultsPage />}
                  />
                  <Route
                    path="hr/calendar/holidays"
                    element={<HolidayCalendarPage />}
                  />
                  <Route
                    path="hr/attendance/correction"
                    element={<HrAttendanceCorrectionPage />}
                  />
                  <Route
                    path="hr/attendance/correction/my-requests"
                    element={<HrCorrectionPendingListPage />}
                  />
                  <Route
                    path="hr/attendance/correction/detail"
                    element={<HrCorrectionRequestDetailPage />}
                  />
                  <Route
                    path="hr/attendance/correction/approval-inbox"
                    element={<HrCorrectionApprovalInboxPage />}
                  />
                  <Route
                    path="hr/attendance/correction/approval-history"
                    element={<HrCorrectionApprovalHistoryPage />}
                  />
                  <Route
                    path="hr/attendance/monthly-summary"
                    element={<HrMonthlyAttendanceSummaryPage />}
                  />
                  <Route
                    path="hr/attendance/daily-register"
                    element={<HrDailyAttendanceRegisterPage />}
                  />
                  <Route
                    path="hr/attendance/yearly-leave-summary"
                    element={<HrYearlyLeaveSummaryPage />}
                  />
                  <Route
                    path="hr/attendance/department-report"
                    element={<HrDepartmentAttendanceReportPage />}
                  />
                  <Route
                    path="hr/attendance/leave-usage"
                    element={<HrLeaveUsageReportPage />}
                  />
                  <Route path="om/materials" element={<MaterialListPage />} />
                  <Route
                    path="om/material/detail"
                    element={<MaterialDetailPage />}
                  />
                  <Route path="om/vendors" element={<VendorListPage />} />
                  <Route
                    path="om/vendor/detail"
                    element={<VendorDetailPage />}
                  />
                  <Route
                    path="om/vendor-material-infos"
                    element={<AslListPage />}
                  />
                  <Route
                    path="om/vendor-material-info/create"
                    element={<AslCreatePage />}
                  />
                  <Route
                    path="om/vendor-material-info/detail"
                    element={<AslDetailPage />}
                  />
                  <Route path="om/customers" element={<CustomerListPage />} />
                  <Route
                    path="om/customer/create"
                    element={<CustomerCreatePage />}
                  />
                  <Route
                    path="om/customer/detail"
                    element={<CustomerDetailPage />}
                  />
                  <Route
                    path="om/fg-dispatch-customers"
                    element={<FgDispatchCustomerPage />}
                  />
                  <Route
                    path="procurement/purchase-orders"
                    element={<POListPage />}
                  />
                  <Route
                    path="procurement/purchase-orders/create"
                    element={<POCreatePage />}
                  />
                  <Route
                    path="procurement/purchase-orders/create-opening"
                    element={<POCreateOpeningPage />}
                  />
                  <Route
                    path="procurement/purchase-orders/:id"
                    element={<PODetailPage />}
                  />
                  <Route
                    path="procurement/po-order-groups"
                    element={<POOrderGroupListPage />}
                  />
                  <Route
                    path="procurement/po-order-groups/:id"
                    element={<POOrderGroupDetailPage />}
                  />
                  <Route
                    path="procurement/csn-tracker"
                    element={<CSNTrackerPage />}
                  />
                  <Route
                    path="procurement/csns/:id"
                    element={<CSNDetailPage />}
                  />
                  <Route
                    path="procurement/csn-alerts"
                    element={<CSNAlertsPage />}
                  />
                  <Route
                    path="procurement/gate-entries"
                    element={<GateEntryListPage />}
                  />
                  <Route
                    path="procurement/gate-entries/create"
                    element={<GateEntryCreatePage />}
                  />
                  <Route
                    path="procurement/gate-entries/:id"
                    element={<GateEntryDetailPage />}
                  />
                  <Route
                    path="procurement/gate-exits/inbound/:id"
                    element={<GateExitInboundDetailPage />}
                  />
                  <Route
                    path="procurement/gate-exit"
                    element={<GateExitEntryPage />}
                  />
                  <Route
                    path="procurement/gate-report"
                    element={<GateReportPage />}
                  />
                  <Route
                    path="procurement/grns"
                    element={<GRNListPage />}
                  />
                  <Route
                    path="procurement/grns/post"
                    element={<GRNPostFlow />}
                  />
                  <Route
                    path="procurement/grns/:id"
                    element={<GRNDetailPage />}
                  />
                  <Route
                    path="procurement/qa-queue"
                    element={<QAQueuePage />}
                  />
                  <Route
                    path="procurement/stos"
                    element={<STOListPage />}
                  />
                  <Route
                    path="procurement/stos/create"
                    element={<STOCreatePage />}
                  />
                  <Route
                    path="procurement/stos/create-opening"
                    element={<STOCreateOpeningPage />}
                  />
                  <Route
                    path="procurement/stos/:id"
                    element={<STODetailPage />}
                  />
                  <Route
                    path="procurement/rtvs"
                    element={<RTVListPage />}
                  />
                  <Route
                    path="procurement/rtvs/create"
                    element={<RTVCreatePage />}
                  />
                  <Route
                    path="procurement/rtvs/:id"
                    element={<RTVDetailPage />}
                  />
                  <Route
                    path="procurement/debit-notes"
                    element={<DebitNoteListPage />}
                  />
                  <Route
                    path="procurement/debit-notes/:id"
                    element={<DebitNoteDetailPage />}
                  />
                  <Route
                    path="procurement/exchange-refs"
                    element={<ExchangeRefListPage />}
                  />
                  <Route
                    path="procurement/accounts/invoice-verifications"
                    element={<IVListPage />}
                  />
                  <Route
                    path="procurement/accounts/invoice-verifications/create"
                    element={<IVCreatePage />}
                  />
                  <Route
                    path="procurement/accounts/invoice-verifications/:id"
                    element={<IVDetailPage />}
                  />
                  <Route
                    path="procurement/accounts/blocked-ivs"
                    element={<BlockedIVListPage />}
                  />
                  <Route
                    path="procurement/planning"
                    element={<ProcurementPlanningPage />}
                  />
                  <Route
                    path="procurement/transfer"
                    element={<PlantTransferListPage />}
                  />
                  <Route
                    path="procurement/transfer/:id"
                    element={<PlantTransferDetailPage />}
                  />
                  <Route
                    path="procurement/masters/payment-terms"
                    element={<PaymentTermsMasterPage />}
                  />
                  <Route
                    path="procurement/masters/ports"
                    element={<PortMasterPage />}
                  />
                  <Route
                    path="procurement/masters/port-transit"
                    element={<PortTransitMasterPage />}
                  />
                  <Route
                    path="procurement/masters/material-categories"
                    element={<MaterialCategoryMasterPage />}
                  />
                  <Route
                    path="procurement/masters/lead-times"
                    element={<ImportLeadTimeMasterPage />}
                  />
                  <Route
                    path="procurement/masters/transporters"
                    element={<TransporterMasterPage />}
                  />
                  <Route
                    path="procurement/masters/cha"
                    element={<CHAMasterPage />}
                  />
                  <Route
                    path="procurement/reports/stock-ledger"
                    element={<StockLedgerReportPage />}
                  />
                  <Route
                    path="procurement/reports/current-stock"
                    element={<CurrentStockPage />}
                  />
                  <Route
                    path="procurement/reports/stock-valuation"
                    element={<StockValuationPage />}
                  />
                  <Route
                    path="procurement/accounts/landed-costs"
                    element={<LandedCostListPage />}
                  />
                  <Route
                    path="procurement/accounts/landed-costs/:id"
                    element={<LandedCostDetailPage />}
                  />
                  <Route
                    path="procurement/sales-orders"
                    element={<SOListPage />}
                  />
                  <Route
                    path="procurement/sales-orders/create"
                    element={<SOCreatePage />}
                  />
                  <Route
                    path="procurement/sales-orders/:id"
                    element={<SODetailPage />}
                  />
                  <Route
                    path="procurement/delivery-orders"
                    element={<DOListPage />}
                  />
                  <Route
                    path="procurement/delivery-orders/create"
                    element={<DOCreatePage />}
                  />
                  <Route
                    path="procurement/delivery-orders/:id"
                    element={<DODetailPage />}
                  />
                  <Route
                    path="procurement/sales-invoices"
                    element={<SalesInvoiceListPage />}
                  />
                  <Route
                    path="procurement/sales-invoices/pgi/create"
                    element={<PgiInvoiceCreatePage />}
                  />
                  <Route
                    path="procurement/sales-invoices/:id"
                    element={<SalesInvoiceDetailPage />}
                  />
                  <Route
                    path="procurement/opening-stock"
                    element={<OpeningStockListPage />}
                  />
                  <Route
                    path="procurement/opening-stock/:id"
                    element={<OpeningStockDetailPage />}
                  />
                  <Route
                    path="procurement/opening-stock/approval"
                    element={<OpeningStockApprovalPage />}
                  />
                  <Route
                    path="procurement/physical-inventory"
                    element={<PIDocumentListPage />}
                  />
                  <Route
                    path="procurement/physical-inventory/:id"
                    element={<PIDocumentDetailPage />}
                  />

                  {/* ── Gate-27: L3 Production (PR00–PR17) ──────────── */}
                  <Route path="production/plan-feed" element={<PlanFeedPage />} />
                  <Route path="production/stroke-master" element={<StrokeMasterPage />} />
                  <Route path="production/stroke-approval" element={<StrokeApprovalPage />} />
                  <Route path="production/change-bom-item" element={<ChangeBomItemPage />} />
                  <Route path="production/change-bom-approval" element={<ChangeBomItemApprovalPage />} />
                  <Route path="production/pack-bom-create" element={<PackBomCreatePage />} />
                  <Route path="production/pack-bom-approval" element={<PackBomApprovalPage />} />
                  <Route path="production/change-pack-bom" element={<ChangePackBomPage />} />
                  <Route path="production/change-pack-bom-approval" element={<ChangePackBomApprovalPage />} />
                  <Route path="production/po-create" element={<ProductionPOCreatePage />} />
                  <Route path="production/po-edit" element={<ProductionPOEditPage />} />
                  <Route path="production/po-final" element={<ProductionPOFinalPage />} />
                  <Route path="production/po-verify" element={<ProductionPOVerifyPage />} />
                  <Route path="production/order-list" element={<OrderListPage />} />
                  <Route path="production/batch-variance" element={<BatchVariancePage />} />
                  <Route path="production/reversal" element={<ReversalPage />} />
                  <Route path="production/qa-queue" element={<ProductionQAQueuePage />} />
                  <Route path="production/sfg-result-recording" element={<SfgResultRecordingPage />} />
                  <Route path="production/batch-release" element={<BatchNumberReleasePage />} />
                  <Route path="production/fg-stock-breakdown" element={<FgStockBreakdownPage />} />
                  <Route path="production/partial-batch-reversal" element={<PartialBatchReversalPage />} />
                  <Route path="production/partial-reversal-report" element={<PartialReversalReportPage />} />
                  <Route path="production/conversion-cost" element={<ConversionCostPage />} />
                  <Route path="production/mts-sku-monthly-rate" element={<MtsSkuMonthlyRatePage />} />
                  <Route path="production/old-process-po" element={<OldProcessPoPage />} />
                  <Route path="production/old-packing-po" element={<OldPackingPoPage />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AuthBootstrap>
        </MenuProvider>
      </div>
    </BrowserRouter>
  );
}
