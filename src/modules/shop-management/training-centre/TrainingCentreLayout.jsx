import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../../lib/AuthContext'
import { canAccessPage } from '../../../lib/permissions'

// Jeff, 2026-09: Quiz Bank + Shop Training Database merged into "Training
// Centre", then (same day) moved from being its own top-level section into
// living inside Shop Management, with Training Code folded in as a third
// tab ("training centre是放在shop management下的...training code也放在
// training centre下"). Same TABS-row + Outlet pattern as
// DashboardLayout.jsx — each tab is still its own independent page key
// under shop_management (see permissions.js), this is purely a shared
// header/tab-bar for quick cross-navigation between the three, routed under
// /shop-management/... like every other Shop Management page.
const TABS = [
  { key: 'shop_management.quiz_bank', to: '/shop-management/quiz-bank', label: 'Branch Quiz Bank' },
  { key: 'shop_management.shop_training_database', to: '/shop-management/shop-training-database', label: 'Shop Training Database' },
  { key: 'shop_management.training_code', to: '/shop-management/training-code', label: 'Training Code' },
]

export default function TrainingCentreLayout() {
  const { effectivePages } = useAuth()

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Training Centre</h1>

      <div className="mb-5 flex gap-1 border-b border-brand-100">
        {TABS.filter((t) => canAccessPage(effectivePages, t.key)).map((t) => (
          <NavLink
            key={t.key}
            to={t.to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-4 py-2 text-sm font-medium ${
                isActive ? 'border-b-2 border-brand-500 text-brand-700' : 'text-gray-500 hover:text-brand-600'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  )
}
