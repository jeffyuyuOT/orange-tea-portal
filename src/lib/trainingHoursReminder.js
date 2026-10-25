// Shared "has this person worked long enough without passing the Formal
// Quiz that someone should be told" logic — split out of BulletinPage.jsx
// (migration/Jeff, 2026-10-16: "現在不要放在announcement裡面"). Two separate
// surfaces now consume this instead of one Bulletin card: AppShell.jsx (a
// one-time-per-band login popup for the staff member themselves) and
// BulletinPage.jsx (a system Message to this store's managers/admin/
// developer). Keeping the band math and wording here in one place means
// those two can't quietly drift apart.
//
// Jeff, 2026-10-25: replaced the original 10-hour-band design ("每增加10小時
// 会跳出一個提示") with a simpler 3-stage spec — "剩20hr提醒一次，跟時間到提醒
// 一次，之後每超過20hr也提醒一次": one reminder when 20 hours remain, one when
// the 100-hour target is reached, then one more every additional 20 hours
// worked past that. Reminders before the 20-hours-remaining point (i.e.
// below 80 hours) no longer fire at all.
export const TRAINING_TARGET_HOURS = 100
export const TRAINING_PRE_WARNING_HOURS = 20 // fire once this many hours out from the target
export const TRAINING_REPEAT_INTERVAL_HOURS = 20 // then again every this many hours past the target

// hours worked -> null (not yet worth a reminder) | { band, remaining, overHours }.
// `band` is the value both of the *_band tracking columns below are
// compared against to detect "this is a NEW threshold, not one already
// acted on" (consumers only ever check `newBand > storedBand`, so the exact
// numbers below don't need any migration of previously-stored band values —
// see trainingHoursReminder.js's history for the old 10-hour-band scheme
// this replaced). The three stages map to three band values:
//   80            -> the "20 hours left" pre-warning (fires once)
//   100           -> the "target reached" reminder (fires once)
//   120, 140, ...  -> "over by N hours", repeating every 20h past 100
export function trainingHoursBandInfo(hours) {
  const preWarningBand = TRAINING_TARGET_HOURS - TRAINING_PRE_WARNING_HOURS // 80
  if (hours < preWarningBand) return null
  const band =
    hours < TRAINING_TARGET_HOURS
      ? preWarningBand
      : TRAINING_TARGET_HOURS +
        Math.floor((hours - TRAINING_TARGET_HOURS) / TRAINING_REPEAT_INTERVAL_HOURS) * TRAINING_REPEAT_INTERVAL_HOURS
  return {
    band,
    remaining: Math.max(0, TRAINING_TARGET_HOURS - band),
    overHours: Math.max(0, band - TRAINING_TARGET_HOURS),
  }
}

// Same three-way wording the old Bulletin card used. `isSelf` picks between
// "you"/a name — AppShell's popup is always isSelf: true; the Message to
// managers is always isSelf: false.
export function trainingHoursReminderTitle(info, { isSelf, name }) {
  if (info.remaining > 0) {
    return isSelf
      ? `${info.remaining} hours left until your Formal Quiz`
      : `${name}: ${info.remaining} hours left until Formal Quiz`
  }
  if (info.overHours <= 0) {
    return isSelf
      ? 'Reached 100 hours of training — take the Formal Quiz as soon as possible'
      : `${name} reached 100 hours of training — Formal Quiz due`
  }
  return isSelf
    ? `${info.overHours} hours over standard training — take the Formal Quiz as soon as possible`
    : `${name} is ${info.overHours} hours over standard training — Formal Quiz overdue`
}
