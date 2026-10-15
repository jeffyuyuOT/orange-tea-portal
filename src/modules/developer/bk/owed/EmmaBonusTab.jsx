import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../../components/ui/LoadingSpinner'
import { loadEmmaCandidateEntries, loadEmmaClaims, saveEmmaClaim } from '../bkData'
import { brisbaneTodayStr, fmtMoney, round2 } from '../bkUtils'
import { Notice, SubTabs, inputCls } from '../bkUi'

const BONUS_RATE = 0.1
// Where each 入金 went (bk_cash_entries.ruju_target).
const TARGET_LABELS = { jeff_bank: 'Jeff B', mao_safe: 'Mao保', other: '其他' }
const targetLabel = (t) => TARGET_LABELS[t] ?? '—'
const SUB_TABS = [
  ['overview', '總覽'],
  ['history', '歷史紀錄'],
]

// 積欠 > Emma: 10% bonus on Sunnybank's 入金. 總覽 lists every not-yet-claimed
// 入金 row; checking one or more requires a note on each before 提交 unlocks,
// and submitting freezes the checked rows + their notes + the 10% total into
// one 歷史紀錄 record (bk_owed_emma_claims) so editing an old 入金 afterwards
// never rewrites a past bonus.
export default function EmmaBonusTab({ stores, topActive = true }) {
  const [sub, setSub] = useState('overview')
  const sunnybank = stores.find((s) => s.name === 'Sunnybank')

  if (!sunnybank) {
    return <Notice kind="info">BK 分店清單裡沒有「Sunnybank」，Emma 的 bonus 需要這個分店才能匯入入金。</Notice>
  }

  return (
    <div className="space-y-4">
      <SubTabs tabs={SUB_TABS} value={sub} onChange={setSub} />
      {sub === 'overview' ? (
        <EmmaOverview sunnybankId={sunnybank.id} active={topActive} />
      ) : (
        <EmmaHistory sunnybankId={sunnybank.id} active={topActive} />
      )}
    </div>
  )
}

function EmmaOverview({ sunnybankId, active }) {
  const [entries, setEntries] = useState([])
  const [claims, setClaims] = useState([])
  const [checked, setChecked] = useState({}) // { [entryId]: true }
  const [notes, setNotes] = useState({}) // { [entryId]: string }
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [e, c] = await Promise.all([loadEmmaCandidateEntries(sunnybankId), loadEmmaClaims()])
      setEntries(e)
      setClaims(c)
      setChecked({})
      setNotes({})
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [sunnybankId])

  useEffect(() => {
    if (active) reload()
  }, [active, reload])

  const claimedIds = useMemo(() => {
    const ids = new Set()
    for (const c of claims) for (const r of c.rows ?? []) ids.add(r.entry_id)
    return ids
  }, [claims])

  const available = entries.filter((e) => !claimedIds.has(e.id))
  const checkedEntries = available.filter((e) => checked[e.id])
  const checkedTotal = round2(checkedEntries.reduce((a, e) => a + Number(e.amount), 0))
  const bonusTotal = round2(checkedTotal * BONUS_RATE)
  const missingNote = checkedEntries.some((e) => !(notes[e.id] ?? '').trim())
  const canSubmit = checkedEntries.length > 0 && !missingNote

  function toggle(id) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      await saveEmmaClaim({
        submittedAt: brisbaneTodayStr(),
        totalAmount: bonusTotal,
        rows: checkedEntries.map((e) => ({ entry_id: e.id, entry_date: e.entry_date, amount: Number(e.amount), target: e.ruju_target ?? null, note: notes[e.id].trim() })),
      })
      setSaved(true)
      await reload()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-3">
      {error && (
        <Notice kind="error" onClose={() => setError('')}>
          {error}
        </Notice>
      )}
      {saved && <Notice kind="ok" onClose={() => setSaved(false)}>已提交，紀錄已加入歷史紀錄。</Notice>}

      {available.length === 0 ? (
        <EmptyState label="沒有可以領取 bonus 的 Sunnybank 入金。" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-brand-100">
          <table className="min-w-full text-sm">
            <thead className="bg-brand-100 text-left text-xs text-gray-700">
              <tr>
                <th className="px-3 py-2">bonus 領取</th>
                <th className="px-3 py-2">日期</th>
                <th className="px-3 py-2 text-right">金額</th>
                <th className="px-3 py-2">入金對象</th>
                <th className="px-3 py-2">附註（勾選後必填）</th>
              </tr>
            </thead>
            <tbody>
              {available.map((e) => (
                <tr key={e.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={!!checked[e.id]} onChange={() => toggle(e.id)} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{e.entry_date}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(Number(e.amount))}</td>
                  <td className="whitespace-nowrap px-3 py-2">{targetLabel(e.ruju_target)}</td>
                  <td className="px-3 py-2">
                    {checked[e.id] && (
                      <input
                        className={`${inputCls} w-full`}
                        placeholder="必填"
                        value={notes[e.id] ?? ''}
                        onChange={(ev) => setNotes((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {checkedEntries.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
          <div className="text-sm">
            已勾選 {checkedEntries.length} 筆，共 {fmtMoney(checkedTotal)}。Bonus 總額（10%）：
            <span className="ml-1 text-lg font-semibold tabular-nums text-brand-900">{fmtMoney(bonusTotal)}</span>
          </div>
          <Button onClick={submit} disabled={!canSubmit || saving}>
            {saving ? '提交中…' : '提交'}
          </Button>
        </div>
      )}
      {missingNote && checkedEntries.length > 0 && <Notice kind="error">勾選的資料都需要填寫附註才能提交。</Notice>}
    </div>
  )
}

function EmmaHistory({ sunnybankId, active }) {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [targets, setTargets] = useState({}) // { [entryId]: ruju_target } — for claims saved before the target was stored with them

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([loadEmmaClaims(), loadEmmaCandidateEntries(sunnybankId)])
      .then(([r, e]) => {
        if (cancelled) return
        setClaims(r)
        setTargets(Object.fromEntries(e.map((x) => [x.id, x.ruju_target])))
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [active, sunnybankId])

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-3">
      {error && (
        <Notice kind="error" onClose={() => setError('')}>
          {error}
        </Notice>
      )}
      {claims.length === 0 ? (
        <EmptyState label="還沒有提交過的 bonus 紀錄。" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-brand-100">
          <table className="min-w-full text-sm">
            <thead className="bg-brand-100 text-left text-xs text-gray-700">
              <tr>
                <th className="px-3 py-2">提交日期</th>
                <th className="px-3 py-2 text-right">Bonus 金額</th>
                <th className="px-3 py-2 text-right">筆數</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id} className="cursor-pointer border-t border-gray-100 hover:bg-brand-50/60" onClick={() => setOpen(c)}>
                  <td className="whitespace-nowrap px-3 py-2">{c.submitted_at}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(Number(c.total_amount))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(c.rows ?? []).length}</td>
                  <td className="px-3 py-2 text-right text-xs text-brand-500">查看</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={`Bonus 詳細內容 — ${open?.submitted_at ?? ''}`} footer={<Button onClick={() => setOpen(null)}>關閉</Button>}>
        {open && (
          <div className="space-y-2">
            <div className="text-sm text-gray-600">
              Bonus 總額：<span className="font-semibold tabular-nums text-brand-900">{fmtMoney(Number(open.total_amount))}</span>
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-brand-100 text-left text-xs text-gray-700">
                <tr>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2 text-right">金額</th>
                  <th className="px-3 py-2">入金對象</th>
                  <th className="px-3 py-2">附註</th>
                </tr>
              </thead>
              <tbody>
                {(open.rows ?? []).map((r, i) => (
                  <tr key={r.entry_id ?? i} className="border-t border-gray-100">
                    <td className="whitespace-nowrap px-3 py-2">{r.entry_date}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(Number(r.amount))}</td>
                    <td className="whitespace-nowrap px-3 py-2">{targetLabel(r.target ?? targets[r.entry_id])}</td>
                    <td className="px-3 py-2">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  )
}
