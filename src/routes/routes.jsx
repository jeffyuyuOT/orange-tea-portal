import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import RequireAuth from './RequireAuth'
import RequirePage from './RequirePage'
import RequireTwoFactor from './RequireTwoFactor'
import { useAuth } from '../lib/AuthContext'
import { firstAccessiblePagePath } from '../lib/sidebarOrder'

const SetPasswordPage = lazy(() => import('../modules/auth/SetPasswordPage'))
// Jeff, 2026-10-19 (mobile nav redesign, points 1 & 2): the mobile
// section-grid "go up a level" screen, and the shared top-tab-bar layout
// used by every multi-page section below — both lazy like every other
// route-level component here, same reasoning as the 2026-10-15 comment
// just below (first login shouldn't download layouts nobody's visited yet).
const MobileSectionHome = lazy(() => import('../components/layout/MobileSectionHome'))
const SectionTabLayout = lazy(() => import('../components/layout/SectionTabLayout'))
// Jeff, 2026-10-21 (mobile nav redesign, level 2): "按鈕比較清楚看到所有子
// 分頁" — the same button-card chooser pattern as MobileSectionHome, one
// level down, for the 5-7 pages WITHIN a section. One component shared by
// every SectionTabLayout/DashboardLayout/TrainingCentreLayout chooser route
// below — each passes its own list down via <Outlet context={...}/>.
const SectionSubpageHome = lazy(() => import('../components/layout/SectionSubpageHome'))

const FormulaPage = lazy(() => import('../modules/operations-training/formula/FormulaPage'))
const ShopTrainingPage = lazy(() => import('../modules/operations-training/shop-training/ShopTrainingPage'))

const MaintenanceLayout = lazy(() => import('../modules/operations-training/maintenance/MaintenanceLayout'))
const MaintenanceLogPage = lazy(() => import('../modules/operations-training/maintenance/MaintenanceLogPage'))
const MaintenanceOverviewPage = lazy(() => import('../modules/operations-training/maintenance/MaintenanceOverviewPage'))
const MaintenanceSettingPage = lazy(() => import('../modules/operations-training/maintenance/MaintenanceSettingPage'))
const DashboardLayout = lazy(() => import('../modules/dashboard/DashboardLayout'))
const BulletinPage = lazy(() => import('../modules/dashboard/bulletin/BulletinPage'))
const MessagePage = lazy(() => import('../modules/dashboard/message/MessagePage'))
const SupportPage = lazy(() => import('../modules/support/SupportPage'))
const StudyLogPage = lazy(() => import('../modules/dashboard/study-log/StudyLogPage'))
const TimeAttendancePage = lazy(() => import('../modules/dashboard/time-attendance/TimeAttendancePage'))
const MyInformationPage = lazy(() => import('../modules/dashboard/my-information/MyInformationPage'))

const LearningTrackerPage = lazy(() => import('../modules/shop-management/learning-tracker/LearningTrackerPage'))
const StaffListPage = lazy(() => import('../modules/shop-management/staff-information/StaffListPage'))
const StaffTimeLogsPage = lazy(() => import('../modules/shop-management/staff-time-logs/StaffTimeLogsPage'))
const QrCodeDisplayPage = lazy(() => import('../modules/shop-management/qr-code-display/QrCodeDisplayPage'))

const MyRosterPage = lazy(() => import('../modules/roster-hub/my-roster/MyRosterPage'))
const MyAvailabilityPage = lazy(() => import('../modules/roster-hub/my-availability/MyAvailabilityPage'))
const ManageRosterPage = lazy(() => import('../modules/roster-hub/manage-roster/ManageRosterPage'))
const RosterHistoryPage = lazy(() => import('../modules/roster-hub/history/RosterHistoryPage'))
const LeaveManagementPage = lazy(() => import('../modules/roster-hub/leave-management/LeaveManagementPage'))
const RosterSettingsPage = lazy(() => import('../modules/roster-hub/settings/RosterSettingsPage'))

const AuditReviewPage = lazy(() => import('../modules/audit/AuditReviewPage'))
const AuditHistoryPage = lazy(() => import('../modules/audit/AuditHistoryPage'))
const AuditSettingsPage = lazy(() => import('../modules/audit/AuditSettingsPage'))

const FormulaDatabasePage = lazy(() => import('../modules/admin-center/formula-database/FormulaDatabasePage'))
const AdminQuizBankPage = lazy(() => import('../modules/admin-center/quiz-bank/AdminQuizBankPage'))
const FileRepositoryPage = lazy(() => import('../modules/admin-center/file-repository/FileRepositoryPage'))
const UserManagementPage = lazy(() => import('../modules/admin-center/user-management/UserManagementPage'))
const StoreManagementPage = lazy(() => import('../modules/admin-center/store-management/StoreManagementPage'))
const SystemSettingPage = lazy(() => import('../modules/admin-center/system-setting/SystemSettingPage'))
const AdminTrainingJourneySettingPage = lazy(() => import('../modules/admin-center/training-journey/AdminTrainingJourneySettingPage'))

const PayrollPage = lazy(() => import('../modules/developer/payroll/PayrollPage'))
const BkPage = lazy(() => import('../modules/developer/bk/BkPage'))

// Pages are lazy-loaded (Jeff, 2026-10-15: first login was slow/hanging) so the
// sign-in screen no longer downloads every page of the app up front. The
// <Suspense> boundary lives in AppShell around the page Outlet.

// Jeff, 2026-09: Quiz Bank + Shop Training Database merged into a "Training
// Centre" tab bar (TrainingCentreLayout.jsx), which itself lives inside
// Shop Management (moved there the same day, along with Training Code
// joining as this bar's third tab — see permissions.js's shop_management
// SECTIONS entry). This Training Centre "Quiz Bank" is the per-store
// "Branch Quiz Bank" — the reinstated, centrally-shared Admin Quiz Bank
// (import above, routed under /admin-center/quiz-bank below) is a
// different page entirely, see permissions.js's admin_center.quiz_bank
// comment for the fuller history.
const TrainingCentreLayout = lazy(() => import('../modules/shop-management/training-centre/TrainingCentreLayout'))
const TrainingCentreQuizBankPage = lazy(() => import('../modules/shop-management/training-centre/quiz-bank/QuizBankPage'))
const TrainingCentreShopTrainingDatabasePage = lazy(() => import('../modules/shop-management/training-centre/shop-training-database/ShopTrainingDatabasePage'))
const TrainingCentreTrainingJourneySettingPage = lazy(() => import('../modules/shop-management/training-centre/training-journey-setting/TrainingJourneySettingPage'))

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
  // Jeff, 2026-10-17: front-line staff used to land on Time & Attendance
  // instead of the first Sidebar page, since they mostly open the app just
  // to clock in/out. Jeff, 2026-10-21 (follow-up): reverted — "不要預設在
  // clock in out的頁面，因為其實最上面有相機快捷" (the header's camera-icon
  // quick-scan button, AppShell.jsx, already covers that without needing a
  // special landing page), and always skipping straight past their first
  // Sidebar page meant staff could easily miss an update sitting there
  // (Bulletin Board, most often) — see this file's own 2026-10-20 history on
  // the opposite problem that caused for Developer Tools. Every role now
  // lands the same way.
  //
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
        <Route path="/home" element={<MobileSectionHome />} />

        <Route element={<SectionTabLayout sectionKey="operations_training" />}>
          <Route path="/operations-training" element={<SectionSubpageHome />} />
          <Route path="/operations-training/formula" element={guarded('operations_training.formula', <FormulaPage />)} />
          <Route path="/operations-training/shop-training" element={guarded('operations_training.shop_training', <ShopTrainingPage />)} />

          {/* Jeff, 2026-10-26: Maintenance Log + Setting share MaintenanceLayout's own sub-tab bar (same nesting as Training Centre). */}
          <Route element={<MaintenanceLayout />}>
            <Route path="/operations-training/maintenance" element={<SectionSubpageHome />} />
            <Route path="/operations-training/maintenance-log" element={guarded('operations_training.maintenance_log', <MaintenanceLogPage />)} />
            <Route
              path="/operations-training/maintenance-manager-log"
              element={guarded('operations_training.maintenance_manager_log', <MaintenanceLogPage logType="manager" />)}
            />
            <Route
              path="/operations-training/maintenance-overview"
              element={guarded('operations_training.maintenance_overview', <MaintenanceOverviewPage />)}
            />
            <Route
              path="/operations-training/maintenance-setting"
              element={guarded('operations_training.maintenance_setting', <MaintenanceSettingPage />)}
            />
          </Route>
        </Route>

        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<SectionSubpageHome />} />
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

        <Route element={<SectionTabLayout sectionKey="shop_management" />}>
          <Route path="/shop-management" element={<SectionSubpageHome />} />
          <Route path="/shop-management/learning-tracker" element={guarded('shop_management.learning_tracker', <LearningTrackerPage />)} />
          <Route path="/shop-management/staff-information" element={guarded('shop_management.staff_information', <StaffListPage />)} />

          {/* Jeff, 2026-09: "training centre是放在shop management下的" — these
              three share TrainingCentreLayout's OWN tab bar underneath this
              section's tab bar (SectionTabLayout above folds all three into
              one "Training Centre" tab, same as Sidebar.jsx's grouped row —
              see sidebarOrder.js's PAGE_GROUPS) but keep their own page
              keys/URLs under /shop-management/..., same as every other page
              in this section. Both wrapper Routes are pathless layouts (same
              pattern AppShell's own wrapping Route uses), so nesting one
              inside the other doesn't change any child's absolute path. */}
          <Route element={<TrainingCentreLayout />}>
            <Route path="/shop-management/training-centre" element={<SectionSubpageHome />} />
            <Route path="/shop-management/quiz-bank" element={guarded('shop_management.quiz_bank', <TrainingCentreQuizBankPage />)} />
            <Route
              path="/shop-management/shop-training-database"
              element={guarded('shop_management.shop_training_database', <TrainingCentreShopTrainingDatabasePage />)}
            />
            <Route
              path="/shop-management/training-journey-setting"
              element={guarded('shop_management.training_journey_setting', <TrainingCentreTrainingJourneySettingPage />)}
            />
          </Route>

          <Route path="/shop-management/staff-time-logs" element={guarded('shop_management.staff_time_logs', <StaffTimeLogsPage />)} />
          <Route path="/shop-management/qr-code" element={guarded('shop_management.qr_code', <QrCodeDisplayPage />)} />
        </Route>

        <Route element={<SectionTabLayout sectionKey="roster_hub" />}>
          <Route path="/roster-hub" element={<SectionSubpageHome />} />
          <Route path="/roster-hub/my-roster" element={guarded('roster_hub.my_roster', <MyRosterPage />)} />
          <Route path="/roster-hub/my-availability" element={guarded('roster_hub.my_availability', <MyAvailabilityPage />)} />
          <Route path="/roster-hub/manage-roster" element={guarded('roster_hub.manage_roster', <ManageRosterPage />)} />
          <Route path="/roster-hub/history" element={guarded('roster_hub.history', <RosterHistoryPage />)} />
          <Route path="/roster-hub/leave-management" element={guarded('roster_hub.leave_management', <LeaveManagementPage />)} />
          <Route path="/roster-hub/settings" element={guarded('roster_hub.settings', <RosterSettingsPage />)} />
        </Route>

        <Route element={<SectionTabLayout sectionKey="audit" />}>
          <Route path="/audit" element={<SectionSubpageHome />} />
          <Route path="/audit/review" element={guarded('audit.review', <AuditReviewPage />)} />
          <Route path="/audit/history" element={guarded('audit.history', <AuditHistoryPage />)} />
          <Route path="/audit/settings" element={guarded('audit.settings', <AuditSettingsPage />)} />
        </Route>

        <Route element={<SectionTabLayout sectionKey="admin_center" />}>
          <Route path="/admin-center" element={<SectionSubpageHome />} />
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
        </Route>

        {/* Jeff, 2026-10-20: "手機板的BK頁面看不到，developer進去只有payroll
            頁面" — Developer Tools was the one section the mobile nav
            redesign (2026-10-19) left un-wrapped (reasoned at the time that
            2 niche, developer-only pages didn't need a tab bar), but that
            meant mobile had no way at all to get from Payroll to BK — the
            desktop sidebar still listed both, mobile's new section-grid
            only ever lands on the first page in a section. Wrapped in
            SectionTabLayout like every other multi-page section now; with
            only 2 tabs it renders as plain pills (DROPDOWN_THRESHOLD is 5),
            not a dropdown. RequireTwoFactor still gates each page
            individually underneath — unaffected by this wrapper, which
            carries no path of its own, same nesting pattern as Shop
            Management's TrainingCentreLayout inside SectionTabLayout. */}
        <Route element={<SectionTabLayout sectionKey="developer_tools" />}>
          <Route path="/developer-tools" element={<SectionSubpageHome />} />
          <Route
            path="/developer-tools/payroll"
            element={guarded('developer_tools.payroll', <RequireTwoFactor><PayrollPage /></RequireTwoFactor>)}
          />
          <Route
            path="/developer-tools/bk"
            element={guarded('developer_tools.bk', <RequireTwoFactor><BkPage /></RequireTwoFactor>)}
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
