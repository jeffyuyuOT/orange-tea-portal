import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../../lib/AuthContext'
import { canAccessPage } from '../../../lib/permissions'

// Jeff, 2026-10-26: Maintenance Log (Operations & Training) with a "Setting"
// sub-tab. Same nested-layout pattern as Shop Management's TrainingCentreLayout:
// the two pages keep their own page keys (permissions.js) so Setting can be
// limited to shop manager / admin / developer while staff only get the log.
const PREFIX = '/operations-training/maintenance'

const TABS = [
  { key: 'operations_training.maintenance_log', to: '/operations-training/maintenance-log', label: 'Log' },
  { key: 'operations_training.maintenance_manager_log', to: '/operations-training/maintenance-manager-log', label: "Manager's Log" },
  { key: 'operations_training.maintenance_overview', to: '/operations-training/maintenance-overview', label: 'Overview' },
  { key: 'operations_training.maintenance_setting', to: '/operations-training/maintenance-setting', label: 'Setting' },
]

export default function MaintenanceLayout() {
  const { effectivePages } = useAuth()
  const { pathname } = useLocation()
  const tabs = TABS.filter((t) => canAccessPage(effectivePages, t.key))
  const isChooser = pathname === PREFIX

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Maintenance Log</h1>

      {tabs.length > 1 && (
        <div className="mb-5 hidden flex-wrap gap-1 border-b border-brand-100 md:flex">
          {tabs.map((t) => (
            <NavLink
              key={t.key}
              to={t.to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${
                  isActive ? 'border-b-2 border-brand-500 text-brand-700' : 'text-gray-500 hover:text-brand-600'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      )}

      {/* Mobile: one back-bar — up to Operations & Training from the chooser, up to the chooser from a page. */}
      <Link
        to={isChooser || tabs.length <= 1 ? '/operations-training' : PREFIX}
        className="mb-4 flex items-center gap-1 text-sm font-medium text-brand-600 md:hidden"
      >
        <span aria-hidden>‹</span> {isChooser || tabs.length <= 1 ? 'Operations & Training' : 'Maintenance Log'}
      </Link>

      <Outlet context={{ items: tabs.map((t) => ({ key: t.key, label: t.label, to: t.to })), firstPath: tabs[0]?.to }} />
    </div>
  )
}
