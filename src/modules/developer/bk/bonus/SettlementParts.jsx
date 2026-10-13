import { useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import { brisbaneTodayStr, fmtMoney } from '../bkUtils'
import { settlementRows } from '../bkDividend'
import { deleteSettlement, saveSettlement, submitSettlement } from '../bkDividendData'
import { Field, Notice, inputCls } from '../bkUi'
import { ConfirmDelete } from './bonusParts'

export const STATUS_LABELS = { saved: '已儲存', submitted: '已提交' }

function ResultTable({ rows }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-brand-100">
      <table className="min-w-full text-sm">
        <thead className="bg-brand-100 text-left text-xs text-gray-700">
          <tr>
            <th className="px-3 py-2">Party</th>
            <th className="px-3 py-2 text-right">可領取收成</th>
            <th className="px-3 py-2 text-right">擁有金庫資產</th>
            <th className="px-3 py-2 text-right">結算</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-gray-100 align-top">
              <td className="px-3 py-2 font-medium">{r.name}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.claimable)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {r.asset === null ? <span className="text-gray-300">—</span> : fmtMoney(r.asset)}
                {r.assetLabel && <div className="text-xs text-gray-400">{r.assetLabel}</div>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtMoney(r.result)}
                {r.from && <div className="text-xs text-red-600">從 {r.from} 領取</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 收成記錄 > 新增 > 收成結算: shows each party's 可領取收成 against the vault pot
// it owns. Reference only — saving it changes no vault or 收成 figure.
export function SettlementModal({ open, view, onClose, onSaved }) {
  const [date, setDate] = useState(brisbaneTodayStr())
  const [error, setError] = useState('')
  const { combined: c, storeId } = view
  const rows = settlementRows(c.allTimeParties, c.window.assets)

  async function save(status) {
    setError('')
    if (!date) return setError('請輸入日期。')
    if (rows.length === 0) return setError('這個範圍還沒有 party，沒有東西可以結算。')
    try {
      await saveSettlement({ storeId, date, status, rows })
      onSaved?.()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="收成結算紀錄"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="secondary" onClick={() => save('saved')}>
            儲存
          </Button>
          <Button onClick={() => save('submitted')}>提交</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice kind="info">結算 = 可領取收成 − 擁有金庫資產（Jeff 對 Jeff B，Mao 對 Mao保）。這裡只是結算參考，不會更動任何金庫和收成數據；數字還是要靠入金、收成記錄去改。</Notice>
        <Field label="日期">
          <input type="date" className={`${inputCls} w-48`} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {rows.length === 0 ? <p className="text-sm text-gray-400">這個範圍還沒有設定 party。</p> : <ResultTable rows={rows} />}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  )
}

// A saved 收成結算 from 歷史紀錄.
export function SettlementDetail({ s, storeNames, onClose, onChanged }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  if (!s) return null
  return (
    <>
      <Modal
        open={!confirming}
        onClose={onClose}
        wide
        title={`收成結算 — ${s.settle_date}`}
        footer={
          <>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              刪除
            </Button>
            {s.status === 'saved' && (
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await submitSettlement(s.id)
                    await onChanged()
                  } catch (e) {
                    setError(e.message)
                  }
                }}
              >
                提交
              </Button>
            )}
            <Button onClick={onClose}>關閉</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {s.store_id ? storeNames[s.store_id] ?? '' : '全部分店'}　·　{STATUS_LABELS[s.status]}　·　僅供參考，沒有更動任何數據
          </p>
          <ResultTable rows={s.rows} />
          {error && <Notice kind="error">{error}</Notice>}
        </div>
      </Modal>
      <ConfirmDelete
        open={confirming}
        text={`${s.settle_date} 收成結算（${STATUS_LABELS[s.status]}）`}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          try {
            await deleteSettlement(s.id)
            setConfirming(false)
            await onChanged()
          } catch (e) {
            setConfirming(false)
            setError(e.message)
          }
        }}
      />
    </>
  )
}
