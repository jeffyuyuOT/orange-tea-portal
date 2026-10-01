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

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        placeholder="hh"
        disabled={disabled}
        className="input w-12 !py-1.5 text-center"
        value={hour}
        onChange={(e) => {
          const v = digitsOnly(e.target.value)
          setHour(v)
          commit(v, minute, ampm)
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
        className="input w-12 !py-1.5 text-center"
        value={minute}
        onChange={(e) => {
          const v = digitsOnly(e.target.value)
          setMinute(v)
          commit(hour, v, ampm)
        }}
      />
      <select
        className="input w-20 !py-1.5"
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
