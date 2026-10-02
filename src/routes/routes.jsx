import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import RequireAuth from './RequireAuth'
import RequirePage from './RequirePage'
import { useAuth } from '../lib/AuthContext'
import { firstAccessiblePagePath } from '../lib/sidebarOrder'

import SetPasswordPage from '../modules/auth/SetPasswordPage'

import FormulaPage from '../modules/operations-training/formula/FormulaPage'
import ShopTrainingPage from '../modules/operations-training/shop-training/ShopTrainingPage'

import DashboardLayout from '../modules/dashboard/DashboardLayout'
import BulletinPage from '../modules/dashboard/bulletin/BulletinPage'
import MessagePage from '../modules/dashboard/message/MessagePage'
import SupportPage from '../modules/support/SupportPage'
import StudyLogPage from '../modules/dashboard/study-log/StudyLogPage'
import TimeAttendancePage from '../modules/dashboard/time-attendance/TimeAttendancePage'
import MyInformationPage from '../modules/dashboard/my-information/MyInformationPage'

import LearningTrackerPage from '../modules/shop-management/learning-tracker/LearningTrackerPage'
import StaffListPage from '../modules/shop-management/staff-information/StaffListPage'
import StaffTimeLogsPage from '../modules/shop-management/staff-time-logs/StaffTimeLogsPage'
import QrCodeDisplayPage from '../modules/shop-management/qr-code-display/QrCodeDisplayPage'

import MyRosterPage from '../modules/roster-hub/my-roster/MyRosterPage'
import MyAvailabilityPage from '../modules/roster-hub/my-availability/MyAvailabilityPage'
import ManageRosterPage from '../modules/roster-hub/manage-roster/ManageRosterPage'
import RosterHistoryPage from '../modules/roster-hub/history/RosterHistoryPage'
import LeaveManagementPage from '../modules/roster-hub/leave-management/LeaveManagementPage'
import RosterSettingsPage from '../modules/roster-hub/settings/RosterSettingsPage'

import FormulaDatabasePage from '../modules/admin-center/formula-database/FormulaDatabasePage'
import AdminQuizBankPage from '../modules/admin-center/quiz-bank/AdminQuizBankPage'
import FileRepositoryPage from '../modules/admin-center/file-repository/FileRepositoryPage'
import UserManagementPage from '../modules/admin-center/user-management/UserManagementPage'
import StoreManagementPage from '../modules/admin-center/store-management/StoreManagementPage'
import SystemSettingPage from '../modules/admin-center/system-setting/SystemSettingPage'
import AdminTrainingJourneySettingPage from '../modules/admin-center/training-journey/AdminTrainingJourneySettingPage'

import PayrollPage from '../modules/developer/payroll/PayrollPage'

// Jeff, 2026-09: Quiz Bank + Shop Training Database merged into a "Training
// Centre" tab bar (TrainingCentreLayout.jsx), which itself lives inside
// Shop Management (moved there the same day, along with Training Code
// joining as this bar's third tab — see permissions.js's shop_management
// SECTIONS entry). This Training Centre "Quiz Bank" is the per-store
// "Branch Quiz Bank" — the reinstated, centrally-shared Admin Quiz Bank
// (import above, routed under /admin-center/quiz-bank below) is a
// different page entirely, see permissions.js's admin_center.quiz_bank
// comment for the fuller history.
import TrainingCentreLayout from '../modules/shop-management/training-centre/TrainingCentreLayout'
import TrainingCentreQuizBankPage from '../modules/shop-management/training-centre/quiz-bank/QuizBankPage'
import TrainingCentreShopTrainingDatabasePage from '../modules/shop-management/training-centre/shop-training-database/ShopTrainingDatabasePage'
import TrainingCentreTrainingCodePage from '../modules/shop-management/training-centre/training-code/TrainingCodePage'
import TrainingCentreTrainingJourneySettingPage from '../modules/shop-management/training-centre/training-journey-setting/TrainingJourneySettingPage'

function guarded(pageKey, element) {
  return <RequirePage pageKey={pageKey}>{element}</RequirePage>
}

// "/" used to hardcode a redirect to Formula, which only worked because
// every role until now happened to have that page. qr_code_maker (and the
// pre-existing training role) don't, so this finds each person's own first
// accessible page instead (firstAccessiblePagePath, sidebarOrder.js) —
// walking the same admin-editable Sidebar order the Sidebar itself renders
// in, so landing here after login always matches whatever's first in the
// Sidebar, not a separate hardcoded order that could drift from it.
function RootRedirect() {
  const { effectivePages, sidebarOrder } = useAuth()
  // No accessible page at all (e.g. a brand-new account with no role wired
  // up yet) — send them somewhere that at least renders instead of looping.
  return <Navigate to={firstAccessiblePagePath(effectivePages, sidebarOrder) ?? '/dashboard'} replace />
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public — reached from a Supabase invite/reset-password email link
          (see main.jsx) or from My Information's "Change password" button.
          Deliberately outside RequireAuth: it establishes its own session
          from the link (or uses the one already logged in) instead of
          needing one up front. */}
      <Route path="/set-password" element={<SetPasswordPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<RootRedirect />} />

        <Route path="/operations-training/formula" element={guarded('operations_training.formula', <FormulaPage />)} />
        <Route path="/operations-training/shop-training" element={guarded('operations_training.shop_training', <ShopTrainingPage />)} />

        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="bulletin" replace />} />
          <Route path="bulletin" element={guarded('dashboard.bulletin', <BulletinPage />)} />
          <Route path="message" element={guarded('dashboard.message', <MessagePage />)} />
          <Route path="study-log" element={guarded('dashboard.study_log', <StudyLogPage />)} />
          <Route path="time-attendance" element={guarded('dashboard.time_attendance', <TimeAttendancePage />)} />
          <Route path="my-information" element={guarded('dashboard.my_information', <MyInformationPage />)} />
        </Route>

        {/* Jeff, 2026-09: its own top-level section — "跟my dashboard同等
            級，不是在my dashboard下" — not nested under /dashboard the way
            it briefly was. */}
        <Route path="/support/submit-request" element={guarded('support.submit_request', <SupportPage />)} />

        <Route path="/shop-management/learning-tracker" element={guarded('shop_management.learning_tracker', <LearningTrackerPage />)} />
        <Route path="/shop-management/staff-information" element={guarded('shop_management.staff_information', <StaffListPage />)} />

        {/* Jeff, 2026-09: "training centre是放在shop management下的" — these
            three share TrainingCentreLayout's tab bar but keep their own
            page keys/URLs under /shop-management/..., same as every other
            page in this section (and matching how Sidebar.jsx generically
            builds each link as /{section}/{page} from permissions.js — no
            change needed there). This wrapper Route has no path of its own
            (same pathless-layout pattern AppShell's own wrapping Route
            above uses), so its children's absolute paths resolve from root
            exactly as if it weren't there. */}
        <Route element={<TrainingCentreLayout />}>
          <Route path="/shop-management/quiz-bank" element={guarded('shop_management.quiz_bank', <TrainingCentreQuizBankPage />)} />
          <Route
            path="/shop-management/shop-training-database"
            element={guarded('shop_management.shop_training_database', <TrainingCentreShopTrainingDatabasePage />)}
          />
          <Route path="/shop-management/training-code" element={guarded('shop_management.training_code', <TrainingCentreTrainingCodePage />)} />
          <Route
            path="/shop-management/training-journey-setting"
            element={guarded('shop_management.training_journey_setting', <TrainingCentreTrainingJourneySettingPage />)}
          />
        </Route>

        <Route path="/shop-management/staff-time-logs" element={guarded('shop_management.staff_time_logs', <StaffTimeLogsPage />)} />
        <Route path="/shop-management/qr-code" element={guarded('shop_management.qr_code', <QrCodeDisplayPage />)} />

        <Route path="/roster-hub/my-roster" element={guarded('roster_hub.my_roster', <MyRosterPage />)} />
        <Route path="/roster-hub/my-availability" element={guarded('roster_hub.my_availability', <MyAvailabilityPage />)} />
        <Route path="/roster-hub/manage-roster" element={guarded('roster_hub.manage_roster', <ManageRosterPage />)} />
        <Route path="/roster-hub/history" element={guarded('roster_hub.history', <RosterHistoryPage />)} />
        <Route path="/roster-hub/leave-management" element={guarded('roster_hub.leave_management', <LeaveManagementPage />)} />
        <Route path="/roster-hub/settings" element={guarded('roster_hub.settings', <RosterSettingsPage />)} />

        <Route path="/admin-center/formula-database" element={guarded('admin_center.formula_database', <FormulaDatabasePage />)} />
        <Route path="/admin-center/quiz-bank" element={guarded('admin_center.quiz_bank', <AdminQuizBankPage />)} />
        <Route path="/admin-center/file-repository" element={guarded('admin_center.file_repository', <FileRepositoryPage />)} />
        <Route path="/admin-center/user-management" element={guarded('admin_center.user_management', <UserManagementPage />)} />
        <Route path="/admin-center/store-management" element={guarded('admin_center.store_management', <StoreManagementPage />)} />
        <Route path="/admin-center/system-setting" element={guarded('admin_center.system_setting', <SystemSettingPage />)} />
        <Route
          path="/admin-center/training-journey-setting"
          element={guarded('admin_center.training_journey_setting', <AdminTrainingJourneySettingPage />)}
        />

        <Route path="/developer-tools/payroll" element={guarded('developer_tools.payroll', <PayrollPage />)} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
