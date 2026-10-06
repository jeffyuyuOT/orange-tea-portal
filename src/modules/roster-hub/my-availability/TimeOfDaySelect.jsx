import { MINUTE_OPTIONS, decomposeQuarterHour, composeQuarterHour } from '../../../lib/availability'

// Jeff, 2026-10-02: "選時間的時候可以時，分(15分鐘一個間隔)，am/pm分開選，這樣
// 才不用像現在要選下午要拉很長一段" — replaces the old single <select> with
// all 97 quarter-hour options (scrolling all the way down just to reach an
// afternoon time) with three short pickers: hour, minute (15-min steps),
// AM/PM.
//
// Jeff, 2026-10-02 (later): "系統所有填寫am/pm的部分不需要midnight (end of
// day)的選項，當天最晚能選的時間就是11:59pm" — dropped the "Midnight (end of
// day)" AM/PM-slot option this used to have (the "24:00" end-of-day marker
// some custom windows' End time could be set to) — the latest selectable
// time of day is now 11:45 PM, the last quarter-hour PM option, same as
// every other day.
export default function TimeOfDaySelect({ value, onChange, className = '' }) {
  const { hour12, minute, ampm } = decomposeQuarterHour(value)

  function set(patch) {
    const next = { hour12, minute, ampm, ...patch }
    onChange(composeQuarterHour(next.hour12, next.minute, next.ampm))
  }

  return (
    // Jeff, 2026-10-04: "手機版my availability填寫specific time的時候時間會
    // 卡在螢幕外面" — these three selects at their old fixed widths
    // (w-16/w-16/w-24) made a start+end pair too wide to fit a phone screen
    // at all; a touch narrower on mobile (still comfortably tappable) gives
    // MyAvailabilityPage's row-wrap fix less work to do and keeps a single
    // start–end pair on one line on more phones. Unchanged from `sm` up.
    // Jeff, 2026-10-07: same fix as TypedTimeInput.jsx's AM/PM select (Edit
    // Staff Time Log) — these three were squeezed to !py-1.5 (6px vertical),
    // likely too tight for some Android builds' native <select> chrome to
    // render its label text in at all. Bumped to !py-2 (8px) + an explicit
    // normal line-height, same reasoning, pre-emptively applied here since
    // it's the identical narrow-select pattern.
    <div className={`flex items-center gap-1 ${className}`}>
      <select className="input !w-14 !py-2 leading-normal sm:!w-16" value={hour12} onChange={(e) => set({ hour12: Number(e.target.value) })}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-gray-400">:</span>
      <select className="input !w-14 !py-2 leading-normal sm:!w-16" value={minute} onChange={(e) => set({ minute: e.target.value })}>
        {MINUTE_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select className="input !w-20 !py-2 leading-normal sm:!w-24" value={ampm} onChange={(e) => set({ ampm: e.target.value })}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}
