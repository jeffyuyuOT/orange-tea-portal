// Pure helpers for "匯入 by 圖檔": turn the text OCR read off a POS
// "Sale Summary › Payments" screenshot into per-day SF entries. Nothing here
// touches the browser or the database, so it can be unit-tested on its own.
//
//   OCR text  --parseReportText-->  { from, to, lines: [{ label, cents }], totalCents }
//   lines     --repairWithSum-->    one confusable digit fixed when that makes
//                                   (all payment lines) = Total
//   draft     --draftToEntries-->   { entries } in the shape the Excel import produces,
//                                   so countOverwrites / filterKeepExisting (the
//                                   覆蓋 / skip-existing rules) work on it unchanged
//
// Mapping (the spec in ImportByImage.jsx): the image's Cash line -> O.CA, its
// Total -> O.POST, Eftpos + Eftpos offline -> POS eftpos (mergeEftposLines);
// every other line goes to the payment type of the same name on this store.
import { mergeEftposLines } from './bkImport'
import { daysInMonth, KIOSK_NAME, round2, toNum, ymd } from './bkUtils'

const norm = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// "POS eftpos (Total Eftpos)" -> "pos eftpos"
const stripParen = (s) => norm(String(s ?? '').replace(/\s*\([^)]*\)\s*$/, ''))

// Comparison key: no spaces / punctuation, no trailing "s" ("Uber Eat" = "Uber Eats").
const keyOf = (s) =>
  stripParen(s)
    .replace(/[^a-z0-9]/g, '')
    .replace(/s$/, '')

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}

// OCR label -> one of this store's payment types ({ id, name }), or null.
// Exact key first, then "starts with" (POS eftpos vs "POS eftpos (Total Eftpos)"),
// then one wrong letter for names of 5+ characters ("Uberfat" -> "Uber Eat").
export function matchLabel(label, types) {
  const k = keyOf(label)
  if (!k) return null
  const keyed = types.map((t) => ({ t, k: keyOf(t.name) }))
  const exact = keyed.find((x) => x.k === k)
  if (exact) return exact.t
  const starts = keyed.filter((x) => x.k.startsWith(k) || k.startsWith(x.k))
  if (starts.length === 1 && Math.min(k.length, starts[0].k.length) >= 4) return starts[0].t
  if (k.length >= 5) {
    const near = keyed.filter((x) => editDistance(x.k, k) <= 1)
    if (near.length === 1) return near[0].t
  }
  return null
}

// The payment types a day's amounts can be typed into (same rule as the Excel
// import): subs of a main made of subs, and mains without subs; never Cash / Pos total.
export function typedTypes(columns) {
  const out = []
  for (const col of columns) {
    if (col.name === 'Cash' || col.name === 'Pos total') continue
    if (col.subs.length > 0) out.push(...col.subs.map((s) => ({ id: s.id, name: s.name })))
    else out.push({ id: col.id, name: col.name })
  }
  return out
}

function isoOrEmpty(d, m, y) {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? ymd(y, m, d) : ''
}

// OCR text -> { from, to, lines, totalCents }.  from / to = the "For Period" dates
// as YYYY-MM-DD ('' when not found); lines = every "<label> <amount>" row except
// Total; totalCents = the Total row or null.
// Reading quirks handled: "$" read as "S", "1,782.62" read as "1.782.62".
export function parseReportText(text) {
  const dates = []
  for (const m of String(text).matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/g)) {
    const iso = isoOrEmpty(Number(m[1]), Number(m[2]), Number(m[3]))
    if (iso) dates.push(iso)
  }
  const lines = []
  let totalCents = null
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/[|[\]{}()]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!line || /[/:]/.test(line)) continue // the For Period / time row
    const m = line.match(/^([A-Za-z][A-Za-z .&'-]*?)\s*(-?)\s*[$S§]?\s*(\d[\d.,]*[.,]\d{2})$/)
    if (!m) continue
    const label = m[1].trim()
    if (!label) continue
    const digits = m[3].replace(/[.,]/g, '')
    const cents = (m[2] === '-' ? -1 : 1) * Number(digits)
    if (!Number.isFinite(cents)) continue
    if (norm(label) === 'total') totalCents = cents
    else lines.push({ label, cents })
  }
  return { from: dates[0] ?? '', to: dates[1] ?? dates[0] ?? '', lines, totalCents }
}

// 8 read as 3 etc. When the payment lines do not add up to Total, try changing ONE
// digit (of one line or of Total) to a look-alike; if exactly one such change makes
// the sum right, use it. Several candidates or none -> leave the numbers alone (the
// review step shows the mismatch for the person to fix by hand).
// -> { lines, totalCents, fixed: null | { label, from, to } }
const CONFUSABLE = { 0: '8', 3: '89', 4: '9', 5: '6', 6: '58', 8: '039', 9: '834' }

export function repairWithSum(lines, totalCents) {
  const none = { lines, totalCents, fixed: null }
  if (totalCents === null || lines.length === 0) return none
  const sum = lines.reduce((s, l) => s + l.cents, 0)
  if (sum === totalCents) return none
  const candidates = []
  const items = [...lines.map((l, i) => ({ i, cents: l.cents })), { i: -1, cents: totalCents }]
  for (const it of items) {
    if (it.cents < 0) continue
    const digits = String(it.cents)
    for (let p = 0; p < digits.length; p++) {
      for (const rep of CONFUSABLE[digits[p]] ?? '') {
        const next = Number(digits.slice(0, p) + rep + digits.slice(p + 1))
        const newSum = it.i === -1 ? sum : sum - it.cents + next
        const newTotal = it.i === -1 ? next : totalCents
        if (newSum === newTotal) candidates.push({ i: it.i, from: it.cents, to: next })
      }
    }
  }
  const distinct = new Map(candidates.map((c) => [`${c.i}:${c.to}`, c]))
  if (distinct.size !== 1) return none
  const c = [...distinct.values()][0]
  if (c.i === -1) return { lines, totalCents: c.to, fixed: { label: 'Total', from: c.from, to: c.to } }
  return {
    lines: lines.map((l, i) => (i === c.i ? { ...l, cents: c.to } : l)),
    totalCents,
    fixed: { label: lines[c.i].label, from: c.from, to: c.to },
  }
}

const dollars = (cents) => round2(cents / 100)

// Draft (what the review step edits) -> everything the review step shows.
//   draft: { date: 'YYYY-MM-DD' | '', lines: [{ label, amount: string }], total: string }
// Returns { merged, hasCash, cashAmount, totalAmount, sum, sumOk, result } where
// `merged` is every non-Cash line after Eftpos + Eftpos offline became one
// POS eftpos line, each with the payment type it maps to (target) or null, and
// `zeroFilled` / `zeroCash` = what got an automatic 0, and
// `result` = { error?, entries, dayCount, cellCount, otherMonths }, entries being
// { [date]: { o_ca?, o_post?, amounts: { [typeId]: number } } }.
export function draftToEntries(draft, { year, month, columns, days }) {
  const num = (v) => {
    const n = Number(String(v ?? '').replace(/,/g, '').trim())
    return String(v ?? '').trim() === '' || !Number.isFinite(n) ? null : n
  }
  const lines = draft.lines.map((l) => ({ label: l.label, amount: num(l.amount) })).filter((l) => l.amount !== null)
  const cashLines = lines.filter((l) => norm(l.label) === 'cash')
  const hasCash = cashLines.length > 0
  const cashAmount = hasCash ? round2(cashLines.reduce((s, l) => s + l.amount, 0)) : null
  const types = typedTypes(columns)
  const merged = mergeEftposLines(lines.filter((l) => norm(l.label) !== 'cash')).map((l) => ({
    ...l,
    target: matchLabel(l.label, types), // { id, name } | null
  }))
  const totalAmount = num(draft.total)
  const sum = round2(lines.reduce((s, l) => s + l.amount, 0))
  const sumOk = totalAmount !== null && Math.abs(sum - totalAmount) < 0.005

  const result = { entries: {}, dayCount: 0, cellCount: 0, otherMonths: [] }
  const zeroFilled = [] // payment types filled with 0 because the picture has no line for them
  let zeroCash = false
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  if (!draft.date) {
    result.error = '沒有日期，請在上面選一天。'
  } else if (draft.date.slice(0, 7) !== monthKey) {
    result.otherMonths.push(draft.date.slice(0, 7))
  } else {
    const entry = { amounts: {} }
    if (cashAmount !== null) {
      entry.o_ca = cashAmount
      result.cellCount++
    }
    if (totalAmount !== null) {
      entry.o_post = totalAmount
      result.cellCount++
    }
    for (const l of merged) {
      if (!l.target) continue
      entry.amounts[l.target.id] = l.amount
      result.cellCount++
    }
    // A payment type the picture has no line for means nothing was paid that way:
    // fill 0 (Cash -> O.CA 0 too). Only once something real was read, and never over
    // a number the sheet already holds (an automatic 0 must not wipe typed figures).
    if (result.cellCount > 0) {
      const existing = days?.[draft.date]
      const taken = new Set(Object.keys(entry.amounts))
      for (const t of types) {
        // Self order kiosk is not on the POS Payments screen: it comes from 營業's Self O (left empty so that default applies).
        if (t.name === KIOSK_NAME || taken.has(t.id) || toNum(existing?.amounts?.[t.id]) !== null) continue
        entry.amounts[t.id] = 0
        zeroFilled.push(t.name)
        result.cellCount++
      }
      if (!hasCash && toNum(existing?.o_ca) === null) {
        entry.o_ca = 0
        zeroCash = true
        result.cellCount++
      }
      result.entries[draft.date] = entry
      result.dayCount = 1
    }
  }
  return { merged, hasCash, cashAmount, totalAmount, sum, sumOk, zeroFilled, zeroCash, result }
}

// Used by the OCR step: text -> a ready-to-edit draft (cents -> dollar strings).
export function textToDraft(text) {
  const read = parseReportText(text)
  const fixedRead = repairWithSum(read.lines, read.totalCents)
  return {
    date: read.from,
    dateTo: read.to,
    lines: fixedRead.lines.map((l) => ({ label: l.label, amount: String(dollars(l.cents)) })),
    total: fixedRead.totalCents === null ? '' : String(dollars(fixedRead.totalCents)),
    fixed: fixedRead.fixed && {
      label: fixedRead.fixed.label,
      from: dollars(fixedRead.fixed.from),
      to: dollars(fixedRead.fixed.to),
    },
    hadTotal: read.totalCents !== null,
  }
}
