import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../../lib/AuthContext'
import { canAccessPage } from '../../../lib/permissions'
import { useAuditPending } from '../../../lib/useAuditPending'
import { badgeForKeys } from '../../../lib/navBadges'
import NavBadge from '../../../components/ui/NavBadge'

// Jeff, 2026-09: Quiz Bank + Shop Training Database merged into "Training
// Centre", then (same day) moved from being its own top-level section into
// living inside Shop Management. Same TABS-row + Outlet pattern as
// DashboardLayout.jsx — each tab is still its own independent page key
// under shop_management (see permissions.js), this is purely a shared
// header/tab-bar for quick cross-navigation between them, routed under
// /shop-management/... like every other Shop Management page.
//
// Jeff, 2026-10-07: "移除training centre裡的training code分頁，training
// staff現在不需要經過training code就可以登入" — Training Code (once folded in
// here as a third tab, "training code也放在training centre下") is gone along
// with the weekly-code login requirement it existed for — see
// AuthContext.jsx (verifyTrainingCode/needsTrainingCode, both removed) and
// LoginPage.jsx/RequireAuth.jsx (the extra sign-in step they used to gate
// training-role accounts behind).
const PREFIX = '/shop-management/training-centre'

const TABS = [
  { key: 'shop_management.quiz_bank', to: '/shop-management/quiz-bank', label: 'Branch Quiz Bank' },
  { key: 'shop_management.shop_training_database', to: '/shop-management/shop-training-database', label: 'Shop Training Database' },
  // Jeff, 2026-10-02 (Training Journey spec, point 5): this store's own
  // Must-Know shop training item → phase assignment — see
  // TrainingJourneySettingPage.jsx's own comment for how this pairs with
  // Admin Center's equivalent "Phase Item" tab for formula items.
  { key: 'shop_management.training_journey_setting', to: '/shop-management/training-journey-setting', label: '🏆 Training Journey Setting' },
]

export default function TrainingCentreLayout() {
  const { effectivePages, profile, rosterUpdates, hasFormulaUpdates, hasBulletinUpdates, unreadMessageCount, hasTimeDiscrepancies } = useAuth()
  const { pathname } = useLocation()
  // Jeff, 2026-10-21 (point 7, carried down here same as every other nav
  // surface — navBadges.jsx): none of this group's 3 pages has a signal
  // wired up to it yet, so every badge below is a silent no-op today —
  // future-proofed the same way DashboardLayout.jsx's full signal set is,
  // rather than leaving this one layout unable to show a badge at all.
  const auditPending = useAuditPending(profile, effectivePages)
  const signals = { rosterUpdates, hasFormulaUpdates, hasBulletinUpdates, unreadMessageCount, hasTimeDiscrepancies, auditPending }

  const accessibleTabs = TABS.filter((t) => canAccessPage(effectivePages, t.key))
  const isChooser = pathname === PREFIX

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Training Centre</h1>

      {/* Desktop: unchanged pill row. */}
      <div className="mb-5 hidden flex-wrap gap-1 border-b border-brand-100 md:flex">
        {accessibleTabs.map((t) => (
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
            <NavBadge badge={badgeForKeys([t.key], signals)} />
          </NavLink>
        ))}
      </div>

      {/* Jeff, 2026-10-21 (mobile nav redesign, level 2): one back-bar,
          never stacked with Shop Management's own — "為什麼一定要顯示shop
          management?...在所有第二層子分頁按紐頁再顯示shop management". On
          this chooser itself (SectionSubpageHome via the Outlet context
          below), go up to Shop Management; on any leaf page here, go up to
          this chooser instead — SectionTabLayout.jsx's own back-bar already
          steps aside for every path this component owns. */}
      <Link
        to={isChooser ? '/shop-management' : PREFIX}
        className="mb-4 flex items-center gap-1 text-sm font-medium text-brand-600 md:hidden"
      >
        <span aria-hidden>‹</span> {isChooser ? 'Shop Management' : 'Training Centre'}
      </Link>

      <Outlet
        context={{
          items: accessibleTabs.map((t) => ({ key: t.key, label: t.label, to: t.to, badge: badgeForKeys([t.key], signals) })),
          firstPath: accessibleTabs[0]?.to,
        }}
      />
    </div>
  )
}
