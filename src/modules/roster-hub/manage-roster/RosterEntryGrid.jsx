import Button from '../../../components/ui/Button'

export default function RosterEntryGrid({ entries, setEntries, staff }) {
  function updateRow(idx, patch) {
    setEntries((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function removeRow(idx) {
    setEntries((prev) => prev.filter((_, i) => i !== idx))
  }
  function addRow() {
    setEntries((prev) => [...prev, { profileId: '', staffEmail: '', date: '', startTime: '', endTime: '', notes: '' }])
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-brand-100">
      <table className="min-w-full divide-y divide-brand-100 text-sm">
        <thead className="bg-brand-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-brand-700">Staff</th>
            <th className="px-3 py-2 text-left font-medium text-brand-700">Date</th>
            <th className="px-3 py-2 text-left font-medium text-brand-700">Start</th>
            <th className="px-3 py-2 text-left font-medium text-brand-700">End</th>
            <th className="px-3 py-2 text-left font-medium text-brand-700">Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-50">
          {entries.map((row, idx) => (
            <tr key={idx}>
              <td className="px-2 py-1.5">
                <select
                  className="input"
                  value={row.profileId}
                  onChange={(e) => {
                    const p = staff.find((s) => s.id === e.target.value)
                    updateRow(idx, { profileId: e.target.value, staffEmail: p?.email ?? row.staffEmail })
                  }}
                >
                  <option value="">{row.staffEmail || 'Select staff'}</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.first_name} {s.last_name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-1.5">
                <input type="date" className="input" value={row.date} onChange={(e) => updateRow(idx, { date: e.target.value })} />
              </td>
              <td className="px-2 py-1.5">
                <input type="time" className="input" value={row.startTime} onChange={(e) => updateRow(idx, { startTime: e.target.value })} />
              </td>
              <td className="px-2 py-1.5">
                <input type="time" className="input" value={row.endTime} onChange={(e) => updateRow(idx, { endTime: e.target.value })} />
              </td>
              <td className="px-2 py-1.5">
                <input className="input" value={row.notes} onChange={(e) => updateRow(idx, { notes: e.target.value })} />
              </td>
              <td className="px-2 py-1.5">
                <button onClick={() => removeRow(idx)} className="text-gray-400 hover:text-red-500">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-brand-100 p-2">
        <Button variant="secondary" onClick={addRow}>
          + Add shift
        </Button>
      </div>
    </div>
  )
}
