import { useEffect, useState } from 'react'
import Button from '../../../../components/ui/Button'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { loadHourSettings, saveHourSetting } from '../bkHourData'
import { DEFAULT_HOURS, hourLabel, settingsMap } from '../bkHourly'
import { Field, Notice, StoreTabs, inputCls } from '../bkUi'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

// 系統設置 › 小時統計: the hours each store shows on the 小時統計 page. The stores
// are the SF / U帳 list (系統設置 › SF › 分店管理); a store with nothing saved
// uses the default.
export default function HourSettings({ stores }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? null)
  const [settings, setSettings] = useState(null)
  const [start, setStart] = useState(DEFAULT_HOURS.start)
  const [end, setEnd] = useState(DEFAULT_HOURS.end)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    loadHourSettings()
      .then((rows) => setSettings(settingsMap(rows)))
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!settings || !storeId) return
    const s = settings[storeId] ?? DEFAULT_HOURS
    setStart(s.start)
    setEnd(s.end)
    setMsg('')
  }, [settings, storeId])

  if (stores.length === 0) return <Notice kind="info">還沒有任何分店。請先到 系統設置 › SF › 分店管理 新增分店。</Notice>
  if (!settings) return error ? <Notice kind="error">{error}</Notice> : <LoadingSpinner />

  const saved = settings[storeId]
  const isDefault = !saved
  const invalid = start > end

  async function save() {
    setError('')
    setMsg('')
    try {
      await saveHourSetting(storeId, start, end)
      setSettings((prev) => ({ ...prev, [storeId]: { start, end } }))
      setMsg('已儲存。')
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <StoreTabs stores={stores} storeId={storeId} onChange={setStoreId} />
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}
      <div className="max-w-md space-y-3 rounded-xl border border-brand-100 p-4">
        <div className="text-sm font-semibold text-brand-900">{stores.find((s) => s.id === storeId)?.name} · 顯示的時段</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="第一個小時">
            <select className={`${inputCls} w-full`} value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="最後一個小時">
            <select className={`${inputCls} w-full`} value={end} onChange={(e) => setEnd(Number(e.target.value))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {invalid ? (
          <div className="text-sm text-red-600">第一個小時不能比最後一個小時晚。</div>
        ) : (
          <div className="text-xs text-gray-500">
            顯示 {hourLabel(start)}–{hourLabel(end)}，共 {end - start + 1} 欄。{isDefault && '（目前是預設值，還沒有儲存過）'}
          </div>
        )}
        <Button disabled={invalid} onClick={save}>
          儲存
        </Button>
        <p className="text-xs text-gray-400">時段外的營業額不會消失：小時統計頁的「合計」仍然包含，另外會多一欄「其他時段」。</p>
      </div>
    </div>
  )
}
