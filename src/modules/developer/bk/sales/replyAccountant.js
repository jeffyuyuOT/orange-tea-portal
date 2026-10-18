// 回復會計: the reply e-mail to the accountant, with each store's current COH (U帳 分店現金).
import { brisbaneToday, computeCashDay, computeCashSummary, monthDates, otherIncomeByDate, sfOcaMapFromRows } from '../bkUtils'
import { loadCashMonth } from '../bkData'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The store's COH (SF 現金) as the 分店現金 sheet of this month shows it.
export async function loadStoreCoh(store, year, month) {
  const data = await loadCashMonth(store.id, year, month)
  const sf = sfOcaMapFromRows(data.sfDays)
  const cash = Object.fromEntries(data.cashDays.map((r) => [r.day, r]))
  const income = otherIncomeByDate(data.entries)
  const dayRows = monthDates(year, month).map((date) => ({ date, ...computeCashDay(sf[date], cash[date], income[date] ?? 0) }))
  return computeCashSummary(data.open.coh, data.open.ucoh, dayRows, data.entries).coh
}

export function replyText(dateLabel, lines) {
  return [
    'Hi Ying,',
    '',
    'Please kindly check the attached file.',
    '',
    `The cash on hand on ${dateLabel} is`,
    '',
    ...lines.map((l) => `${l.name} – ${l.coh.toFixed(2)}`),
    '',
    'Thanks',
    '',
    'Kindly Regards',
    '',
    'Jeff',
  ].join('\n')
}

// today's date in Brisbane as "19/Dec", and every store's COH of the current month
export async function buildReply(stores) {
  const t = brisbaneToday()
  const lines = await Promise.all(stores.map(async (s) => ({ name: s.name, coh: await loadStoreCoh(s, t.year, t.month) })))
  return replyText(`${t.day}/${MONTHS[t.month - 1]}`, lines)
}
