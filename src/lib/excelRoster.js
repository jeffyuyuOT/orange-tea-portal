import * as XLSX from 'xlsx'
import { format, parseISO } from 'date-fns'

// Manage Roster's spreadsheet is a "grid" layout that mirrors how the
// manager already builds rosters in Excel: one Name column, then an S/E
// (start/end) column pair per weekday, a Break sub-row under each staff
// member's shift row, and computed Total hr / WKD hr columns at the end.
// This file is the one place that knows that layout, in both directions:
// generating a blank template, parsing an uploaded/pasted-together
// workbook back into flat shift records, and exporting the current grid
// (single store, or one sheet per store for the admin multi-store export).

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Column layout (0-indexed): Name, then 7×(S,E), then Total hr, then WKD hr.
// This is what this app's OWN template/export (buildHeaderRows et al, below)
// always produces — but an uploaded file doesn't have to be one of those; see
// findDayColumns' comment for why parseRosterGrid can't just trust these
// fixed indices for a file it didn't generate itself.
const NAME_COL = 0
const FIRST_DAY_COL = 1
const TOTAL_COL = FIRST_DAY_COL + 7 * 2 // 15
const WKD_COL = TOTAL_COL + 1 // 16
const LAST_COL = WKD_COL

function round2(n) {
  return Math.round(n * 100) / 100
}

// ---- decimal-hour ("11", "22.5") <-> "HH:MM:SS" (Postgres `time`) --------
// The manager's own roster writes shift times as plain decimal hours
// (22.5 = 10:30pm) rather than clock strings, so the whole grid — on
// screen and in the spreadsheet — speaks decimal hours; these two
// functions are the only place that talk to the "HH:MM:SS" the database
// column actually stores.
export function decimalToTime(dec) {
  if (dec === '' || dec === null || dec === undefined) return null
  const n = Number(dec)
  if (Number.isNaN(n)) return null
  const h = Math.floor(n)
  const m = Math.round((n - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

export function timeToDecimal(time) {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h)) return ''
  return round2(h + (m || 0) / 60)
}

// Accepts "22", "22.5", "22:30", or an Excel time-of-day serial (SheetJS
// hands back a fraction like 0.9375 for a cell formatted as a time) and
// always returns decimal hours, or '' for blank/unreadable — used when
// reading an uploaded workbook, since a manager might paste times either way.
function parseHourCell(value) {
  if (value === '' || value === null || value === undefined) return ''
  if (typeof value === 'number') {
    return value > 0 && value < 1 ? round2(value * 24) : round2(value)
  }
  const str = String(value).trim()
  if (!str) return ''
  if (str.includes(':')) {
    const [h, m] = str.split(':').map(Number)
    if (Number.isNaN(h)) return ''
    return round2(h + (m || 0) / 60)
  }
  const n = Number(str)
  return Number.isNaN(n) ? '' : n
}

// A shift's paid hours for one day: end − start − break, or 0 if the shift
// isn't fully filled in. `breakHours` is in HALF-HOUR units (1 = 30 min,
// 2 = 1 hr) — the same units the manager already writes in the Excel
// roster's Break row — so it's halved here to get actual hours.
export function dayHours(entry) {
  if (!entry) return 0
  const start = Number(entry.startTime)
  const end = Number(entry.endTime)
  if (entry.startTime === '' || entry.endTime === '' || Number.isNaN(start) || Number.isNaN(end)) return 0
  const brk = (Number(entry.breakHours) || 0) / 2
  return Math.max(0, end - start - brk)
}

// ---- shared grid-building helpers ---------------------------------------
function buildHeaderRows(weekDates) {
  const row1 = Array.from({ length: LAST_COL + 1 }, () => '')
  const row2 = Array.from({ length: LAST_COL + 1 }, () => '')
  row1[NAME_COL] = 'Name'
  weekDates.forEach((d, i) => {
    const c = FIRST_DAY_COL + i * 2
    row1[c] = `${DAY_LABELS[i]} ${format(parseISO(d), 'd-MMM')}`
    row2[c] = 'S'
    row2[c + 1] = 'E'
  })
  row1[TOTAL_COL] = 'Total hr'
  row1[WKD_COL] = 'WKD hr'
  return [row1, row2]
}

function headerMerges() {
  const merges = [
    { s: { r: 0, c: NAME_COL }, e: { r: 1, c: NAME_COL } },
    { s: { r: 0, c: TOTAL_COL }, e: { r: 1, c: TOTAL_COL } },
    { s: { r: 0, c: WKD_COL }, e: { r: 1, c: WKD_COL } },
  ]
  for (let i = 0; i < 7; i++) {
    const c = FIRST_DAY_COL + i * 2
    merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 1 } })
  }
  return merges
}

function gridCols() {
  return [{ wch: 16 }, ...Array.from({ length: 14 }, () => ({ wch: 6 })), { wch: 9 }, { wch: 9 }]
}

function staffFullName(s) {
  return `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim()
}

// The name shown for someone on the roster grid, Excel template/export, and
// import name-matching. Roster Hub > Setting > Name display lets each store
// override this per person; it defaults to first name only (no family
// name), per that page's own stated default. Never blank — falls back to
// the full name if a profile is missing both bits.
export function rosterDisplayName(s) {
  return (s.roster_display_name || s.first_name || staffFullName(s)).trim()
}

// Lets Roster Hub's Pending staff (roster_pending_staff rows — no profiles
// row of their own, since profiles.id is a hard FK to auth.users) slot
// into the same shape `staff` already comes in, so a not-yet-formal person
// can be scheduled ahead of time in the grid/template/export just like a
// real one. `id` stays '' on purpose — see parseRosterGrid's comment on
// ad-hoc rows — so their entries match by name instead of profile id.
export function pendingAsStaff(pendingStaff) {
  return pendingStaff.map((p) => {
    const name = p.roster_display_name || p.display_name
    // roster_order carried through so callers merging this onto `staff`
    // (e.g. ManageRosterPage's templateStaff) can sort the combined list by
    // it — see migration 0059_roster_staff_order_and_hide.sql / Roster Hub
    // > Setting > Roster Staff Order.
    return { id: '', first_name: name, last_name: '', roster_display_name: name, roster_order: p.roster_order ?? 0 }
  })
}

// The effective name a Pending staff entry shows/matches on — their own
// Name display override if they have one, else their original name as
// entered in User Management.
export function pendingRosterName(p) {
  return p.roster_display_name || p.display_name
}

// ---- import name-matching -------------------------------------------------
// Classic edit-distance DP: how many single-character edits turn `a` into
// `b`. Used to catch a typo'd name in an uploaded roster (e.g. "Mile" for
// "Miles") without requiring an exact match.
function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

// True when one name is just the other plus a short trailing initial, e.g.
// "Miles" vs "Miles W" or "Miles W." — that's someone deliberately telling
// two same-first-name people apart, not a typo, so it must never be treated
// as a fuzzy match no matter how small the edit distance looks.
function looksLikeInitialSuffix(a, b) {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (!longer.toLowerCase().startsWith(shorter.toLowerCase())) return false
  const rest = longer.slice(shorter.length).trim().replace(/\.$/, '')
  return rest.length >= 1 && rest.length <= 2
}

// For each raw name typed into an uploaded roster that didn't already match
// an active staff member (parseRosterGrid only matches those), decide what
// to do with it against everyone else already known for the store —
// `known` is [{ type: 'staff' | 'pending', id, name }, ...] covering both
// real staff (by their roster display name) and existing Pending staff:
//   - 'exact'  already matches a Pending name exactly (case-insensitive)
//   - 'fuzzy'  within 2 edits of a known name (and not an initial-suffix
//              case) — close enough to auto-treat as the same person, since
//              it's almost certainly a typo
//   - 'new'    no close match — a genuinely new person, needs the manager
//              to confirm before it's added to Pending staff
export function buildReconcilePlan(rawNames, known) {
  return rawNames.map((rawName) => {
    const exact = known.find((k) => k.name.toLowerCase() === rawName.toLowerCase())
    if (exact) return { rawName, status: 'exact', match: exact }
    const candidates = known
      .filter((k) => !looksLikeInitialSuffix(rawName, k.name))
      .map((k) => ({ k, dist: levenshtein(rawName.toLowerCase(), k.name.toLowerCase()) }))
      .filter((c) => c.dist <= 2)
      .sort((a, b) => a.dist - b.dist)
    if (candidates.length) return { rawName, status: 'fuzzy', match: candidates[0].k }
    return { rawName, status: 'new', match: null }
  })
}

// ---- styled export (ExcelJS) ----------------------------------------------
// Jeff, 2026-10-03: "roster history匯出班表...break次數是合併儲存格並且數字
// 是紅色的，還沒qualified的員工名字跟時間是紅色的，每一個員工之間是雙橫線
// 隔開" — wants History's exported workbook to visually match the sheet he
// already builds by hand in Excel: Break's day cells merged (one number per
// day actually worked, not per S/E column), Break numbers in red, an
// unqualified staff member's whole name+shift-times row in red too, and a
// double ruled line separating each staff member's 2-row block from the
// next. None of that is possible with the plain `xlsx` package used
// everywhere else in this file (reading an uploaded file, and the blank
// template download) — SheetJS's free/community build can only write
// values, column widths and merges, never cell colors or custom borders
// (that's SheetJS Pro, a paid add-on). ExcelJS is a separate, actively
// maintained library that supports all of this directly and ships a
// browser build (its package.json's own "browser" field points Vite at it
// automatically, no extra config) — used here ONLY for these two "already
// a finished report, not meant to be re-uploaded" exports. The working
// round-trip pair (downloadRosterTemplate's blank template / parseRosterGrid's
// upload reader, both used by Manage Roster) deliberately stays on plain
// `xlsx`, unstyled and in the original single-Name-column layout, since
// changing that shape risks the upload-side column/merge-propagation logic
// above (findDayColumns, the Name-column merge guard, etc.) that was
// already hard-won against Jeff's own real-world files.
const STYLED_DAY_LABELS = DAY_LABELS
const STYLED_NAME_COL = 1
const STYLED_BREAK_LABEL_COL = 2
const STYLED_FIRST_DAY_COL = 3
const STYLED_TOTAL_COL = STYLED_FIRST_DAY_COL + 14 // 17
const STYLED_WKD_COL = STYLED_TOTAL_COL + 1 // 18

const RED_FONT = { argb: 'FFCC0000' }
const GRID_BORDER = { style: 'thin', color: { argb: 'FFBFBFBF' } }
const HEADER_RULE = { style: 'thick', color: { argb: 'FF000000' } }
const PERSON_RULE = { style: 'double', color: { argb: 'FF000000' } }

function styledBorder(cell, bottom) {
  cell.border = { top: GRID_BORDER, left: GRID_BORDER, right: GRID_BORDER, bottom: bottom ?? GRID_BORDER }
}

// ExcelJS itself is loaded on demand (dynamic import, below) rather than a
// static top-level one — it's a sizeable library (zip/style handling on
// top of the spreadsheet writer) that only two admin/manager-only buttons
// ever need (History's "Export" and "Export multiple stores"), so bundling
// it into the app's main chunk would make every visitor download it on
// every page load just to make those two sheets possible. Loading it only
// when someone actually clicks Export also kept the main chunk under
// vite-plugin-pwa's 2 MiB default precache ceiling — a static import here
// pushed it past that and failed the Cloudflare build outright (same
// "build failed, nothing deploys" failure mode as the missing-file import
// earlier today, just from bundle size instead of a missing module).
async function loadExcelJS() {
  const mod = await import('exceljs')
  return mod.default ?? mod
}

// Builds one styled worksheet (header + one Shift/Break row pair per
// person) directly against an ExcelJS workbook — the styled-export sibling
// of buildHeaderRows/buildGridRows above, sharing their day-label/column
// conventions but not their array-of-arrays shape (ExcelJS addresses cells
// and merges directly). `staff` should be every active staff member for the
// store (shown even with zero shifts); any entry with no matching profile
// (an ad-hoc/casual name typed straight into Manage Roster) gets its own
// row too, same as the plain export.
function buildStyledSheet(workbook, storeName, staff, weekDates, entries) {
  const sheet = workbook.addWorksheet((storeName || 'Roster').slice(0, 31))

  sheet.mergeCells(1, STYLED_NAME_COL, 2, STYLED_BREAK_LABEL_COL)
  sheet.getCell(1, STYLED_NAME_COL).value = 'Name'
  sheet.mergeCells(1, STYLED_TOTAL_COL, 2, STYLED_TOTAL_COL)
  sheet.getCell(1, STYLED_TOTAL_COL).value = 'Total hr'
  sheet.mergeCells(1, STYLED_WKD_COL, 2, STYLED_WKD_COL)
  sheet.getCell(1, STYLED_WKD_COL).value = 'WKD hr'
  weekDates.forEach((d, i) => {
    const c = STYLED_FIRST_DAY_COL + i * 2
    sheet.mergeCells(1, c, 1, c + 1)
    sheet.getCell(1, c).value = `${STYLED_DAY_LABELS[i]} ${format(parseISO(d), 'd-MMM')}`
    sheet.getCell(2, c).value = 'S'
    sheet.getCell(2, c + 1).value = 'E'
  })
  for (let c = STYLED_NAME_COL; c <= STYLED_WKD_COL; c++) {
    for (let r = 1; r <= 2; r++) {
      const cell = sheet.getCell(r, c)
      cell.font = { bold: true }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      styledBorder(cell, r === 2 ? HEADER_RULE : GRID_BORDER)
    }
  }
  sheet.getCell(1, STYLED_NAME_COL).alignment = { vertical: 'middle', horizontal: 'center' }

  const extraNames = Array.from(new Set(entries.filter((e) => !e.profileId && e.staffName).map((e) => e.staffName)))
  const people = [
    ...staff.map((s) => ({ id: s.id, name: rosterDisplayName(s), qualified: s.qualified })),
    ...extraNames.map((name) => ({ id: '', name, qualified: true })),
  ]

  let row = 3
  people.forEach(({ id, name, qualified }) => {
    const shiftRow = row
    const breakRow = row + 1
    // Staff on the roster default to qualified unless the profile says
    // otherwise (`qualified === false`) — an ad-hoc/casual name above has
    // no profile at all, so it never gets flagged red just for being new.
    const unqualified = qualified === false

    sheet.mergeCells(shiftRow, STYLED_NAME_COL, breakRow, STYLED_NAME_COL)
    const nameCell = sheet.getCell(shiftRow, STYLED_NAME_COL)
    nameCell.value = name
    nameCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    if (unqualified) nameCell.font = { color: RED_FONT }

    const breakLabelCell = sheet.getCell(breakRow, STYLED_BREAK_LABEL_COL)
    breakLabelCell.value = 'Break'
    breakLabelCell.font = { color: RED_FONT }
    breakLabelCell.alignment = { vertical: 'middle', horizontal: 'left' }

    let total = 0
    let wkd = 0
    weekDates.forEach((date, i) => {
      const entry = entries.find((e) => (id ? e.profileId === id : e.staffName === name) && e.date === date)
      const c = STYLED_FIRST_DAY_COL + i * 2
      if (entry) {
        const startCell = sheet.getCell(shiftRow, c)
        const endCell = sheet.getCell(shiftRow, c + 1)
        startCell.value = entry.startTime === '' || entry.startTime == null ? null : entry.startTime
        endCell.value = entry.endTime === '' || entry.endTime == null ? null : entry.endTime
        startCell.alignment = { horizontal: 'center' }
        endCell.alignment = { horizontal: 'center' }
        if (unqualified) {
          startCell.font = { color: RED_FONT }
          endCell.font = { color: RED_FONT }
        }
        if (entry.breakHours !== '' && entry.breakHours != null) {
          sheet.mergeCells(breakRow, c, breakRow, c + 1)
          const breakCell = sheet.getCell(breakRow, c)
          breakCell.value = entry.breakHours
          breakCell.font = { color: RED_FONT }
          breakCell.alignment = { vertical: 'middle', horizontal: 'center' }
        }
        const h = dayHours(entry)
        total += h
        if (i === 5 || i === 6) wkd += h
      }
    })

    sheet.mergeCells(shiftRow, STYLED_TOTAL_COL, breakRow, STYLED_TOTAL_COL)
    sheet.mergeCells(shiftRow, STYLED_WKD_COL, breakRow, STYLED_WKD_COL)
    sheet.getCell(shiftRow, STYLED_TOTAL_COL).value = total ? round2(total) : null
    sheet.getCell(shiftRow, STYLED_WKD_COL).value = wkd ? round2(wkd) : null
    sheet.getCell(shiftRow, STYLED_TOTAL_COL).alignment = { vertical: 'middle', horizontal: 'center' }
    sheet.getCell(shiftRow, STYLED_WKD_COL).alignment = { vertical: 'middle', horizontal: 'center' }

    for (let c = STYLED_NAME_COL; c <= STYLED_WKD_COL; c++) {
      styledBorder(sheet.getCell(shiftRow, c))
      // The double rule belongs on every cell in the LAST row of this
      // person's block, so it reads as one continuous line under them —
      // not just under whichever day column happened to have a merge.
      styledBorder(sheet.getCell(breakRow, c), PERSON_RULE)
    }

    row += 2
  })

  sheet.getColumn(STYLED_NAME_COL).width = 14
  sheet.getColumn(STYLED_BREAK_LABEL_COL).width = 7
  for (let c = STYLED_FIRST_DAY_COL; c < STYLED_TOTAL_COL; c++) sheet.getColumn(c).width = 6.5
  sheet.getColumn(STYLED_TOTAL_COL).width = 9
  sheet.getColumn(STYLED_WKD_COL).width = 9
  sheet.views = [{ state: 'frozen', ySplit: 2 }]
}

// ExcelJS has no writeFile() of its own (it's Node/browser-agnostic) — this
// is the browser-side equivalent of XLSX.writeFile for a workbook built
// above: render to a buffer, then the standard Blob-link-click download
// trick, same as every other client-side "download this file" spot in the
// app already uses for things like storage exports.
async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---- template download ---------------------------------------------------
// A blank grid, pre-filled with every active staff member's name, ready to
// type hours straight into (in Excel, offline) and upload back with
// parseRosterGrid.
export function downloadRosterTemplate(storeName, staff, weekDates, filename) {
  const [row1, row2] = buildHeaderRows(weekDates)
  const rows = [row1, row2]
  staff.forEach((s) => {
    const shiftRow = Array.from({ length: LAST_COL + 1 }, () => '')
    const breakRow = Array.from({ length: LAST_COL + 1 }, () => '')
    shiftRow[NAME_COL] = rosterDisplayName(s)
    breakRow[NAME_COL] = 'Break (½h units)'
    rows.push(shiftRow, breakRow)
  })
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!merges'] = headerMerges()
  sheet['!cols'] = gridCols()
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, (storeName || 'Roster').slice(0, 31))
  XLSX.writeFile(wb, filename || `roster-template-${weekDates[0] || ''}.xlsx`)
}

// Finds the sheet matching THIS store — every sheet this app ever writes
// is named after the store that owns it, capped at 31 characters the same
// way Excel itself caps tab names (see downloadRosterTemplate/
// exportRosterGrid/exportMultiStoreWorkbook below, all
// `(storeName || 'Roster').slice(0, 31)`), so the same truncation is
// applied here before comparing, case/whitespace insensitive.
//
// This is what makes uploading a multi-store export (admin's "one sheet
// per store" workbook — exportMultiStoreWorkbook) into ONE store's Manage
// Roster only ever pull that store's own tab — it used to always read
// wb.SheetNames[0] regardless of which store's page the upload happened
// on, so a manager at, say, Toowong could silently end up importing
// whichever store's tab happened to come first in the file instead of
// Toowong's own.
//
// A single-sheet file is always accepted as-is (there's no ambiguity to
// get wrong), even if its one tab isn't named exactly what's expected —
// covers a template someone renamed by hand, or `storeName` not being
// known yet. With more than one sheet, though, silently falling back to
// "just take the first one" would recreate the exact bug this is fixing,
// so that case throws instead, telling the caller which tabs actually
// exist.
function findStoreSheet(wb, storeName) {
  if (wb.SheetNames.length === 1) return wb.Sheets[wb.SheetNames[0]]
  const target = (storeName || '').trim().slice(0, 31).toLowerCase()
  if (target) {
    const matchName = wb.SheetNames.find((n) => n.trim().toLowerCase() === target)
    if (matchName) return wb.Sheets[matchName]
  }
  throw new Error(
    `Couldn't find a "${storeName || 'this store'}" tab in that file — it has: ${wb.SheetNames.join(', ')}. Make sure you're uploading the right file, and that the tab for this store is named exactly "${storeName}".`
  )
}

// ---- upload / parse: locating the real day columns ------------------------
// Excel's own date epoch is 1899-12-30 (serial day 0); read via
// sheet_to_json without `cellDates: true` (parseRosterGrid doesn't set it),
// a date-formatted cell comes back as this kind of decimal serial number
// rather than a JS Date or a string — the constant below is the day-count
// offset to/from the JS epoch (1970-01-01) needed to compute it for a given
// ISO date.
const EXCEL_EPOCH_OFFSET_DAYS = 25569

function excelSerialFromISODate(iso) {
  const d = parseISO(iso)
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) + EXCEL_EPOCH_OFFSET_DAYS
}

// Jeff (2026-09): parseRosterGrid used to just assume every uploaded file
// has Monday's "S" column at FIRST_DAY_COL (immediately after Name) — true
// for anything downloaded from this app's own "Download template"/"Export
// current grid", but NOT for a roster spreadsheet someone maintains
// independently. Jeff's own master roster file (one tab per store, dates
// typed as real Excel dates, an extra blank spacer column between Name and
// Monday, plus extra Public-Holiday tracking columns further right that
// this app doesn't even have fields for) has Monday's "S" one column later
// than that fixed assumption — which shifted every single day's columns:
// each day's real "S" got read as the PREVIOUS day's "E", every real "E"
// got read as the NEXT day's "S", and the Break row's values (still aligned
// under the correct day columns) never lined up with where the fixed
// layout expected them, so they silently came back empty. That's exactly
// Jeff's "start time讀成end time、break的數值也讀不進去" report.
//
// Fix: don't assume — find each weekday's actual column by matching the
// workbook's own header cells against the week actually being imported
// (`weekDates`, always Monday-first, already known regardless of what's in
// the file). A day's header column is recognized either by a raw Excel
// date serial equal to that day's date (a workbook that stores real dates,
// like Jeff's), or by this app's own "Mon 28-Sep"-style text label (a file
// that came from this app's own template/export). Matching only looks at
// columns after Name (c >= 1) and, for the text form, requires an exact
// "Mon" match or "Mon " + something (a trailing space) rather than a bare
// startsWith — so a staff member genuinely named e.g. "Monica" sitting in
// the header's row-scan window can never be mistaken for the Monday
// column. Returns null (caller falls back to the old fixed layout) if any
// of the 7 days can't be found at all — a file whose dates don't match the
// week being imported is a different, more serious problem than a shifted
// column, and shouldn't be silently guessed at here.
function findDayColumns(aoa, weekDates, headerRows = 8) {
  const cols = weekDates.map((iso, i) => {
    const serial = excelSerialFromISODate(iso)
    const label = DAY_LABELS[i].toLowerCase()
    for (let r = 0; r < Math.min(headerRows, aoa.length); r++) {
      const row = aoa[r] ?? []
      for (let c = 1; c < row.length; c++) {
        const v = row[c]
        if (typeof v === 'number' && Math.round(v) === serial) return c
        if (typeof v === 'string') {
          const text = v.trim().toLowerCase()
          if (text === label || text.startsWith(`${label} `)) return c
        }
      }
    }
    return null
  })
  if (cols.some((c) => c === null)) return null
  // Sanity check: real weekday columns are always in Monday→Sunday order,
  // whatever else surrounds them — if that's not true, something matched
  // by coincidence rather than really being this week's header row.
  for (let i = 1; i < cols.length; i++) {
    if (cols[i] <= cols[i - 1]) return null
  }
  return cols
}

// Once Monday's column is known, finds where the header block actually
// ends: both this app's own template (2 header rows: day+date combined,
// then S/E) and Jeff's master file (3 header rows: date, day name, S/E)
// put an exact "S" label directly above the first real data row, in
// Monday's own column — so the row right after that "S" is always where
// staff rows start, regardless of how many rows came before it. Returns
// null (caller falls back to the old fixed 2-row assumption) if no such
// row shows up within the scanned window.
function findFirstDataRow(aoa, mondayCol, headerRows = 8) {
  for (let r = 0; r < Math.min(headerRows, aoa.length); r++) {
    if (String(aoa[r]?.[mondayCol] ?? '').trim() === 'S') return r + 1
  }
  return null
}

// ---- upload / parse -------------------------------------------------------
// Parses a workbook built in this same grid shape back into flat shift
// records: { profileId, staffName, date, startTime, endTime, breakHours }.
// Matches each row's Name cell against `staff` by roster display name
// (case/space insensitive); an unmatched name is kept with profileId '' so
// it still shows up as its own row in the grid (e.g. a casual not yet in
// Staff Information) rather than being silently dropped — ManageRosterPage
// runs those through buildReconcilePlan afterwards to catch typos and
// confirm genuinely new names. `storeName` decides WHICH sheet gets read
// when the file has more than one — see findStoreSheet above.
export function parseRosterGrid(file, staff, weekDates, storeName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const sheet = findStoreSheet(wb, storeName)
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
        // SheetJS's array read only puts a value in a merged range's
        // TOP-LEFT cell — every other cell the merge covers comes back as
        // '' (via defval above) even though Excel visually shows the same
        // value across the whole merge. A manager merging a Break row's day
        // cells together (the same break often applies every day that
        // week) would otherwise silently read as "no break recorded" for
        // every cell but the first one in that merge — which is what the
        // fix below (propagating each merge's corner value across every
        // cell it covers) originally targeted.
        //
        // Jeff (2026-09): after that fix shipped, start/end times started
        // reading wrong across many rows — root cause is this same
        // propagation ALSO applying to the Name column (column 0). A very
        // natural thing for a manager to do for a tidier-looking sheet is
        // select a staff member's Shift-row Name cell together with their
        // Break-row Name cell right below it and merge them vertically
        // (Excel shows one name spanning both rows). But merging in Excel
        // itself immediately DISCARDS the non-corner cell's original text —
        // so the Break row's own "Break (½h units)" label is gone from the
        // file the moment that merge is created, before this app ever reads
        // it. Propagating the shift row's real name into that now-blank
        // cell (which is what the code used to do here) made the
        // break-row-detection check further below — which looks for the
        // literal text "break" in that cell — treat the break row as a
        // SECOND, separate employee row using the same name as the row
        // above it, and read that row's break-hours values (small numbers
        // like "1" for a half-hour) as if they were real clock-in times —
        // producing a bogus duplicate "employee" with a nonsense start time
        // and no end time, for every staff member whose sheet had this
        // merge. That's the "start/end read into the wrong cell" symptom.
        //
        // Fix: never propagate INTO the Name column. Every row's Name cell
        // always has an explicit, correct value straight from our own
        // export (the real name on the shift row, the literal
        // "Break (½h units)" label on the break row) — there's no
        // legitimate case within this app's own template where that column
        // needs "filling in" from a merge. Leaving it blank instead (which
        // is genuinely how Excel already left it) means the "if (!name)"
        // guard in the row loop below just skips that one row as empty —
        // losing that employee's break-hours for the affected day(s), but
        // never fabricating a bogus shift or a duplicate employee. Break
        // row day-cell merges (columns 1+) are completely unaffected by
        // this and keep working exactly as before.
        ;(sheet['!merges'] || []).forEach((m) => {
          const corner = aoa[m.s.r]?.[m.s.c]
          for (let r = m.s.r; r <= m.e.r; r++) {
            if (!aoa[r]) aoa[r] = []
            for (let c = m.s.c; c <= m.e.c; c++) {
              if (r === m.s.r && c === m.s.c) continue
              if (c === NAME_COL) continue
              aoa[r][c] = corner
            }
          }
        })
        // Jeff (2026-09): locate each weekday's real column and the real
        // first data row from the file's own header instead of trusting
        // this app's own fixed layout — see findDayColumns' long comment
        // above for why (Jeff's own master roster spreadsheet, not
        // generated by this app, has Monday's "S" one column later than
        // that fixed assumption, which silently shifted every day's
        // start/end/break reading by one column). Falls back to the old
        // fixed positions if detection can't find all 7 days or the
        // header's "S" row — e.g. a file with no recognizable dates at
        // all — so nothing already working regresses.
        const detectedDayCols = findDayColumns(aoa, weekDates)
        const detectedFirstDataRow = detectedDayCols ? findFirstDataRow(aoa, detectedDayCols[0]) : null
        const dayCols = detectedDayCols && detectedFirstDataRow !== null ? detectedDayCols : weekDates.map((_, di) => FIRST_DAY_COL + di * 2)
        const firstDataRow = detectedDayCols && detectedFirstDataRow !== null ? detectedFirstDataRow : 2

        const byName = new Map(staff.map((s) => [rosterDisplayName(s).toLowerCase(), s]))

        // Jeff (2026-09): the row-loop below used to only ever skip a blank
        // Name cell or the literal footer "Total" row — fine as long as
        // every non-blank Name cell really was a person. That stopped being
        // true once the hour-less-name fix just above started keeping a
        // name alive even with zero data: his file's duplicated-second-copy
        // block (see the dedup comment further down) repeats its OWN title
        // row (the store's name, e.g. "Brookside") and its own "Name" header
        // cell partway down the sheet, and both are non-blank, zero-data
        // "name" cells exactly like a genuinely new hour-less employee would
        // be — so without this, they'd now get pushed through as bogus
        // "new person" placeholders (Jeff would be asked to add a phantom
        // "Brookside" and "Name" to Pending staff). Neither can ever be a
        // real person's name, so both are skipped outright here, the same
        // way "Total" already was.
        const skipNames = new Set(['total', 'name', (storeName || '').trim().toLowerCase()].filter(Boolean))

        const entries = []
        let i = firstDataRow
        while (i < aoa.length) {
          const row = aoa[i] ?? []
          const name = String(row[NAME_COL] ?? '').trim()
          if (!name || skipNames.has(name.toLowerCase())) {
            i += 1
            continue
          }
          let breakRow = null
          const next = aoa[i + 1]
          // The "Break" label isn't always in the Name column itself —
          // Jeff's own master file puts it one column over instead (see
          // findDayColumns' comment) — so this checks every column before
          // the first real day column rather than just NAME_COL.
          const nextIsBreakRow = next && next.slice(0, dayCols[0]).some((v) => String(v ?? '').trim().toLowerCase().startsWith('break'))
          if (nextIsBreakRow) {
            breakRow = next
            i += 2
          } else {
            i += 1
          }
          const match = byName.get(name.toLowerCase())
          let hadAnyData = false
          weekDates.forEach((date, di) => {
            const c = dayCols[di]
            const startTime = parseHourCell(row[c])
            const endTime = parseHourCell(row[c + 1])
            const breakHours = breakRow ? parseHourCell(breakRow[c]) : ''
            if (startTime === '' && endTime === '' && breakHours === '') return
            hadAnyData = true
            entries.push({
              profileId: match?.id ?? '',
              staffName: match ? rosterDisplayName(match) : name,
              date,
              startTime,
              endTime,
              breakHours,
              notes: '',
            })
          })
          // Jeff (2026-09): a row with a real name but literally no hours
          // filled in for ANY day that week (someone new whose shifts just
          // haven't started yet, or a manager who typed the name ahead of
          // filling in hours) used to vanish from the import completely —
          // zero entries for that name meant it never even reached
          // findsNeedingReview below, so it could never be offered for
          // Pending staff either ("brookside的leah沒有匯入" — Leah's row in
          // his file had a name but every S/E/Break cell blank). An
          // already-known person (`match` truthy) doesn't need this: they
          // already show up on the grid via `staff` regardless of hours. So
          // this only keeps a genuinely unmatched, hour-less name alive — as
          // a zero-hour placeholder entry that ManageRosterPage's doPersist
          // row filter (`startTime !== '' && endTime !== ''`) strips back
          // out before anything is ever written to roster_entries — purely
          // so the name itself survives to the same new-name review /
          // Pending-staff flow as anyone whose hours WERE filled in.
          if (!hadAnyData && !match) {
            entries.push({ profileId: '', staffName: name, date: weekDates[0], startTime: '', endTime: '', breakHours: '', notes: '' })
          }
        }
        // Jeff (2026-09): his own master roster file turned out to have the
        // ENTIRE grid duplicated a second time further down the same sheet
        // (rows 1–34 and rows 35–68 were identical, one written as decimal
        // hours and the mirrored copy as "HH:MM" text — probably an Excel
        // formula view he kept for his own reading, syncing off the first
        // block) — this app's sheet only ever has one such block and never
        // stops looking once it hits the bottom of it, so it kept right on
        // reading that second copy as if it were more staff rows, doubling
        // every entry. There's no reliable, generic way to detect "a second
        // copy of the same grid starts here" up front, so instead: this
        // app's whole data model already only supports one shift per person
        // per day (Total hr/WKD hr, dayHours() etc. all assume that), so
        // de-duping down to one entry per (person, date) — keeping
        // whichever comes FIRST in the file — is always safe and also
        // guards against any other accidental duplicate row, not just this
        // specific shape of file.
        const seenPersonDate = new Set()
        const deduped = entries.filter((e) => {
          const key = `${e.profileId || e.staffName}::${e.date}`
          if (seenPersonDate.has(key)) return false
          seenPersonDate.add(key)
          return true
        })
        resolve(deduped)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// ---- export ---------------------------------------------------------------
// Exports the current (already-computed) grid — real numbers, not
// formulas, since the app has already done the arithmetic. Styled per
// Jeff's spec (buildStyledSheet above): merged per-day Break cells in red,
// an unqualified staff member's name+shift times in red, a double rule
// between each person's block. Now async (ExcelJS's own writeBuffer is
// promise-based) — both call sites already `await` their export call.
export async function exportRosterGrid(storeName, staff, weekDates, entries, filename) {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  buildStyledSheet(workbook, storeName, staff, weekDates, entries)
  await downloadWorkbook(workbook, filename)
}

// One sheet per store (admin multi-store export), same styling as above.
// Each entry in `storeSheets` is { storeName, staff, weekDates, entries }.
export async function exportMultiStoreWorkbook(storeSheets, filename) {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  storeSheets.forEach(({ storeName, staff, weekDates, entries }) => {
    buildStyledSheet(workbook, storeName, staff, weekDates, entries)
  })
  await downloadWorkbook(workbook, filename)
}
