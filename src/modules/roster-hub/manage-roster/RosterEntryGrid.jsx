import { Fragment, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../../lib/supabaseClient'
import { dayHours, rosterDisplayName, pendingRosterName } from '../../../lib/excelRoster'
import { shiftConflictsWithAvailability, shiftConflictsWithLeave, leaveWindowOnDate, minutesToLabel } from '../../../lib/availability'
import { loadRosterDisplaySettings, rosterTitleStyle } from '../../../lib/trainingJourney'
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
  // Jeff, 2026-10-12: "Manage Roaster compares not only with my availability
  // time but also with leave time, prioritizing leave time" —
  // { profileId: [leave_requests rows] } for this week's active leave (see
  // ManageRosterPage), checked independently of and ahead of the
  // availability check below.
  leavesByProfile,
  // Jeff, 2026-10-27: lifted up to ManageRosterPage (was a local useState
  // here) so StaffAvailabilityModal's "By Date" tab can default-expand to
  // whichever day these mobile tabs currently show. Behaves exactly the
  // same from this component's own point of view — just reading/writing
  // through props instead of its own state.
  mobileDayIdx,
  setMobileDayIdx,
  // Jeff, 2026-10-30: 'decimal' (10.5 = 10:30, the only option before this)
  // or 'compact' (1030 = 10:30) — picked once via the dropdown above the
  // Action button in ManageRosterPage, threaded all the way down to every
  // Start/End HourInput below (never the Break(½h) one — see HourInput's
  // own comment for why that one's excluded).
  timeInputFormat = 'decimal',
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

  // Jeff, 2026-10-24: "手機板manage roster時，如果點擊員工的名字，上面會顯示
  // 該員工這個禮拜目前牌的時間" — mobile's day-tabs (below) only ever show
  // ONE day's Start/End per staff card at a time, so seeing someone's whole
  // week means tapping through all 7 day tabs while re-finding their row
  // each time. Tapping their name instead pops up every day's shift for
  // THAT person in one readable list, independent of whichever day tab is
  // currently selected. Desktop already shows the full week in one row per
  // person (the table above), so this is mobile-only — see MobileStaffCard.
  const [weekSummaryRow, setWeekSummaryRow] = useState(null)

  // Jeff, 2026-10-02 (Training Journey spec, point 6): System Setting >
  // Roster Name Display Format + the 6 phase definitions — same fetch-once
  // pattern as RosterWeekTable.jsx (shared Bulletin/My Roster view), which
  // this grid's own qualified-only red/default styling has always
  // duplicated independently rather than sharing a component with. 'original'
  // (the default) leaves every row below exactly as it already rendered.
  const [displayFormat, setDisplayFormat] = useState('original')
  const [phases, setPhases] = useState([])
  useEffect(() => {
    loadRosterDisplaySettings().then(setDisplayFormat)
    supabase
      .from('training_journey_phases')
      .select('*')
      .then(({ data }) => setPhases(data ?? []))
  }, [])

  function checkConflict(row, date) {
    if (!row.profileId) return
    const entry = entries.find((e) => matches(row, e) && e.date === date)
    const start = entry?.startTime
    const end = entry?.endTime
    if (start === '' || start == null || end === '' || end == null) return
    // Leave is checked first and wins — a shift overlapping approved leave
    // is flagged as that, never just folded into (or masked by) the plain
    // availability check below, even when the person's own declared
    // availability doesn't separately flag it (see shiftConflictsWithLeave's
    // comment for why those two can disagree).
    const leaveWindowsForDay = (leavesByProfile?.[row.profileId] ?? []).map((l) => leaveWindowOnDate(l, date)).filter(Boolean)
    if (shiftConflictsWithLeave(Number(start), Number(end), leaveWindowsForDay)) {
      setConflictWarning({ type: 'leave', name: row.name, date, start: Number(start), end: Number(end) })
      return
    }
    if (!availabilityByProfile) return
    const avail = availabilityByProfile[row.profileId]?.[date]
    if (!avail) return
    if (shiftConflictsWithAvailability(Number(start), Number(end), avail.dayRow, avail.windows)) {
      setConflictWarning({ type: 'availability', name: row.name, date, start: Number(start), end: Number(end) })
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
      training_journey_phase: s.training_journey_phase,
      has_master_title: s.has_master_title,
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
    // Jeff, 2026-10-21: "manage roaste時按x要有警示窗跳出說將此員工從roaster
    // 移除並確認，要不然很容易會誤觸就移除了" — the X was one accidental tap
    // away from persistently hiding a real staff/pending member (see the
    // comment below on what that actually does). Only gated for that
    // persisted case — clearing an ad-hoc/manual row's hours was never
    // destructive in the same way (nothing to restore), matching the
    // "Remove from roster..." vs "Clear this row's hours" distinction the
    // title already draws just below.
    const isPersisted = row.kind === 'staff' || row.kind === 'pending'
    if (isPersisted && !window.confirm(`將 ${row.name || '此員工'} 從本週排班移除？\n之後可從 Roster Hub > Setting > Roster Staff Order 恢復。`)) {
      return
    }
    setEntries((prev) => prev.filter((e) => !matches(row, e)))
    setManualRows((prev) => prev.filter((m) => m.key !== row.key))
    // Staff/Pending rows are auto-populated every time this store's roster
    // is opened — clearing their hours alone wouldn't keep the row off the
    // grid, it'd just come back empty next load. This now persistently
    // hides them (their profile / Pending staff entry is untouched, just
    // flagged hidden_from_roster — see ManageRosterPage's persistHideStaff)
    // across every week, not only this one — restoring them is done from
    // Roster Hub > Setting > Roster Staff Order, not from here.
    if (isPersisted && onHideStaff) onHideStaff(row)
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
  // (mobileDayIdx/setMobileDayIdx are now props — see this component's
  // signature — but otherwise used exactly the same as before.)
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
      {/* Jeff, 2026-10-03: "將字體縮小一點，欄高縮窄一點(行寬也可以小一點，才
          不會拉這麼長)，像這個excel一樣不要上下滑動螢幕可以看到全部的資訊" —
          matched against a reference Excel screenshot: smaller text (text-sm
          → text-xs throughout), tighter cell padding (py-1.5/py-1 → py-0.5).
          max-h bumped from 65vh to 80vh on top of that shrinking — between
          the two, a typical store's staff list now fits without the
          vertical scroll Jeff was trying to avoid; the sticky header +
          scroll are kept as a safety net rather than removed outright, for
          a store with an unusually long staff list.
          Column widths — first pass (an explicit `w-12` on just the S/E
          header cells) came out too narrow once `text-xs`'s smaller font
          met `border-collapse` table's auto layout: Jeff's follow-up
          ("start跟end的行寬現在太窄了，數字都看不清楚...total hr跟WKD hr不需
          要這麼寬") caught that Total hr/WKD hr had actually ballooned to
          fill the leftover space instead, since nothing was constraining
          them. Switched to an explicit `<colgroup>` + `table-fixed`, which
          is what actually pins every column's width regardless of its
          content (`border-collapse` table's default `table-layout: auto`
          only ever treats declared widths as a hint, not a rule) — S/E
          widened back up from that first pass's 48px to 64px (close to,
          but a bit under, how wide they rendered before any of this —
          Jeff's "跟以前差不多小一點點就好"), Total hr/WKD hr narrowed down
          to 56px since neither needs room for more than ~5 characters. */}
      <div className="hidden max-h-[80vh] overflow-auto sm:block">
        <table className="min-w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-28" />
            {weekDates.map((d) => (
              <Fragment key={d}>
                <col className="w-16" />
                <col className="w-16" />
              </Fragment>
            ))}
            <col className="w-14" />
            <col className="w-14" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-brand-50">
            <tr>
              <th rowSpan={2} className="border border-brand-100 px-1.5 py-1 text-left font-medium text-brand-700">
                Name
              </th>
              {weekDates.map((d) => (
                <th key={d} colSpan={2} className="border border-brand-100 px-1 py-0.5 text-center font-medium text-brand-700">
                  {weekdayLabel(d)} {d.slice(5)}
                </th>
              ))}
              <th rowSpan={2} className="border border-brand-100 px-1.5 py-1 text-center font-medium text-brand-700">
                Total hr
              </th>
              <th rowSpan={2} className="border border-brand-100 px-1.5 py-1 text-center font-medium text-brand-700">
                WKD hr
              </th>
            </tr>
            <tr>
              {weekDates.map((d) => (
                <Fragment key={d}>
                  <th className="border border-brand-100 px-0.5 py-0.5 text-center text-[10px] font-medium text-brand-600">S</th>
                  <th className="border border-brand-100 px-0.5 py-0.5 text-center text-[10px] font-medium text-brand-600">E</th>
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
                  displayFormat={displayFormat}
                  phases={phases}
                  timeInputFormat={timeInputFormat}
                />
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-brand-50 font-medium text-brand-800">
              <td className="border border-brand-100 px-1.5 py-1" colSpan={15}>
                Total
              </td>
              <td className="border border-brand-100 px-1.5 py-1 text-center">{grandTotal || ''}</td>
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
                displayFormat={displayFormat}
                phases={phases}
                timeInputFormat={timeInputFormat}
                onShowWeek={() => setWeekSummaryRow(row)}
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
        title={conflictWarning?.type === 'leave' ? 'Scheduled during approved leave' : 'Outside declared availability'}
        footer={
          <Button variant="secondary" onClick={() => setConflictWarning(null)}>
            OK, schedule it anyway
          </Button>
        }
      >
        {conflictWarning && (
          <p className={`text-sm ${conflictWarning.type === 'leave' ? 'text-red-600' : 'text-gray-600'}`}>
            {conflictWarning.name}'s shift on {format(parseISO(conflictWarning.date), 'EEE d MMM')} (
            {minutesToLabel(Math.round(conflictWarning.start * 60))} – {minutesToLabel(Math.round(conflictWarning.end * 60))}){' '}
            {conflictWarning.type === 'leave' ? (
              <>
                falls during leave they have approved for that day. You can still keep this shift — this is just a
                heads-up in case the leave was since cancelled but hasn't been updated here yet.
              </>
            ) : (
              <>
                falls outside the availability they declared for that day. You can still keep this shift — this is
                just a heads-up in case their availability changed but hasn't been updated here yet.
              </>
            )}
          </p>
        )}
      </Modal>

      <Modal open={!!weekSummaryRow} onClose={() => setWeekSummaryRow(null)} title={weekSummaryRow ? `${weekSummaryRow.name}'s week` : ''}>
        {weekSummaryRow && (
          <div className="space-y-2">
            {weekDates.map((date) => {
              const entry = findEntry(weekSummaryRow, date)
              const hasShift = entry?.startTime !== '' && entry?.startTime != null && entry?.endTime !== '' && entry?.endTime != null
              return (
                <div key={date} className="flex items-center justify-between rounded-lg border border-brand-100 px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold text-gray-800">{weekdayLabel(date)}</div>
                    <div className="text-xs text-gray-400">{format(parseISO(date), 'd MMM')}</div>
                  </div>
                  {hasShift ? (
                    <div className="text-right">
                      <div className="text-base font-semibold text-brand-700">
                        {minutesToLabel(Math.round(Number(entry.startTime) * 60))} – {minutesToLabel(Math.round(Number(entry.endTime) * 60))}
                      </div>
                      <div className="text-xs text-gray-400">{dayHours(entry)} hr worked</div>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-300">Off</span>
                  )}
                </div>
              )
            })}
            <div className="flex items-center justify-between border-t border-brand-100 pt-2 text-sm font-semibold text-brand-800">
              <span>Week total</span>
              <span>{rowTotals(weekSummaryRow).total || 0} hr</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// Jeff, 2026-10-30: "action按鈕上面新增輸入格式，可以選擇Decimal hours或
// Compact Time Format...save和publish時的格式檢查邏輯也要跟著變" — a store
// manager (Underwood's Penny) typed "1030" meaning 10:30 straight into a
// decimal-hours Start/End cell; the grid read that as literally 1030
// hours, which published and then showed every staff member a blank shift
// (see ManageRosterPage's findInvalidTimeEntries). Rather than just
// blocking that typo, this lets a manager who thinks in clock times use
// "Compact Time Format" on purpose — 1030 really does mean 10:30 when this
// mode is selected — while `entries.startTime`/`endTime` (and therefore
// every computation downstream: rowTotals/grandTotal, checkConflict,
// Save/Submit's validation, persist()'s decimalToTime()) still only ever
// sees plain decimal hours, exactly as before. The format toggle is purely
// an input/display convenience on TOP of that same canonical number.
function compactToDecimalHours(n) {
  if (!Number.isInteger(n) || n < 0) return NaN
  // 1 or 2 digits alone means just the hour, no minutes — "9"/"18" mean
  // 9:00/18:00, not 0:09/0:18. From 3 digits up, the last two are always
  // minutes (same convention as reading a 24hr clock number aloud):
  // "930" → 9:30, "1030" → 10:30.
  if (String(n).length <= 2) return n
  const minute = n % 100
  const hour = Math.floor(n / 100)
  if (minute > 59) return NaN
  return hour + minute / 60
}

function decimalHoursToCompact(n) {
  const h = Math.floor(n)
  const m = Math.round((n - h) * 60)
  return h * 100 + m
}

// What the box shows whenever it's NOT the one currently being typed into
// (initial mount, loading a different week, Copy Last Week, Clear, the
// format dropdown being switched, or just finishing editing a DIFFERENT
// cell) — always reformatted fresh off the canonical decimal `value`.
export function formatHourForDisplay(value, format) {
  if (value === '' || value == null) return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return '' // an unparseable/invalid committed value — nothing sane to show
  return format === 'compact' ? String(decimalHoursToCompact(n)) : String(n)
}

// What a keystroke's raw text commits back up as `entries.startTime`/
// `endTime` — '' stays '' (no shift), anything that doesn't parse as a
// sane time in the selected format commits as NaN (findInvalidTimeEntries
// in ManageRosterPage is what turns that into the blocking Save/Submit
// warning, exactly like an out-of-range decimal already does).
function parseHourInput(raw, format) {
  if (raw === '') return ''
  const n = Number(raw)
  if (!Number.isFinite(n)) return NaN
  return format === 'compact' ? compactToDecimalHours(n) : n
}

function HourInput({ value, onChange, onBlur, disabled, className = '', style, title, format = 'decimal' }) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState(() => formatHourForDisplay(value, format))

  // Resync the shown text from the canonical `value` whenever this box
  // isn't the one being typed into right now — but never while focused,
  // or reformatting mid-keystroke (e.g. typing "10" meaning "still
  // composing the hour" would jump to "1000" the moment Compact mode
  // reformats it back) would fight every subsequent keystroke. `onChange`
  // below still fires on every keystroke exactly as before — this only
  // decouples what's DISPLAYED while focused from that committed value.
  useEffect(() => {
    if (!focused) setDraft(formatHourForDisplay(value, format))
  }, [value, format, focused])

  return (
    <input
      type="text"
      inputMode={format === 'compact' ? 'numeric' : 'decimal'}
      disabled={disabled}
      title={title}
      className={`input no-spinner !px-0.5 !py-0.5 text-center text-xs ${className}`}
      style={style}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(parseHourInput(e.target.value, format))
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
    />
  )
}

function StaffRowPair({ row, weekDates, findEntry, updateCell, renameRow, removeRow, total, wkd, onCheckConflict, displayFormat, phases, timeInputFormat }) {
  const nameEmpty = !row.name.trim()
  const isPersisted = row.kind === 'staff' || row.kind === 'pending'
  const removeTitle = isPersisted
    ? "Remove from roster (until restored in Roster Hub > Setting > Roster Staff Order)"
    : "Clear this row's hours"
  // Only real staff carry a Qualified state at all (Pending/imported/
  // manual rows never do) — not-yet-Qualified shows their name and shift
  // Start/End in red as a quick flag while a manager is building the week.
  // Only actually used when displayFormat is 'original' — see titleStyle.
  const notQualified = row.kind === 'staff' && !row.qualified
  const titleStyle = displayFormat !== 'original' && row.kind === 'staff' ? rosterTitleStyle(row, phases, displayFormat) : null
  const colorStyle = titleStyle?.color ? { color: titleStyle.color } : undefined
  return (
    <>
      <tr>
        <td className="border border-brand-100 px-1.5 py-1 font-medium text-gray-800">
          {/* ✕ lives right next to the name now (used to be all the way at
              the end of this very wide row, past 14 day columns + both
              totals — easy to lose track of which row it belonged to, and
              on desktop meant scrolling all the way right just to remove
              someone). Mobile's card already had it up near the name; this
              just makes desktop match. */}
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              {row.profileId ? (
                <span
                  className={displayFormat === 'original' && notQualified ? 'text-red-600' : undefined}
                  style={colorStyle}
                  title={displayFormat === 'original' && notQualified ? 'Not yet Qualified' : undefined}
                >
                  {row.name || <span className="text-gray-400">Unnamed</span>}
                  {titleStyle?.icon && (
                    <span className="ml-1" title={titleStyle.icon === '👑' ? 'Master' : 'Expert'}>
                      {titleStyle.icon}
                    </span>
                  )}
                  {titleStyle?.badge && <span className="ml-1 text-[10px] font-normal text-gray-400">{titleStyle.badge}</span>}
                </span>
              ) : (
                <input
                  className="input !px-1.5 !py-0.5 text-xs"
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
              <td className="border border-brand-100 px-0.5 py-0.5">
                <HourInput
                  value={entry?.startTime}
                  disabled={nameEmpty}
                  onChange={(v) => updateCell(row, date, { startTime: v })}
                  onBlur={() => onCheckConflict?.(row, date)}
                  className={displayFormat === 'original' && notQualified ? 'text-red-600 font-medium' : ''}
                  style={colorStyle}
                  format={timeInputFormat}
                />
              </td>
              <td className="border border-brand-100 px-0.5 py-0.5">
                <HourInput
                  value={entry?.endTime}
                  disabled={nameEmpty}
                  onChange={(v) => updateCell(row, date, { endTime: v })}
                  onBlur={() => onCheckConflict?.(row, date)}
                  className={displayFormat === 'original' && notQualified ? 'text-red-600 font-medium' : ''}
                  style={colorStyle}
                  format={timeInputFormat}
                />
              </td>
            </Fragment>
          )
        })}
        <td rowSpan={2} className="border border-brand-100 px-1.5 py-1 text-center font-medium text-gray-700">
          {total || ''}
        </td>
        <td rowSpan={2} className="border border-brand-100 px-1.5 py-1 text-center text-gray-500">
          {wkd || ''}
        </td>
      </tr>
      <tr className="bg-gray-50/70">
        <td className="border border-brand-100 px-1.5 py-0.5 text-[10px] italic text-red-500" title="Half-hour units — 1 = 30 min, 2 = 1 hr">
          Break (½h)
        </td>
        {weekDates.map((date) => {
          const entry = findEntry(row, date)
          return (
            <Fragment key={date}>
              <td className="border border-brand-100 px-0.5 py-0.5">
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
function MobileStaffCard({ row, date, findEntry, updateCell, renameRow, removeRow, total, wkd, onCheckConflict, displayFormat, phases, timeInputFormat, onShowWeek }) {
  const nameEmpty = !row.name.trim()
  const isPersisted = row.kind === 'staff' || row.kind === 'pending'
  const removeTitle = isPersisted
    ? "Remove from roster (until restored in Roster Hub > Setting > Roster Staff Order)"
    : "Clear this row's hours"
  const notQualified = row.kind === 'staff' && !row.qualified
  const titleStyle = displayFormat !== 'original' && row.kind === 'staff' ? rosterTitleStyle(row, phases, displayFormat) : null
  const colorStyle = titleStyle?.color ? { color: titleStyle.color } : undefined
  const entry = findEntry(row, date)
  // Jeff, 2026-10-02: "想辦法讓名字，S/E/B的資訊，刪除跟total work hr的資訊
  // 都放在同一行嗎，名字的字可以再縮小一點讓後面空間大一點" — Start/End/
  // Break used to be their own labeled 3-column grid below the name/
  // delete/total row (two visual rows per person). They're now inline on
  // that SAME row instead: "Start"/"End"/"Break (½h)" shortened to single
  // letters (S/E/B per Jeff's wording), each letter sitting directly next
  // to its own narrowed input (`!w-11`, was effectively 1/3 of the card's
  // width) rather than stacked above it, and the name text shrunk again
  // (text-xs, was text-sm) to help make room for the trio now sharing its
  // line. flex-wrap stays as a fallback for a genuinely narrow phone, but
  // every piece here is sized to fit one row on an ordinary phone width.
  // The WKD half of the old "Wk Xh · WKD Yh" text moved into this span's
  // title (a tap-and-hold/hover tooltip) rather than staying inline, since
  // there wasn't room left for both numbers as plain text any more.
  return (
    <div className="flex flex-wrap items-center gap-1 p-2">
      <div className="min-w-0 flex-1">
        {row.profileId ? (
          // Jeff, 2026-10-24: tap the name to see this person's whole week
          // (every day's shift, not just the currently-selected day tab) —
          // see the week-summary modal in RosterEntryGrid above. Underline
          // is the only visual hint it's tappable (not a button-ish look),
          // so it still reads as a name first.
          <button
            type="button"
            onClick={() => onShowWeek?.(row)}
            className={`block w-full truncate text-left text-xs font-medium underline decoration-dotted decoration-gray-300 underline-offset-2 ${displayFormat === 'original' && notQualified ? 'text-red-600' : 'text-gray-800'}`}
            style={colorStyle}
            title={displayFormat === 'original' && notQualified ? 'Not yet Qualified — tap to see this week' : `Tap to see ${row.name}'s week`}
          >
            {row.name || <span className="text-gray-400">Unnamed</span>}
            {titleStyle?.icon && (
              <span className="ml-1" title={titleStyle.icon === '👑' ? 'Master' : 'Expert'}>
                {titleStyle.icon}
              </span>
            )}
            {titleStyle?.badge && <span className="ml-1 text-[10px] font-normal text-gray-400">{titleStyle.badge}</span>}
          </button>
        ) : (
          <input
            className="input !py-1 text-xs"
            placeholder="Name"
            value={row.name}
            onChange={(e) => renameRow(row, e.target.value)}
          />
        )}
      </div>
      <span className="shrink-0 text-[10px] font-medium text-gray-400">S</span>
      <HourInput
        value={entry?.startTime}
        disabled={nameEmpty}
        onChange={(v) => updateCell(row, date, { startTime: v })}
        onBlur={() => onCheckConflict?.(row, date)}
        className={`!w-11 shrink-0 !px-0.5 text-xs ${displayFormat === 'original' && notQualified ? 'text-red-600 font-medium' : ''}`}
        style={colorStyle}
        format={timeInputFormat}
      />
      <span className="shrink-0 text-[10px] font-medium text-gray-400">E</span>
      <HourInput
        value={entry?.endTime}
        disabled={nameEmpty}
        onChange={(v) => updateCell(row, date, { endTime: v })}
        onBlur={() => onCheckConflict?.(row, date)}
        className={`!w-11 shrink-0 !px-0.5 text-xs ${displayFormat === 'original' && notQualified ? 'text-red-600 font-medium' : ''}`}
        style={colorStyle}
        format={timeInputFormat}
      />
      <span className="shrink-0 text-[10px] font-medium text-red-500" title="Half-hour units — 1 = 30 min, 2 = 1 hr">
        B
      </span>
      <HourInput
        value={entry?.breakHours}
        disabled={nameEmpty}
        onChange={(v) => updateCell(row, date, { breakHours: v })}
        className="!w-11 shrink-0 !px-0.5 text-xs text-red-600"
        title="Half-hour units — 1 = 30 min, 2 = 1 hr"
      />
      <button onClick={() => removeRow(row)} className="shrink-0 text-gray-300 hover:text-red-500" title={removeTitle}>
        ✕
      </button>
      <span className="shrink-0 text-[10px] text-gray-400" title={wkd ? `Week total ${total || 0}h, incl. ${wkd}h weekend` : `Week total ${total || 0}h`}>
        {total || 0}h
      </span>
    </div>
  )
}
