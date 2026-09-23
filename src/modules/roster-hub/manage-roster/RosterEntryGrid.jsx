import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { dayHours, rosterDisplayName, pendingRosterName } from '../../../lib/excelRoster'

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
export default function RosterEntryGrid({ staff, pendingStaff = [], weekDates, entries, setEntries }) {
  // "+ Add row" placeholders for a casual/one-off name not in Staff
  // Information yet. Keyed by a stable id (not by the typed name) so
  // typing into the Name field doesn't remount the row on every keystroke.
  const [manualRows, setManualRows] = useState([])

  const importedNames = useMemo(
    () => Array.from(new Set(entries.filter((e) => !e.profileId && e.staffName).map((e) => e.staffName))),
    [entries]
  )

  const rows = useMemo(() => {
    const staffRows = staff.map((s) => ({ key: s.id, profileId: s.id, name: rosterDisplayName(s) }))
    // Pending staff (Roster Hub > Setting > Name display) always get a row
    // too, same as real staff — so a not-yet-formal hire can be scheduled
    // ahead of time instead of only appearing after a "+ Add row"/import
    // happens to use their exact name for this particular week.
    const pendingRows = pendingStaff.map((p) => ({ key: `pending:${p.id}`, profileId: '', name: pendingRosterName(p) }))
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
      .map((name, i) => ({ key: `imported:${i}`, profileId: '', name }))
    const manual = manualRows.map((m) => ({ key: m.key, profileId: '', name: m.name }))
    return [...staffRows, ...pendingRows, ...importedRows, ...manual]
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
    setEntries((prev) => prev.map((e) => (matches(row, e) ? { ...e, staffName: newName } : e)))
    setManualRows((prev) => prev.map((m) => (m.key === row.key ? { ...m, name: newName } : m)))
  }

  function addRow() {
    setManualRows((prev) => [...prev, { key: `manual:${Date.now()}:${prev.length}`, name: '' }])
  }

  function removeRow(row) {
    setEntries((prev) => prev.filter((e) => !matches(row, e)))
    setManualRows((prev) => prev.filter((m) => m.key !== row.key))
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
      <div className="hidden overflow-x-auto sm:block">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-brand-50">
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
              <th rowSpan={2} className="border border-brand-100"></th>
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
              <td className="border border-brand-100"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="sm:hidden">
        <div className="flex border-b border-brand-100">
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
    </div>
  )
}

function HourInput({ value, onChange, disabled, className = '', title }) {
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
    />
  )
}

function StaffRowPair({ row, weekDates, findEntry, updateCell, renameRow, removeRow, total, wkd }) {
  const nameEmpty = !row.name.trim()
  return (
    <>
      <tr>
        <td className="border border-brand-100 px-2 py-1.5 font-medium text-gray-800">
          {row.profileId ? (
            row.name || <span className="text-gray-400">Unnamed</span>
          ) : (
            <input
              className="input !py-1"
              placeholder="Name"
              value={row.name}
              onChange={(e) => renameRow(row, e.target.value)}
            />
          )}
        </td>
        {weekDates.map((date) => {
          const entry = findEntry(row, date)
          return (
            <Fragment key={date}>
              <td className="border border-brand-100 px-1 py-1">
                <HourInput value={entry?.startTime} disabled={nameEmpty} onChange={(v) => updateCell(row, date, { startTime: v })} />
              </td>
              <td className="border border-brand-100 px-1 py-1">
                <HourInput value={entry?.endTime} disabled={nameEmpty} onChange={(v) => updateCell(row, date, { endTime: v })} />
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
        <td rowSpan={2} className="border border-brand-100 px-1 text-center">
          <button onClick={() => removeRow(row)} className="text-gray-300 hover:text-red-500" title="Clear this row's hours">
            ✕
          </button>
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
function MobileStaffCard({ row, date, findEntry, updateCell, renameRow, removeRow, total, wkd }) {
  const nameEmpty = !row.name.trim()
  const entry = findEntry(row, date)
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        {row.profileId ? (
          <span className="flex-1 truncate font-medium text-gray-800">
            {row.name || <span className="text-gray-400">Unnamed</span>}
          </span>
        ) : (
          <input
            className="input !py-1 flex-1"
            placeholder="Name"
            value={row.name}
            onChange={(e) => renameRow(row, e.target.value)}
          />
        )}
        <span className="shrink-0 text-xs text-gray-400">
          Wk {total || 0}h{wkd ? ` · WKD ${wkd}h` : ''}
        </span>
        <button onClick={() => removeRow(row)} className="shrink-0 text-gray-300 hover:text-red-500" title="Clear this row's hours">
          ✕
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium text-gray-400">Start</span>
          <HourInput value={entry?.startTime} disabled={nameEmpty} onChange={(v) => updateCell(row, date, { startTime: v })} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium text-gray-400">End</span>
          <HourInput value={entry?.endTime} disabled={nameEmpty} onChange={(v) => updateCell(row, date, { endTime: v })} />
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
