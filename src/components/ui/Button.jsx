import { useEffect, useRef, useState } from 'react'

const VARIANTS = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-200',
  secondary: 'bg-white text-brand-700 border border-brand-300 hover:bg-brand-50',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-50',
  danger: 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100',
}

// Guards every Button against double-submit: if `onClick` is (or returns) a
// promise — true for any `async function`, which is how nearly every
// save/add/delete handler in this app is written — the button disables
// itself the moment it's clicked and stays disabled until that promise
// settles. A slow save no longer means "click again in case it didn't
// register" quietly firing the same insert/update/delete twice. Callers
// don't need their own busy flag just for this; they can still keep one to
// swap in a "Saving…" label, and can pass `disabled` as usual to add other
// conditions (e.g. required fields) — both are combined with the built-in
// guard.
export default function Button({ variant = 'primary', className = '', children, onClick, disabled, ...props }) {
  const [busy, setBusy] = useState(false)
  // Many Save handlers close/unmount their own modal as their last step
  // (before this promise settles) — this guard avoids a "can't update
  // state on an unmounted component" warning when that happens.
  //
  // The setup function must also set this back to true, not just the
  // initial useRef(true) — in React StrictMode (dev), every effect runs
  // mount -> cleanup -> mount once on first render, specifically to
  // surface bugs like this. Without resetting it here, that first
  // cleanup flips this to false permanently, and any button whose
  // container stays mounted after a successful click (e.g. an "Add"
  // button on a settings page that stays open, as opposed to a Save
  // button inside a modal that closes on success) would lock up for
  // good the very first time it was used — busy could then never be
  // cleared back to false again.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function handleClick(e) {
    const result = onClick?.(e)
    if (result && typeof result.then === 'function') {
      setBusy(true)
      try {
        await result
      } finally {
        if (mountedRef.current) setBusy(false)
      }
    }
  }

  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      onClick={onClick ? handleClick : undefined}
      disabled={disabled || busy}
      {...props}
    >
      {children}
    </button>
  )
}
