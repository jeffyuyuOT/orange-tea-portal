import { useEffect, useState } from 'react'

// Jeff, 2026-10-02: "手機板edit attendance log時，填寫時間部份直接填寫時跟分
// 跟am/pm，選時跟分的時候跳出鍵盤輸入，不需要後面那個小時鐘的功能" — a plain
// <input type="time"> on mobile (Android Chrome especially) pops up its own
// clock-dial picker UI instead of just handing the field a numeric keyboard
// to type digits straight into. Three plain fields instead: hour and
// minute are text inputs with inputMode="numeric" (a numeric keypad, no
// dial), AM/PM is an ordinary <select> — none of these trigger any native
// time-picker UI on any platform.
//
// `value`/`onChange` are the same 24-hour "HH:mm" string
// AttendanceCellEditModal's rows already use everywhere else (combineDate
// AndTime, the original punch's own occurred_at formatted the same way) —
// this only changes how it's typed in, not the shape it's stored/compared
// as. Unlike availability.js's decomposeQuarterHour/TimeOfDaySelect (15-
// minute steps only, fine for a declared availability window), a punch
// needs the exact minute someone actually clocked in/out at, so minute is
// free-typed 00-59 here, not a dropdown.
export default function TypedTimeInput({ value, onChange, disabled, className = '' }) {
  const [hour, setHour] = useState('')
  const [minute, setMinute] = useState('')
  const [ampm, setAmpm] = useState('AM')

  // Only resync from the parent's value when it changed from OUTSIDE this
  // input (switching to a different row/cell) — not derived every render,
  // same reasoning as SimpleRichTextEditor's value effect: once typing here
  // drives onChange itself, re-deriving from the composed value on every
  // keystroke would fight whatever's mid-typing (e.g. a single leading "0"
  // typed for the hour).
  useEffect(() => {
    if (!value) {
      setHour('')
      setMinute('')
      setAmpm('AM')
      return
    }
    const [h, m] = value.split(':').map(Number)
    setHour(String(h % 12 === 0 ? 12 : h % 12))
    setMinute(String(m).padStart(2, '0'))
    setAmpm(h >= 12 ? 'PM' : 'AM')
  }, [value])

  // Composes whenever all three parts look complete; otherwise reports an
  // empty time — same "not filled in yet" signal a blank native time input
  // gave callers before, so AttendanceCellEditModal's existing validation
  // (blocking Save on a new row with no time) keeps working unchanged.
  function commit(nextHour, nextMinute, nextAmpm) {
    const h12 = Number(nextHour)
    const m = Number(nextMinute)
    if (!nextHour || h12 < 1 || h12 > 12 || !nextMinute || !Number.isFinite(m) || m < 0 || m > 59) {
      onChange('')
      return
    }
    let h = h12 % 12
    if (nextAmpm === 'PM') h += 12
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  function digitsOnly(raw) {
    return raw.replace(/\D/g, '').slice(0, 2)
  }

  // Jeff, 2026-10-03: a staff tester typed "20" into the hour box meaning
  // 8:00 PM in 24-hour notation — this field is 12-hour (1-12) + a separate
  // AM/PM dropdown, so "20" was simply out of range. commit() correctly
  // treated that as "not filled in" (same as an empty box), but nothing on
  // screen showed WHY — the hour box kept displaying "20" with no error
  // until Save, which then rejected the whole row with a generic "enter a
  // time" message that didn't explain what was wrong with a box that
  // visibly had something typed in it. Once the second digit completes a
  // 24-hour-style hour (13-23, or 00 for midnight), auto-convert it to its
  // 12-hour equivalent AND flip AM/PM to match, rather than silently
  // discarding what was typed — "20" becomes hour "8" with PM selected, so
  // the box visibly shows what it understood. Only fires once both digits
  // are in (`raw.length === 2`) so it never interferes with typing "08" or
  // "09" one digit at a time.
  function normalizeTypedHour(raw) {
    if (raw.length !== 2) return { displayHour: raw, forcedAmpm: null }
    const n = Number(raw)
    if (n === 0) return { displayHour: '12', forcedAmpm: 'AM' }
    if (n >= 13 && n <= 23) return { displayHour: String(n - 12), forcedAmpm: 'PM' }
    return { displayHour: raw, forcedAmpm: null }
  }

  // Anything left over after that conversion (24-99) is genuinely invalid,
  // same for a typed minute over 59 — a red border now flags it immediately
  // instead of leaving the box looking "filled in" until a later Save
  // attempt fails with no visible explanation.
  const hourInvalid = hour !== '' && (Number(hour) < 1 || Number(hour) > 12)
  const minuteInvalid = minute !== '' && Number(minute) > 59

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        placeholder="hh"
        disabled={disabled}
        className={`input w-12 !py-1.5 text-center ${hourInvalid ? 'border-red-400' : ''}`}
        value={hour}
        onChange={(e) => {
          const { displayHour, forcedAmpm } = normalizeTypedHour(digitsOnly(e.target.value))
          const nextAmpm = forcedAmpm ?? ampm
          setHour(displayHour)
          if (forcedAmpm) setAmpm(forcedAmpm)
          commit(displayHour, minute, nextAmpm)
        }}
      />
      <span className="text-gray-400">:</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        placeholder="mm"
        disabled={disabled}
        className={`input w-12 !py-1.5 text-center ${minuteInvalid ? 'border-red-400' : ''}`}
        value={minute}
        onChange={(e) => {
          const v = digitsOnly(e.target.value)
          setMinute(v)
          commit(hour, v, ampm)
        }}
      />
      {/* Jeff, 2026-10-07: "改staff time log的時候，還是看不到am跟pm" — tried
          forcing an explicit color/background + more vertical padding on a
          native <select> here, since on some Android builds its closed-box
          label rendered with no visible text at all (box + chevron show,
          "AM"/"PM" doesn't) while the hour/minute text inputs right next to
          it (same .input class) rendered fine.
          Jeff, 2026-10-08: still broken on his own phone after that — "手機
          版改staff log time是am,pm還是現實不出來，應該是格子太小". A fixed-
          width native select has no reliable way to control how much of
          that width its own OS-drawn chrome (the dropdown arrow, and
          per-device/per-skin built-in padding around it — these vary by
          Android build and aren't addressable from CSS) eats before any is
          left for the label text, so shrinking the font wouldn't have fixed
          it everywhere either — just made it fail on a different box width.
          Replaced the native select entirely with two plain buttons: a
          segmented AM/PM toggle renders its own text exactly like any other
          button label, immune to native-select theming on any device. */}
      <div className="flex overflow-hidden rounded-lg border border-gray-300">
        {['AM', 'PM'].map((period) => (
          <button
            key={period}
            type="button"
            disabled={disabled}
            onClick={() => {
              setAmpm(period)
              commit(hour, minute, period)
            }}
            className={`px-2.5 py-1.5 text-xs font-semibold ${
              ampm === period ? 'bg-brand-500 text-white' : 'bg-white text-gray-600'
            }`}
          >
            {period}
          </button>
        ))}
      </div>
    </div>
  )
}
