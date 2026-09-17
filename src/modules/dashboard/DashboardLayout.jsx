import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { canAccessPage } from '../../lib/permissions'

const TABS = [
  { key: 'dashboard.bulletin', to: '/dashboard/bulletin', label: 'Bulletin Board' },
  { key: 'dashboard.study_log', to: '/dashboard/study-log', label: 'Study Log' },
  { key: 'dashboard.my_information', to: '/dashboard/my-information', label: 'My Information' },
]

export default function DashboardLayout() {
  const { profile, effectivePages } = useAuth()

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">
        Hi {profile?.first_name || profile?.email}
        <span aria-hidden> 👋</span>
      </h1>

      <div className="mb-5 flex gap-1 border-b border-brand-100">
        {TABS.filter((t) => canAccessPage(effectivePages, t.key)).map((t) => (
          <NavLink
            key={t.key}
            to={t.to}
            className={({ isActive }) =>
              `px-4 py-2 text-sm font-medium ${
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
