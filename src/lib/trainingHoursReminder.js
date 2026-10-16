// Shared "has this person worked long enough without passing the Formal
// Quiz that someone should be told" logic — split out of BulletinPage.jsx
// (migration/Jeff, 2026-10-16: "現在不要放在announcement裡面"). Two separate
// surfaces now consume this instead of one Bulletin card: AppShell.jsx (a
// one-time-per-band login popup for the staff member themselves) and
// BulletinPage.jsx (a system Message to this store's managers/admin/
// developer). Keeping the band math and wording here in one place means
// those two can't quietly drift apart.
//
// Jeff's original spec, unchanged: "未qualified的員工在工作超過50個小時後会
// 開始跳出提示...每增加10小時会跳出一個提示,超過100小時候每超過10小時也會有
// 提示" — same 100-hour target the Progress Chart's average learning curve
// and Learning Tracker's 70h warning are both built around.
export const TRAINING_TARGET_HOURS = 100
export const TRAINING_REMINDER_START_HOURS = 50

// hours worked -> null (not yet worth a reminder) | { band, remaining, overHours }.
// `band` is the value both of the *_band tracking columns below are
// compared against to detect "this is a NEW threshold, not one already
// acted on" — floor(hours/10)*10, so it only changes every 10 hours.
export function trainingHoursBandInfo(hours) {
  const band = Math.floor(hours / 10) * 10
  if (band < TRAINING_REMINDER_START_HOURS) return null
  return { band, remaining: Math.max(0, TRAINING_TARGET_HOURS - band), overHours: band - TRAINING_TARGET_HOURS }
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
