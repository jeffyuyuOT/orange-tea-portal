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
//
// Jeff, 2026-10-04: "申請leave的日期防呆措施可以設成在確認的時候再檢查並顯示
// 錯誤訊息嗎?...一開始的時候結束日期跟開始日期為同一天，所以大家先選開始日期
// 的時候會被鎖在今天之前" — Start used to carry a live `max={endAt}`, and
// since End starts out defaulted to the SAME day as Start, that max pinned
// Start's own picker to "today or earlier" the moment someone opened a
// fresh application — picking any future start date was blocked outright,
// not just flagged. Dropped that live cap on Start. In its place: picking a
// Start that's now past the current End pushes End forward to match
// (keeping the request a valid single day) instead of leaving End stranded
// in the past — so the common one-day case never shows an error at all,
// and anyone who then wants more than one day just moves End out further.
// End keeps its own live `min={startAt}` — that one was never the problem
// (nobody picks End before touching Start, so it never traps anyone) and
// it stops an obviously-backwards range from being typeable in the first
// place. The existing `rangeInvalid` check in ApplyLeaveTab/EditLeaveTab
// (confirm-time, with a visible error message) stays as the safety net for
// whatever this auto-bump doesn't cover — e.g. typing a backwards range
// directly into a datetime-local field's text segments.
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
              onChange={(e) => {
                const nextStart = e.target.value
                onChange({ startAt: nextStart, endAt: nextStart > endAt ? nextStart : endAt, specificTime })
              }}
            />
          ) : (
            <input
              type="date"
              className="input"
              value={startAt.slice(0, 10)}
              onChange={(e) => {
                const nextStartDate = e.target.value
                const nextEndAt = nextStartDate > endAt.slice(0, 10) ? `${nextStartDate}T23:59` : endAt
                onChange({ startAt: `${nextStartDate}T00:00`, endAt: nextEndAt, specificTime })
              }}
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
