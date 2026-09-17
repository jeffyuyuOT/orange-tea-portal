import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import RequireAuth from './RequireAuth'
import RequirePage from './RequirePage'

import FormulaPage from '../modules/operations-training/formula/FormulaPage'
import ShopTrainingPage from '../modules/operations-training/shop-training/ShopTrainingPage'

import DashboardLayout from '../modules/dashboard/DashboardLayout'
import BulletinPage from '../modules/dashboard/bulletin/BulletinPage'
import StudyLogPage from '../modules/dashboard/study-log/StudyLogPage'
import MyInformationPage from '../modules/dashboard/my-information/MyInformationPage'

import LearningTrackerPage from '../modules/shop-management/learning-tracker/LearningTrackerPage'
import StaffListPage from '../modules/shop-management/staff-information/StaffListPage'
import TrainingCodePage from '../modules/shop-management/training-code/TrainingCodePage'

import MyRosterPage from '../modules/roster-hub/my-roster/MyRosterPage'
import ManageRosterPage from '../modules/roster-hub/manage-roster/ManageRosterPage'
import RosterHistoryPage from '../modules/roster-hub/history/RosterHistoryPage'
import LeaveManagementPage from '../modules/roster-hub/leave-management/LeaveManagementPage'
import RosterSettingsPage from '../modules/roster-hub/settings/RosterSettingsPage'

import FormulaDatabasePage from '../modules/admin-center/formula-database/FormulaDatabasePage'
import QuizBankPage from '../modules/admin-center/quiz-bank/QuizBankPage'
import ShopTrainingDatabasePage from '../modules/admin-center/shop-training-database/ShopTrainingDatabasePage'
import FileRepositoryPage from '../modules/admin-center/file-repository/FileRepositoryPage'
import UserManagementPage from '../modules/admin-center/user-management/UserManagementPage'
import SystemSettingPage from '../modules/admin-center/system-setting/SystemSettingPage'

function guarded(pageKey, element) {
  return <RequirePage pageKey={pageKey}>{element}</RequirePage>
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/operations-training/formula" replace />} />

        <Route path="/operations-training/formula" element={guarded('operations_training.formula', <FormulaPage />)} />
        <Route path="/operations-training/shop-training" element={guarded('operations_training.shop_training', <ShopTrainingPage />)} />

        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="bulletin" replace />} />
          <Route path="bulletin" element={guarded('dashboard.bulletin', <BulletinPage />)} />
          <Route path="study-log" element={guarded('dashboard.study_log', <StudyLogPage />)} />
          <Route path="my-information" element={guarded('dashboard.my_information', <MyInformationPage />)} />
        </Route>

        <Route path="/shop-management/learning-tracker" element={guarded('shop_management.learning_tracker', <LearningTrackerPage />)} />
        <Route path="/shop-management/staff-information" element={guarded('shop_management.staff_information', <StaffListPage />)} />
        <Route path="/shop-management/training-code" element={guarded('shop_management.training_code', <TrainingCodePage />)} />

        <Route path="/roster-hub/my-roster" element={guarded('roster_hub.my_roster', <MyRosterPage />)} />
        <Route path="/roster-hub/manage-roster" element={guarded('roster_hub.manage_roster', <ManageRosterPage />)} />
        <Route path="/roster-hub/history" element={guarded('roster_hub.history', <RosterHistoryPage />)} />
        <Route path="/roster-hub/leave-management" element={guarded('roster_hub.leave_management', <LeaveManagementPage />)} />
        <Route path="/roster-hub/settings" element={guarded('roster_hub.settings', <RosterSettingsPage />)} />

        <Route path="/admin-center/formula-database" element={guarded('admin_center.formula_database', <FormulaDatabasePage />)} />
        <Route path="/admin-center/quiz-bank" element={guarded('admin_center.quiz_bank', <QuizBankPage />)} />
        <Route path="/admin-center/shop-training-database" element={guarded('admin_center.shop_training_database', <ShopTrainingDatabasePage />)} />
        <Route path="/admin-center/file-repository" element={guarded('admin_center.file_repository', <FileRepositoryPage />)} />
        <Route path="/admin-center/user-management" element={guarded('admin_center.user_management', <UserManagementPage />)} />
        <Route path="/admin-center/system-setting" element={guarded('admin_center.system_setting', <SystemSettingPage />)} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
