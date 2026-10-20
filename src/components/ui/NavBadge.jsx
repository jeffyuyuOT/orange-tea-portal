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
  // Jeff, 2026-10-21: asked whether the plain dot should just be bigger, or
  // switched to a number everywhere like Message already does. Recommended
  // (and this is) keeping the number only where it's a genuine count — most
  // of the other signals feeding badgeForKeys() are cheap booleans, not real
  // counts, so a fake number there would be misleading — and just making the
  // dot itself bigger and higher-contrast (added a white ring on the corner
  // variant so it reads clearly against any background it sits on).
  return (
    <span
      className={
        corner
          ? 'absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-white bg-red-500 shadow'
          : 'h-2.5 w-2.5 rounded-full bg-red-500'
      }
      aria-label="Update"
    />
  )
}
