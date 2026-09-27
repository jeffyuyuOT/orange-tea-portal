// Embeds the standalone payroll app (薪水計算系統) as a same-origin static
// page (public/payroll/index.html) — entry/permission control only, per
// Jeff's request: the payroll app itself stays independent, this just adds
// a developer-only door into it. Because it's same-origin, the fresh
// Supabase client that page creates automatically picks up the session
// this portal already signed in (same localStorage key), so there's no
// separate login and no token to pass across the iframe boundary.
//
// This page's own route is already gated by RequirePage on
// developer_tools.payroll (see routes.jsx), which only the developer role
// has by default and which admin can't even see the checkbox for (see
// UserDetailModal's Page Access filter) — but the REAL boundary is the
// payroll_* tables' RLS (is_developer(), migration
// 0057_developer_role_and_payroll.sql), since this static file is
// reachable by anyone who guesses the URL, route guard or not.
export default function PayrollPage() {
  return (
    <div className="h-[80vh] w-full overflow-hidden rounded-xl border border-gray-200">
      <iframe
        src="/payroll/index.html"
        title="薪水計算系統"
        className="h-full w-full border-0"
      />
    </div>
  )
}
