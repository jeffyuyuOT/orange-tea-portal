// Jeff, 2026-10-20 (point 7): "手機板分頁如果其內容有提示訊息，分頁按鈕右上
// 角要顯示數字提示，這樣user才知道裡面有提示訊息要按進去看" — the same
// "something's new here" signals Sidebar.jsx has always shown next to each
// desktop page link (see its own per-signal comments) now need to surface
// on the new mobile tab bar/dropdown (SectionTabLayout) and section grid
// (MobileSectionHome) too, including bubbled up to a whole tab/section when
// it folds several page keys together (a PAGE_GROUPS tab, or a section as a
// whole). One lookup table so none of these surfaces can drift apart on
// which page key maps to which signal — add a new badge signal here once,
// not separately in every surface that shows one. The rendering half (the
// little pill/corner dot or count) is NavBadge.jsx, components/ui — kept in
// its own file since mixing a component export with these plain functions
// in one file disables React Fast Refresh for it.
//
// `signals` is the small slice of AuthContext's own fields every surface
// already has via useAuth(): { rosterUpdates, hasFormulaUpdates,
// hasBulletinUpdates, unreadMessageCount, hasTimeDiscrepancies,
// auditPending } — auditPending isn't in AuthContext itself, see
// useAuditPending.js.
function pageBadgeFor(fullKey, signals) {
  switch (fullKey) {
    case 'roster_hub.my_roster':
      return signals.rosterUpdates?.myRoster ? { dot: true } : null
    case 'operations_training.formula':
      return signals.hasFormulaUpdates ? { dot: true } : null
    case 'dashboard.bulletin':
      return signals.hasBulletinUpdates ? { dot: true } : null
    case 'dashboard.message':
      return signals.unreadMessageCount > 0 ? { count: signals.unreadMessageCount } : null
    case 'shop_management.staff_time_logs':
      return signals.hasTimeDiscrepancies ? { dot: true } : null
    case 'audit.review':
      return signals.auditPending ? { dot: true } : null
    default:
      return null
  }
}

// Combined badge for a tab/section that covers several full page keys —
// true (dot) if ANY of them has something, with a real count only when
// every contributing signal is itself a count (today only dashboard.message
// is); mixing a count with a plain "something's new" dot collapses to a
// dot, since a half-right number is worse than none.
export function badgeForKeys(fullKeys, signals) {
  const badges = fullKeys.map((k) => pageBadgeFor(k, signals)).filter(Boolean)
  if (!badges.length) return null
  if (badges.every((b) => b.count != null)) {
    return { count: badges.reduce((sum, b) => sum + b.count, 0) }
  }
  return { dot: true }
}
