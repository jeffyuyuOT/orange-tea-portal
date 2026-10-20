import { Link, Navigate, useOutletContext } from 'react-router-dom'
import NavBadge from '../ui/NavBadge'

// Jeff, 2026-10-21 (mobile nav redesign, level 2): "手機版的主分頁下常常會有
// 5-7個子分頁...如果現在有按鈕的方式也可以顯示提示訊息...按鈕比較清楚看到所有
// 子分頁，而且分頁內容也可以省掉tab的空間" — the same button-card pattern
// MobileSectionHome.jsx already uses to choose a SECTION, one level further
// in, to choose a PAGE within a section (or a sub-group, like Shop
// Management's Training Centre). Reached via SectionTabLayout /
// DashboardLayout / TrainingCentreLayout's mobile back-bar, or directly
// when a chooser route resolves at that section's own bare path. The badge
// per card is the same `badgeForKeys` lookup every tab/pill already used —
// the whole point per Jeff was not losing that when tabs went away.
//
// Desktop never sees this screen — the pill row right above it (rendered by
// whichever layout owns this Outlet) already shows every page at once, so
// this redirects straight past itself there. One shared component for every
// section/group rather than six near-identical ones: each parent layout
// just hands down its own { items, firstPath, style } via Outlet context.
export default function SectionSubpageHome() {
  const { items, firstPath, style } = useOutletContext() ?? {}

  if (!items || items.length === 0) return <Navigate to="/" replace />

  const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  if (items.length === 1 || isDesktop) {
    return <Navigate to={firstPath ?? items[0].to} replace />
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          className="relative flex min-h-[72px] flex-col justify-center rounded-2xl p-4 text-white shadow-sm"
          style={{ background: style?.bg ?? 'linear-gradient(135deg,#9ca3af,#6b7280)' }}
        >
          <div className="text-sm font-semibold leading-snug">{item.label}</div>
          <NavBadge badge={item.badge} corner />
        </Link>
      ))}
    </div>
  )
}
