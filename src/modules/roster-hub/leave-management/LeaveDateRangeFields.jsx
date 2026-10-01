// Jeff, 2026-10-02: "申請leave時，把edit時勾取specific time的選項取消，就做
// 得跟申請時一樣，開始時間預設一天的開始，結束時間預設一天的最後一天" — shared
// by ApplyLeaveTab and EditLeaveTab so unchecking "Specific time" behaves
// identically in both places (collapses straight back to date-only pickers
// with 00:00/23:59 bounds) instead of each screen re-deriving that reset
// slightly differently, which is exactly how they'd drift apart otherwise.
// `startAt`/`endAt` are always Brisbane-local `datetime-local` strings
// ("YYYY-MM-DDTHH:MM") — this component never does any timezone
// conversion itself, that's brisbaneTime.js's job at the point these
// values are actually sent to/read from Supabase.
export default function LeaveDateRangeFields({ startAt, endAt, specificTime, onChange }) {
  function setSpecificTime(next) {
    if (!next) {
      onChange({ startAt: `${startAt.slice(0, 10)}T00:00`, endAt: `${endAt.slice(0, 10)}T23:59`, specificTime: false })
    } else {
      onChange({ startAt, endAt, specificTime: true })
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs font-medium text-gray-500">
        <input type="checkbox" checked={specificTime} onChange={(e) => setSpecificTime(e.target.checked)} />
        Specific time (otherwise defaults to the whole day)
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Start</span>
          {specificTime ? (
            <input
              type="datetime-local"
              className="input"
              value={startAt}
              max={endAt || undefined}
              onChange={(e) => onChange({ startAt: e.target.value, endAt, specificTime })}
            />
          ) : (
            <input
              type="date"
              className="input"
              value={startAt.slice(0, 10)}
              max={endAt ? endAt.slice(0, 10) : undefined}
              onChange={(e) => onChange({ startAt: `${e.target.value}T00:00`, endAt, specificTime })}
            />
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">End</span>
          {specificTime ? (
            <input
              type="datetime-local"
              className="input"
              value={endAt}
              min={startAt || undefined}
              onChange={(e) => onChange({ startAt, endAt: e.target.value, specificTime })}
            />
          ) : (
            <input
              type="date"
              className="input"
              value={endAt.slice(0, 10)}
              min={startAt ? startAt.slice(0, 10) : undefined}
              onChange={(e) => onChange({ startAt, endAt: `${e.target.value}T23:59`, specificTime })}
            />
          )}
        </label>
      </div>
    </div>
  )
}
