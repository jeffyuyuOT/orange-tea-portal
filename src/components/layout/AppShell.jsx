import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import StoreSwitcher from './StoreSwitcher'
import { useAuth } from '../../lib/AuthContext'
import { ROLE_LABELS } from '../../lib/permissions'

export default function AppShell() {
  const { profile, signOut } = useAuth()

  return (
    <div className="flex h-screen w-full bg-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-brand-100 px-6 py-3">
          <StoreSwitcher />
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium text-gray-800">
                {profile?.first_name ? `${profile.first_name} ${profile.last_name ?? ''}` : profile?.email}
              </div>
              <div className="text-xs text-brand-500">{ROLE_LABELS[profile?.role] ?? profile?.role}</div>
            </div>
            <button
              onClick={signOut}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
