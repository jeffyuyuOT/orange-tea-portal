import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { fmtMoney } from '../bkUtils'
import { hourLabel } from '../bkHourly'

// The hourly 營業額 of one day, or the per-hour average of several days
// (history › 週統計). `view` = { title, note, hours:[…], values:{hour:dollars}, days } | { title, loading } | null.
export default function HourBreakdown({ view, onClose }) {
  const max = view?.values ? Math.max(0, ...Object.values(view.values)) : 0
  const total = view?.values ? Object.values(view.values).reduce((a, b) => a + b, 0) : 0
  return (
    <Modal open={!!view} onClose={onClose} title={view?.title ?? ''} footer={<Button onClick={onClose}>關閉</Button>}>
      {view?.loading && <LoadingSpinner />}
      {view?.message && <p className="text-sm text-gray-500">{view.message}</p>}
      {view?.values && (
        <div className="space-y-2">
          {view.note && <p className="text-xs text-gray-500">{view.note}</p>}
          {view.days === 0 ? (
            <p className="text-sm text-gray-500">這段時間沒有小時營業額資料。</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-brand-100">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-brand-50 text-left text-xs font-semibold text-gray-600">
                    <th className="px-3 py-2">小時</th>
                    <th className="px-3 py-2 text-right">營業額</th>
                    <th className="w-1/2 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {view.hours.map((h) => {
                    const v = view.values[h] ?? 0
                    return (
                      <tr key={h} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 tabular-nums">{hourLabel(h)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(v)}</td>
                        <td className="px-3 py-1.5">
                          <div className="h-2 rounded-full bg-brand-50">
                            <div className="h-2 rounded-full bg-orange-400" style={{ width: `${max ? (v / max) * 100 : 0}%` }} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="border-t-2 border-brand-100 bg-brand-50/60 font-semibold">
                    <td className="px-3 py-1.5">合計</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(total)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
