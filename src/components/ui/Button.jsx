const VARIANTS = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-200',
  secondary: 'bg-white text-brand-700 border border-brand-300 hover:bg-brand-50',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-50',
  danger: 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100',
}

export default function Button({ variant = 'primary', className = '', children, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
