/*
 * File-ID: 7.6B
 * File-Path: frontend/src/router/AppRouter.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Central route definition with snapshot-based guards
 * Authority: Frontend
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import SACompanyCreate from "../admin/sa/screens/SACompanyCreate.jsx";
import SACompanyManage from "../admin/sa/screens/SACompanyManage.jsx";
import SADepartmentMaster from "../admin/sa/screens/SADepartmentMaster.jsx";
import SAGroupGovernance from "../admin/sa/screens/SAGroupGovernance.jsx";
import SASessions from "../admin/sa/screens/SASessions.jsx";
import SASystemHealth from "../admin/sa/screens/SASystemHealth.jsx";
import SAUsers from "../admin/sa/screens/SAUsers.jsx";
import SAUserRoles from "../admin/sa/screens/SAUserRoles.jsx";
import SAUserScope from "../admin/sa/screens/SAUserScope.jsx";
import SASignupRequests from "../admin/sa/screens/SASignupRequests.jsx";
import SAProjectMaster from "../admin/sa/screens/SAProjectMaster.jsx";
import SAProjectManage from "../admin/sa/screens/SAProjectManage.jsx";
import SACompanyProjectMap from "../admin/sa/screens/SACompanyProjectMap.jsx";
import SARolePermissions from "../admin/sa/screens/SARolePermissions.jsx";
import SACapabilityGovernance from "../admin/sa/screens/SACapabilityGovernance.jsx";
import SAApprovalRules from "../admin/sa/screens/SAApprovalRules.jsx";
import SACompanyModuleMap from "../admin/sa/screens/SACompanyModuleMap.jsx";
import SAMenuGovernance from "../admin/sa/screens/SAMenuGovernance.jsx";
import SAHome from "../admin/sa/screens/SAHome.jsx";
import GAHome from "../admin/ga/screens/GAHome.jsx";
import UserDashboardHome from "../pages/dashboard/UserDashboardHome.jsx";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <WorkspaceLockOverlay />

      <div id="app-shell">
        <MenuProvider>
          <AuthBootstrap>
            <SessionWatchdog />
            <NavigationStackBridge />

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
                    <Route path="groups" element={<SAGroupGovernance />} />
                    <Route path="users" element={<SAUsers />} />
                    <Route path="users/roles" element={<SAUserRoles />} />
                    <Route path="users/scope" element={<SAUserScope />} />
                    <Route path="project-master" element={<SAProjectMaster />} />
                    <Route path="projects/manage" element={<SAProjectManage />} />
                    <Route path="projects/map" element={<SACompanyProjectMap />} />
                    <Route
                      path="acl/role-permissions"
                      element={<SARolePermissions />}
                    />
                    <Route
                      path="acl/capabilities"
                      element={<SACapabilityGovernance />}
                    />
                    <Route
                      path="approval-rules"
                      element={<SAApprovalRules />}
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
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthBootstrap>
        </MenuProvider>
      </div>
    </BrowserRouter>
  );
}
