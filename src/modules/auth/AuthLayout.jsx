// Shared shell for the auth-flow screens (sign in, set password) — pulled
// out of LoginPage so SetPasswordPage can reuse the same look without
// duplicating it.
export default function AuthLayout({ title, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-50/60 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-brand-100 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">
            OT
          </div>
          <h1 className="text-lg font-semibold text-brand-900">Orange Tea AU</h1>
          <p className="text-xs text-brand-500">{title}</p>
        </div>
        {children}
      </div>
    </div>
  )
}
