import { brisbaneToday } from '../../audit/auditUtils'

export { brisbaneToday }

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Roles that may edit the item list / remove other people's entries
// (matches the RLS in migration 0146).
export function isMaintenanceManager(profile) {
  return profile?.role === 'shop_manager' || profile?.role === 'admin' || profile?.role === 'developer'
}

export function frequencyLabel(months) {
  if (months === 1) return 'Monthly'
  if (months === 12) return '12 months'
  return `${months} months`
}

export function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

// "05 Oct" — short form for the month cells.
export function formatDayMonth(dateStr) {
  if (!dateStr) return ''
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

// YYYY-MM-DD + n months, clamping the day (31 Jan + 1 month = 28/29 Feb).
export function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = total % 12
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  const nd = Math.min(d, lastDay)
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

// Items in display order. Items sharing a category (case-insensitive) are
// pulled together under one category header, positioned where the first item
// of that category sits in the saved order; items with no category stay
// exactly where they are. Returns rows: { type:'category', name } or
// { type:'item', item }.
export function groupItems(items) {
  const rows = []
  const done = new Set()
  for (const it of items) {
    const cat = (it.category ?? '').trim()
    if (!cat) {
      rows.push({ type: 'item', item: it })
      continue
    }
    const k = cat.toLowerCase()
    if (done.has(k)) continue
    done.add(k)
    rows.push({ type: 'category', name: cat })
    for (const x of items) if ((x.category ?? '').trim().toLowerCase() === k) rows.push({ type: 'item', item: x })
  }
  return rows
}

// Only the items, in the order groupItems shows them.
export function displayOrder(items) {
  return groupItems(items)
    .filter((r) => r.type === 'item')
    .map((r) => r.item)
}

// When is this item next due, and is it overdue? Based on the most recent
// time it was done (any year); if never done, counted from when the item was
// added to the list.
export function dueInfo(item, logs, today) {
  const dates = logs.filter((l) => l.item_id === item.id).map((l) => l.done_date)
  const last = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
  const base = last ?? item.created_at.slice(0, 10)
  const due = addMonths(base, item.frequency_months)
  return { last, due, overdue: due < today, neverDone: !last }
}
