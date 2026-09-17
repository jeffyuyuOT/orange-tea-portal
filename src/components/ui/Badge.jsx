const COLORS = {
  brand: 'bg-brand-100 text-brand-700',
  gray: 'bg-gray-100 text-gray-600',
  red: 'bg-red-100 text-red-700',
  green: 'bg-green-100 text-green-700',
}

export default function Badge({ color = 'brand', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[color]} ${className}`}
    >
      {children}
    </span>
  )
}
