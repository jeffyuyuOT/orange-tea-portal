export default function LoadingSpinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 py-8 justify-center text-brand-500 text-sm">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
      {label}
    </div>
  )
}

export function EmptyState({ label = 'Nothing here yet.' }) {
  return <div className="py-10 text-center text-sm text-gray-400">{label}</div>
}
