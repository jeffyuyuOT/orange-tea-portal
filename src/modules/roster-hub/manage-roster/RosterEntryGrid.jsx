import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { dayHours, rosterDisplayName, pendingRosterName } from '../../../lib/excelRoster'
import { shiftConflictsWithAvailability, minutesToLabel } from '../../../lib/availability'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

// Always read the weekday off the actual date, never off its position in the
// week — "Week starting (Mon)" is only a hint for what to pick, it doesn't
// force the chosen date to be a Monday, so a fixed ['Mon','Tue',...] array
// applied by index used to mislabel every column whenever the picked start
// date wasn't really a Monday (e.g. picking a Tuesday still showed "Mon" in
// the first column).
function weekdayLabel(dateStr) {
  return format(parseISO(dateStr), 'EEE')
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// The same Name × day-of-week grid the manager already builds in Excel:
// each staff member gets a Shift row (Start/End per day) and, right below
// it, a Break row (hours of unpaid break that day) — Total hr and WKD hr
// (Sat+Sun) are computed live from those as you type, same as the
// exported workbook.
//
// `entries` stays a flat array (one record per person + date, matching a
// roster_entries row) — this component only pivots it into a grid for
// editing; ManageRosterPage still saves/loads the flat shape.
export default function RosterEntryGrid({
  staff,
  pendingStaff = [],
  weekDates,
  entries,
  setEntries,
  onHideStaff,
  // { profileId: { 'yyyy-MM-dd': { dayRow, windows } } } — that week's
  // declared availability for every real staff member on this roster (see
  // ManageRosterPage), used only for the soft conflict check below. Absent
  // (still loading, or nobody's declared anything) just means the check
  // never fires — never blocks entering hours.
  availabilityByProfile,
}) {
  // "+ Add row" placeholders for a casual/one-off name not in Staff
  // Information yet. Keyed by a stable id (not by the typed name) so
  // typing into the Name field doesn't remount the row on every keystroke.
  const [manualRows, setManualRows] = useState([])

  // Jeff, 2026-09: "排時間的時候如果跟該員的available time有衝突的話，也會
  // 跳出警示窗提示該時間不在該員的available time裡並進行確認(還是可以排只是
  // 會提示...班表可以正常先排)" — soft/overridable: the hours the manager
  // typed are already saved in `entries` by the time this fires (on blur),
  // this dialog is purely a heads-up they click past, never something that
  // reverts or blocks the entry.
  const [conflictWarning, setConflictWarning] = useState(null)

  function checkConflict(row, date) {
    if (!row.profileId || !availabilityByProfile) return
    const entry = entries.find((e) => matches(row, e) && e.date === date)
    const start = entry?.startTime
    const end = entry?.endTime
    if (start === '' || start == null || end === '' || end == null) return
    const avail = availabilityByProfile[row.profileId]?.[date]
    if (!avail) return
    if (shiftConflictsWithAvailability(Number(start), Number(end), avail.dayRow, avail.windows)) {
      setConflictWarning({ name: row.name, date, start: Number(start), end: Number(end) })
    }
  }

  const importedNames = useMemo(
    () => Array.from(new Set(entries.filter((e) => !e.profileId && e.staffName).map((e) => e.staffName))),
    [entries]
  )

  const rows = useMemo(() => {
    // `kind` (+ the id fields it carries) is what removeRow needs to tell a
    // genuinely-auto-populated person (staff/pending, still exists in User
    // Management / Pending staff — the ✕ should only hide them from THIS
    // week) apart from an imported/manually-typed name (the ✕ should just
    // wipe their hours, same as before — there's nothing else of theirs to
    // keep).
    const staffRows = staff.map((s) => ({
      key: s.id,
      profileId: s.id,
      pendingId: '',
      name: rosterDisplayName(s),
      kind: 'staff',
      order: s.roster_order ?? 0,
      // Not-yet-Qualified (profiles.qualified, migration
      // 0049_staff_qualified.sql) staff get their name/shift time shown in
      // red on the grid — a quick visual flag while building the roster.
      // Only real staff carry this concept; Pending staff/imported/manual
      // rows below never do.
      qualified: s.qualified === true,
    }))
    // Pending staff (Roster Hub > Setting > Roster Staff Order) always get
    // a row too, same as real staff — so a not-yet-formal hire can be
    // scheduled ahead of time instead of only appearing after a "+ Add
    // row"/import happens to use their exact name for this particular
    // week. `staff` and `pendingStaff` are each already sorted by
    // roster_order when they arrive here (ManageRosterPage's queries), but
    // that only orders each group internally — merging the two groups by
    // `order` below (rather than just staff-then-pending) is what actually
    // lets a manager interleave a Pending hire among real staff.
    const pendingRows = pendingStaff.map((p) => ({
      key: `pending:${p.id}`,
      profileId: '',
      pendingId: p.id,
      name: pendingRosterName(p),
      kind: 'pending',
      order: p.roster_order ?? 0,
    }))
    const orderedPeopleRows = [...staffRows, ...pendingRows].sort((a, b) => a.order - b.order)
    const staffNamesLower = new Set(staffRows.map((r) => r.name.toLowerCase()))
    // A name typed into a "+ Add row" casual slot (or a Pending staff row
    // above) has no profileId, so the moment hours are entered for it, that
    // same name also shows up in `importedNames` below (it scans `entries`
    // for any profileId-less staffName). Without excluding those names here
    // too, that one person would render TWICE — once as their own row,
    // once again as a duplicate "imported" row carrying the identical
    // hours — the instant their hours are filled in.
    const manualNamesLower = new Set(
      [...manualRows.map((m) => m.name), ...pendingRows.map((p) => p.name)].map((n) => n.trim().toLowerCase()).filter(Boolean)
    )
    // Stable per-index key (not per-name) — see comment above.
    const importedRows = importedNames
      .filter((name) => !staffNamesLower.has(name.toLowerCase()) && !manualNamesLower.has(name.toLowerCase()))
      .map((name, i) => ({ key: `imported:${i}`, profileId: '', pendingId: '', name, kind: 'imported' }))
    const manual = manualRows.map((m) => ({ key: m.key, profileId: '', pendingId: '', name: m.name, kind: 'manual' }))
    return [...orderedPeopleRows, ...importedRows, ...manual]
  }, [staff, pendingStaff, importedNames, manualRows])

  function matches(row, e) {
    return row.profileId ? e.profileId === row.profileId : e.staffName === row.name
  }

  function findEntry(row, date) {
    return entries.find((e) => matches(row, e) && e.date === date)
  }

  function updateCell(row, date, patch) {
    if (!row.name.trim()) return // ad-hoc row needs a name before it can take hours
    setEntries((prev) => {
      const idx = prev.findIndex((e) => matches(row, e) && e.date === date)
      if (idx === -1) {
        return [
          ...prev,
          { profileId: row.profileId, staffName: row.name, date, startTime: '', endTime: '', breakHours: '', notes: '', ...patch },
        ]
      }
      const merged = { ...prev[idx], ...patch }
      const next = [...prev]
      if (merged.startTime === '' && merged.endTime === '' && (merged.breakHours === '' || merged.breakHours == null)) {
        next.splice(idx, 1)
        return next
      }
      next[idx] = merged
      return next
    })
  }

  function renameRow(row, newName) {
    // A manual "+ Add row" name used to only enter `entries` (and therefore
    // ManageRosterPage's Save/Submit "is this a new person?" check) once an
    // hour was actually typed for it — a name typed in and saved with no
    // hours yet (someone new whose first shift isn't this week) silently
    // vanished on save, never even offered for Pending staff (Jeff,
    // 2026-09: "add row輸入新的名字儲存也沒有將新名字加入pending staff跟排
    // 序裡"). Fix: the moment a manual row gets a non-blank name and doesn't
    // have any entries yet, add a zero-hour placeholder for it too — same
    // trick as the Excel-import fix for an hour-less name (see excelRoster.js
    // parseRosterGrid) — so it reaches that same review flow. It's stripped
    // back out by doPersist's row filter (start/end both required) before
    // anything is written to roster_entries, so it can never create a bogus
    // shift on its own.
    const hasEntries = entries.some((e) => matches(row, e))
    setEntries((prev) => {
      const relabeled = prev.map((e) => (matches(row, e) ? { ...e, staffName: newName } : e))
      if (newName.trim() && !hasEntries) {
        return [...relabeled, { profileId: row.profileId, staffName: newName, date: weekDates[0], startTime: '', endTime: '', breakHours: '', notes: '' }]
      }
      return relabeled
    })
    setManualRows((prev) => prev.map((m) => (m.key === row.key ? { ...m, name: newName } : m)))
  }

  function addRow() {
    setManualRows((prev) => [...prev, { key: `manual:${Date.now()}:${prev.length}`, name: '' }])
  }

  function removeRow(row) {
    setEntries((prev) => prev.filter((e) => !matches(row, e)))
    setManualRows((prev) => prev.filter((m) => m.key !== row.key))
    // Staff/Pending rows are auto-populated every time this store's roster
    // is opened — clearing their hours alone wouldn't keep the row off the
    // grid, it'd just come back empty next load. This now persistently
    // hides them (their profile / Pending staff entry is untouched, just
    // flagged hidden_from_roster — see ManageRosterPage's persistHideStaff)
    // across every week, not only this one — restoring them is done from
    // Roster Hub > Setting > Roster Staff Order, not from here.
    if ((row.kind === 'staff' || row.kind === 'pending') && onHideStaff) onHideStaff(row)
  }

  function rowTotals(row) {
    let total = 0
    let wkd = 0
    weekDates.forEach((date, i) => {
      const h = dayHours(findEntry(row, date))
      total += h
      if (i === 5 || i === 6) wkd += h
    })
    return { total: round2(total), wkd: round2(wkd) }
  }

  const grandTotal = round2(rows.reduce((sum, row) => sum + rowTotals(row).total, 0))

  // The full 7-day grid is 1 name + 14 hour columns + 2 totals + remove —
  // far wider than a phone screen, so under the `sm` breakpoint this swaps
  // to one day at a time (day tabs above a vertical list of staff cards)
  // instead of forcing a wide, awkward horizontal scroll for every edit.
  const [mobileDayIdx, setMobileDayIdx] = useState(0)
  const mobileDate = weekDates[Math.min(mobileDayIdx, weekDates.length - 1)]

  return (
    <div className="rounded-xl border border-brand-100">
      {/* Jeff, 2026-10-01: "manage roster往下拉的時候，禮拜幾跟日期還有S和E欄
          要固定，要不然排比較下面的人的班表的時候會看不到上面是哪一天" — this
          table used to just grow as tall as the full staff list and scroll
          away with the rest of the page, so the weekday/date + S/E header
          scrolled out of view the moment you got a few rows down. Giving
          this wrapper its own bounded height + `overflow-auto` (both axes,
          not just overflow-x-auto — a header stuck with `overflow-x-auto`
          alone doesn't actually pin to the page scroll, since that computed
          value forces overflow-y to 'auto' too and makes THIS div the
          sticky positioning container instead of the page) turns the grid
          into its own scrollable region, and `sticky top-0` on the thead
          then pins the header to the top of THAT region as the rows inside
          it scroll — so the day/date + S/E labels stay visible no matter
          how far down the staff list you scroll. */}
      <div className="hidden max-h-[65vh] overflow-auto sm:block">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-brand-50">
            <tr>
              <th rowSpan={2} className="border border-brand-100 px-2 py-1.5 text-left font-medium text-brand-700">
                Name
              </th>
              {weekDates.map((d) => (
                <th key={d} colSpan={2} className="border border-brand-100 px-2 py-1 text-center font-medium text-brand-700">
                  {weekdayLabel(d)} {d.slice(5)}
                </th>
              ))}
              <th rowSpan={2} className="border border-brand-100 px-2 py-1.5 text-center font-medium text-brand-700">
                Total hr
              </th>
              <th rowSpan={2} className="border border-brand-100 px-2 py-1.5 text-center font-medium text-brand-700">
                WKD hr
              </th>
            </tr>
            <tr>
              {weekDates.map((d) => (
                <Fragment key={d}>
                  <th className="border border-brand-100 px-1 py-1 text-center text-xs font-medium text-brand-600">S</th>
                  <th className="border border-brand-100 px-1 py-1 text-center text-xs font-medium text-brand-600">E</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { total, wkd } = rowTotals(row)
              return (
                <StaffRowPair
                  key={row.key}
                  row={row}
                  weekDates={weekDates}
                  findEntry={findEntry}
                  updateCell={updateCell}
                  renameRow={renameRow}
                  removeRow={removeRow}
                  total={total}
                  wkd={wkd}
                  onCheckConflict={checkConflict}
                />
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-brand-50 font-medium text-brand-800">
              <td className="border border-brand-100 px-2 py-1.5" colSpan={15}>
                Total
              </td>
              <td className="border border-brand-100 px-2 py-1.5 text-center">{grandTotal || ''}</td>
              <td className="border border-brand-100"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="sm:hidden">
        {/* Same freeze, mobile's equivalent of the header row: the day tabs
            ARE the weekday/date header here (one day's Start/End shown at a
            time, picked by tapping a day), so pinning this bar is what lets
            you keep track of which day you're filling in while scrolling
            down a long staff list — no overflow-x-auto wrapper around this
            one, so a plain `sticky top-0` pins it straight to the page's own
            scroll, same effect as the desktop table above. */}
        <div className="sticky top-0 z-10 flex border-b border-brand-100 bg-white">
          {weekDates.map((d, i) => (
            <button
              key={d}
              onClick={() => setMobileDayIdx(i)}
              className={`flex flex-1 flex-col items-center gap-0.5 border-b-2 py-2 text-xs font-medium ${
                i === mobileDayIdx ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-transparent text-gray-400'
              }`}
            >
              <span>{weekdayLabel(d)}</span>
              <span>{d.slice(8)}</span>
            </button>
          ))}
        </div>
        <div className="divide-y divide-brand-100">
          {rows.map((row) => {
            const { total, wkd } = rowTotals(row)
            return (
              <MobileStaffCard
                key={row.key}
                row={row}
                date={mobileDate}
                findEntry={findEntry}
                updateCell={updateCell}
                renameRow={renameRow}
                removeRow={removeRow}
                total={total}
                wkd={wkd}
                onCheckConflict={checkConflict}
              />
            )
          })}
        </div>
        <div className="border-t border-brand-100 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800">
          Week total: {grandTotal || 0} hr
        </div>
      </div>

      <div className="border-t border-brand-100 p-2 text-sm">
        <button onClick={addRow} className="rounded-lg border border-brand-300 px-3 py-1.5 font-medium text-brand-700 hover:bg-brand-50">
          + Add row
        </button>
        <span className="ml-2 text-xs text-gray-400">
          For a casual/one-off name not in Staff Information yet — type a name in, then fill in their hours.
        </span>
      </div>

      <Modal
        open={!!conflictWarning}
        onClose={() => setConflictWarning(null)}
        title="Outside declared availability"
        footer={
          <Button variant="secondary" onClick={() => setConflictWarning(null)}>
            OK, schedule it anyway
          </Button>
        }
      >
        {conflictWarning && (
          <p className="text-sm text-gray-600">
            {conflictWarning.name}'s shift on {format(parseISO(conflictWarning.date), 'EEE d MMM')} (
            {minutesToLabel(Math.round(conflictWarning.start * 60))} – {minutesToLabel(Math.round(conflictWarning.end * 60))}) falls
            outside the availability they declared for that day. You can still keep this shift — this is just a
            heads-up in case their availability changed but hasn't been updated here yet.
          </p>
        )}
      </Modal>
    </div>
  )
}

function HourInput({ value, onChange, onBlur, disabled, className = '', title }) {
  return (
    <input
      type="number"
      step="any"
      inputMode="decimal"
      disabled={disabled}
      title={title}
      className={`input !py-1 text-center ${className}`}
      value={value === '' || value == null ? '' : value}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      onBlur={onBlur}
    />
  )
}

function StaffRowPair({ row, weekDates, findEntry, updateCell, renameRow, removeRow, total, wkd, onCheckConflict }) {
  const nameEmpty = !row.name.trim()
  const isPersisted = row.kind === 'staff' || row.kind === 'pending'
  const removeTitle = isPersisted
    ? "Remove from roster (until restored in Roster Hub > Setting > Roster Staff Order)"
    : "Clear this row's hours"
  // Only real staff carry a Qualified state at all (Pending/imported/
  // manual rows never do) — not-yet-Qualified shows their name and shift
  // Start/End in red as a quick flag while a manager is building the week.
  const notQualified = row.kind === 'staff' && !row.qualified
  return (
    <>
      <tr>
        <td className="border border-brand-100 px-2 py-1.5 font-medium text-gray-800">
          {/* ✕ lives right next to the name now (used to be all the way at
              the end of this very wide row, past 14 day columns + both
              totals — easy to lose track of which row it belonged to, and
              on desktop meant scrolling all the way right just to remove
              someone). Mobile's card already had it up near the name; this
              just makes desktop match. */}
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              {row.profileId ? (
                <span className={notQualified ? 'text-red-600' : undefined} title={notQualified ? 'Not yet Qualified' : undefined}>
                  {row.name || <span className="text-gray-400">Unnamed</span>}
                </span>
              ) : (
                <input
                  className="input !py-1"
                  placeholder="Name"
                  value={row.name}
                  onChange={(e) => renameRow(row, e.target.value)}
                />
              )}
            </div>
            <button onClick={() => removeRow(row)} className="shrink-0 text-gray-300 hover:text-red-500" title={removeTitle}>
              ✕
            </button>
          </div>
        </td>
        {weekDates.map((date) => {
          const entry = findEntry(row, date)
          return (
            <Fragment key={date}>
              <td className="border border-brand-100 px-1 py-1">
                <HourInput
                  value={entry?.startTime}
                  disabled={nameEmpty}
                  onChange={(v) => updateCell(row, date, { startTime: v })}
                  onBlur={() => onCheckConflict?.(row, date)}
                  className={notQualified ? 'text-red-600 font-medium' : ''}
                />
              </td>
              <td className="border border-brand-100 px-1 py-1">
                <HourInput
                  value={entry?.endTime}
                  disabled={nameEmpty}
                  onChange={(v) => updateCell(row, date, { endTime: v })}
                  onBlur={() => onCheckConflict?.(row, date)}
                  className={notQualified ? 'text-red-600 font-medium' : ''}
                />
              </td>
            </Fragment>
          )
        })}
        <td rowSpan={2} className="border border-brand-100 px-2 py-1.5 text-center font-medium text-gray-700">
          {total || ''}
        </td>
        <td rowSpan={2} className="border border-brand-100 px-2 py-1.5 text-center text-gray-500">
          {wkd || ''}
        </td>
      </tr>
      <tr className="bg-gray-50/70">
        <td className="border border-brand-100 px-2 py-1 text-xs italic text-red-500" title="Half-hour units — 1 = 30 min, 2 = 1 hr">
          Break (½h)
        </td>
        {weekDates.map((date) => {
          const entry = findEntry(row, date)
          return (
            <Fragment key={date}>
              <td className="border border-brand-100 px-1 py-1">
                <HourInput
                  value={entry?.breakHours}
                  disabled={nameEmpty}
                  onChange={(v) => updateCell(row, date, { breakHours: v })}
                  className="text-xs text-red-600"
                  title="Half-hour units — 1 = 30 min, 2 = 1 hr"
                />
              </td>
              <td className="border border-brand-100"></td>
            </Fragment>
          )
        })}
      </tr>
    </>
  )
}

// Mobile equivalent of StaffRowPair's one row — same person, but only the
// currently-selected day's Start/End/Break, laid out as a vertical card
// instead of two wide table rows. Wk/WKD totals still reflect the whole
// week (computed the same way as desktop) so switching days doesn't lose
// sight of the running total.
function MobileStaffCard({ row, date, findEntry, updateCell, renameRow, removeRow, total, wkd, onCheckConflict }) {
  const nameEmpty = !row.name.trim()
  const isPersisted = row.kind === 'staff' || row.kind === 'pending'
  const removeTitle = isPersisted
    ? "Remove from roster (until restored in Roster Hub > Setting > Roster Staff Order)"
    : "Clear this row's hours"
  const notQualified = row.kind === 'staff' && !row.qualified
  const entry = findEntry(row, date)
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {row.profileId ? (
            <span
              className={`truncate font-medium ${notQualified ? 'text-red-600' : 'text-gray-800'}`}
              title={notQualified ? 'Not yet Qualified' : undefined}
            >
              {row.name || <span className="text-gray-400">Unnamed</span>}
            </span>
          ) : (
            <input
              className="input !py-1"
              placeholder="Name"
              value={row.name}
              onChange={(e) => renameRow(row, e.target.value)}
            />
          )}
        </div>
        <button onClick={() => removeRow(row)} className="shrink-0 text-gray-300 hover:text-red-500" title={removeTitle}>
          ✕
        </button>
        <span className="shrink-0 text-xs text-gray-400">
          Wk {total || 0}h{wkd ? ` · WKD ${wkd}h` : ''}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium text-gray-400">Start</span>
          <HourInput
            value={entry?.startTime}
            disabled={nameEmpty}
            onChange={(v) => updateCell(row, date, { startTime: v })}
            onBlur={() => onCheckConflict?.(row, date)}
            className={notQualified ? 'text-red-600 font-medium' : ''}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium text-gray-400">End</span>
          <HourInput
            value={entry?.endTime}
            disabled={nameEmpty}
            onChange={(v) => updateCell(row, date, { endTime: v })}
            onBlur={() => onCheckConflict?.(row, date)}
            className={notQualified ? 'text-red-600 font-medium' : ''}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium text-red-500" title="Half-hour units — 1 = 30 min, 2 = 1 hr">
            Break (½h)
          </span>
          <HourInput
            value={entry?.breakHours}
            disabled={nameEmpty}
            onChange={(v) => updateCell(row, date, { breakHours: v })}
            className="text-red-600"
          />
        </label>
      </div>
    </div>
  )
}
