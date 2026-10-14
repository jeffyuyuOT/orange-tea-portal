// Small shared widgets for the BK page.
import { useState } from 'react'
import { brisbaneToday } from './bkUtils'

export function StoreTabs({ stores, storeId, onChange, allowAll = false, className = '' }) {
  const tab = (id, label) => (
    <button
      key={id ?? 'all'}
      type="button"
      onClick={() => onChange(id)}
      className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
        storeId === id ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className={`flex gap-2 overflow-x-auto pb-1 ${className}`}>
      {allowAll && tab(null, '全部分店')}
      {stores.map((s) => tab(s.id, s.name))}
    </div>
  )
}

export function SubTabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-brand-100">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
            value === key ? 'border-brand-500 text-brand-700' : 'border-transparent text-gray-500 hover:text-brand-600'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

const selectCls = 'rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-brand-400 focus:outline-none'
export const inputCls =
  'rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-brand-400 focus:outline-none'

export function YearMonthPicker({ year, month, onChange, allowAllMonths = false }) {
  const thisYear = brisbaneToday().year
  const years = []
  for (let y = thisYear + 1; y >= thisYear - 5; y--) years.push(y)
  if (!years.includes(year)) years.push(year)
  years.sort((a, b) => b - a)
  return (
    <div className="flex items-center gap-2">
      <select className={selectCls} value={year} onChange={(e) => onChange({ year: Number(e.target.value), month })} aria-label="Year">
        {years.map((y) => (
          <option key={y} value={y}>
            {y} 年
          </option>
        ))}
      </select>
      <select
        className={selectCls}
        value={month ?? 0}
        onChange={(e) => onChange({ year, month: Number(e.target.value) || null })}
        aria-label="Month"
      >
        {allowAllMonths && <option value={0}>全部月份</option>}
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <option key={m} value={m}>
            {m} 月
          </option>
        ))}
      </select>
    </div>
  )
}

// Numeric text input that only accepts digits, one dot and an optional minus.
// While you are NOT typing in it, a valid number is shown with two decimals
// (595 -> 595.00); the text you type is left alone while the box has focus.
// `plain` turns that off for counts (cups, CV) that are not money.
export function MoneyInput({ value, onChange, allowNegative = true, plain = false, className = '', onFocus, onBlur, ...rest }) {
  const re = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/
  const [focused, setFocused] = useState(false)
  const raw = value ?? ''
  const n = Number(raw)
  const shown =
    !plain && !focused && raw !== '' && raw !== '-' && raw !== '.' && Number.isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : raw
  return (
    <input
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onChange={(e) => {
        const v = e.target.value
        if (v === '' || re.test(v)) onChange(v)
      }}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      className={`w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm tabular-nums hover:border-brand-200 focus:border-brand-400 focus:bg-white focus:outline-none ${className}`}
      {...rest}
    />
  )
}

export function Notice({ kind = 'info', children, onClose }) {
  const styles = {
    info: 'border-brand-200 bg-brand-50 text-brand-800',
    error: 'border-red-200 bg-red-50 text-red-700',
    ok: 'border-green-200 bg-green-50 text-green-700',
  }
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${styles[kind]}`}>
      <div>{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="text-xs opacity-60 hover:opacity-100" aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  )
}

// Paperclip-style marker for rows that carry a note; click opens the note.
export function NoteButton({ note, onOpen }) {
  if (!note) return null
  return (
    <button
      type="button"
      onClick={() => onOpen(note)}
      title="查看附註"
      className="ml-1 rounded px-1 text-brand-500 hover:bg-brand-50"
      aria-label="查看附註"
    >
      📝
    </button>
  )
}
