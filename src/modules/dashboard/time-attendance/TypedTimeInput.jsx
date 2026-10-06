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
        className={`input w-12 !py-2 text-center leading-normal ${hourInvalid ? 'border-red-400' : ''}`}
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
        className={`input w-12 !py-2 text-center leading-normal ${minuteInvalid ? 'border-red-400' : ''}`}
        value={minute}
        onChange={(e) => {
          const v = digitsOnly(e.target.value)
          setMinute(v)
          commit(hour, v, ampm)
        }}
      />
      {/* Jeff, 2026-10-07: "新增clock in/out時間的時候AM/PM會看不到內容" — on
          his phone this <select>'s text wasn't rendering at all (the box and
          its dropdown arrow showed, but "AM"/"PM" didn't), while the
          same-row event-type <select> (AttendanceCellEditModal.jsx, plain
          .input padding, no height override) rendered its text fine. The one
          working difference: this one was squeezed to !py-1.5 (6px vertical)
          — likely too tight for this Android build's native <select> chrome
          to lay the label out in, especially if the OS's own accessibility
          font-size is scaled up past what the page's own CSS text sizing
          assumes. Bumped to !py-2 (8px, matching .input's own untouched
          default — the same padding the working event-type select already
          uses) plus an explicit normal line-height, on all three fields here
          for consistent row height, rather than trimming padding specifically
          on the one native widget that needs it most. */}
      <select
        className="input w-20 !py-2 leading-normal"
        disabled={disabled}
        value={ampm}
        onChange={(e) => {
          setAmpm(e.target.value)
          commit(hour, minute, e.target.value)
        }}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}
