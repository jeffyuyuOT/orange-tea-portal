// Jeff, 2026-10-19 (mobile nav redesign, point 1) / 2026-10-21 (level 2):
// the color/icon recipe for a section's button-card — originally just
// MobileSectionHome.jsx's own section grid, now shared with
// SectionSubpageHome.jsx's one-level-down page/sub-group grid too (see
// SectionTabLayout.jsx, DashboardLayout.jsx, TrainingCentreLayout.jsx,
// which each pass their own section's style down via Outlet context).
// Kept in its own file, not exported alongside a component, so importing
// it doesn't disable React Fast Refresh for MobileSectionHome.jsx — same
// reasoning as navBadges.js being split out from NavBadge.jsx.
export const SECTION_STYLE = {
  operations_training: { icon: '📖', bg: 'linear-gradient(135deg,#14b8a6,#0d9488)' },
  dashboard: { icon: '🏠', bg: 'linear-gradient(135deg,#fb923c,#f97316)' },
  support: { icon: '🙋', bg: 'linear-gradient(135deg,#64748b,#475569)' },
  shop_management: { icon: '🏪', bg: 'linear-gradient(135deg,#0ea5e9,#0284c7)' },
  roster_hub: { icon: '📅', bg: 'linear-gradient(135deg,#22c55e,#16a34a)' },
  audit: { icon: '📋', bg: 'linear-gradient(135deg,#f43f5e,#e11d48)' },
  admin_center: { icon: '⚙️', bg: 'linear-gradient(135deg,#a855f7,#9333ea)' },
  developer_tools: { icon: '🔧', bg: 'linear-gradient(135deg,#1f2937,#111827)' },
}
