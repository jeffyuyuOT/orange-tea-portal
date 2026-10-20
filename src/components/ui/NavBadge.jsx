// Jeff, 2026-10-20 (point 7): the small red dot/count every nav surface
// (SectionTabLayout, MobileSectionHome, DashboardLayout) renders from a
// navBadges.js badgeForKeys() result — { dot: true } or { count: n }.
// `corner` picks the absolutely-positioned top-right treatment
// MobileSectionHome's section blocks and SectionTabLayout's dropdown toggle
// use (the parent needs `relative`); omit it for the inline treatment that
// sits right after a pill/row's label text.
export default function NavBadge({ badge, corner }) {
  if (!badge) return null
  if (badge.count != null) {
    return (
      <span
        className={
          corner
            ? 'absolute -right-1.5 -top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow'
            : 'flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white'
        }
      >
        {badge.count}
      </span>
    )
  }
  return (
    <span
      className={corner ? 'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 shadow' : 'h-1.5 w-1.5 rounded-full bg-red-500'}
      aria-label="Update"
    />
  )
}
