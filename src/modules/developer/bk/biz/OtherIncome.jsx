import Modal from '../../../../components/ui/Modal'
import { fmtMoney, round2, weekdayOf } from '../bkUtils'

// U帳 其他收入 shown on the 營業 pages: a 💰 mark on the days (and in Total)
// that have some; clicking it lists the 其他收入 and adds it to 總營業額.

// rows: bk_cash_entries (kind other_income) -> { [date]: { total, items:[{ date, label, amount }] } }
export function groupOtherIncome(rows) {
  const out = {}
  for (const r of rows) {
    const amount = Number(r.amount) || 0
    const g = (out[r.entry_date] ??= { total: 0, items: [] })
    g.total = round2(g.total + amount)
    g.items.push({ date: r.entry_date, label: [r.description, r.note].filter(Boolean).join('　') || '其他收入', amount })
  }
  return out
}

// All days of a map -> { total, items } (for a Total mark).
export function sumOtherIncome(byDate) {
  const items = Object.keys(byDate)
    .sort()
    .flatMap((d) => byDate[d].items)
  return { total: round2(items.reduce((s, i) => s + i.amount, 0)), items }
}

export function IncomeMark({ onClick, title = '有 U 其他收入，點擊查看' }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={title}
      className="rounded px-0.5 text-[12px] leading-none hover:bg-amber-100"
    >
      💰
    </button>
  )
}

// info = { title, items, sales }  (sales = 總營業額 of the day / month)
export function OtherIncomeModal({ info, onClose }) {
  const items = info?.items ?? []
  const income = round2(items.reduce((s, i) => s + i.amount, 0))
  const sales = info?.sales ?? null
  const multi = new Set(items.map((i) => i.date)).size > 1
  return (
    <Modal open={!!info} onClose={onClose} title={info?.title ?? ''}>
      <div className="space-y-3 text-sm">
        <table className="w-full">
          <tbody>
            {items.map((i, k) => (
              <tr key={k} className="border-b border-gray-100">
                <td className="py-1.5 pr-3 text-gray-600">{multi ? `${i.date.slice(5)} ${weekdayOf(i.date)}　` : ''}{i.label}</td>
                <td className="py-1.5 text-right tabular-nums">{fmtMoney(i.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-1 rounded-lg bg-brand-50 p-3">
          <div className="flex justify-between"><span>其他收入合計</span><span className="tabular-nums">{fmtMoney(income)}</span></div>
          <div className="flex justify-between"><span>總營業額</span><span className="tabular-nums">{fmtMoney(sales)}</span></div>
          <div className="flex justify-between border-t border-brand-100 pt-1 font-semibold">
            <span>總營業額 + 其他收入</span>
            <span className="tabular-nums">{fmtMoney(round2((sales ?? 0) + income))}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
