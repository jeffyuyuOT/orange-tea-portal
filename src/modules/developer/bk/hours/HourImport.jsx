import { useEffect, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import { fmtMoney } from '../bkUtils'
import { saveHourDay } from '../bkHourData'
import { detectHourlyFile, hourLabel, matchStore, parsePosHourly, posStoreNameFromFile, parseSelfHourly, selfJobs, sumHours } from '../bkHourly'
import { Notice, inputCls } from '../bkUi'

const SOURCE_LABEL = { pos: 'POS', self: '自動點單' }

async function readSheetRows(file) {
  const XLSX = await import('xlsx') // loaded on demand; reads both .xls and .xlsx
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
}

// 小時統計 › 匯入: drop in the POS "Sales By Hour" .xls and/or the self-order
// "Store Performance Report" .xlsx (several files at once). The self-order file
// names its store, so that one is matched automatically; the POS file doesn't,
// so its store is picked here. A re-import replaces the same source's figures for
// that store and day; the other source is left alone.
export default function HourImport({ stores, defaultStoreId, onImported, onClose }) {
  const [files, setFiles] = useState([]) // parsed entries
  const [reading, setReading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [choice, setChoice] = useState({}) // key -> store id picked by hand
  const inputRef = useRef(null)

  async function addFiles(list) {
    setReading(true)
    setError('')
    const next = []
    for (const file of list) {
      try {
        const rows = await readSheetRows(file)
        const kind = detectHourlyFile(rows)
        if (kind === 'pos') {
          const p = parsePosHourly(rows)
          next.push(p.error ? { file: file.name, error: p.error } : { file: file.name, source: 'pos', jobs: [{ key: `${file.name}|pos`, date: p.date, hours: p.hours, storeName: posStoreNameFromFile(file.name) }] })
        } else if (kind === 'self') {
          const p = parseSelfHourly(rows)
          next.push(
            p.error
              ? { file: file.name, error: p.error }
              : { file: file.name, source: 'self', jobs: selfJobs(p.rows).map((j) => ({ ...j, key: `${file.name}|${j.storeName}|${j.storeCode}|${j.date}` })) }
          )
        } else next.push({ file: file.name, error: '認不出這是 POS 的 Sales By Hour，還是自動點單的 Store Performance Report。' })
      } catch (e) {
        next.push({ file: file.name, error: `無法讀取：${e.message}` })
      }
    }
    setFiles((prev) => [...prev, ...next])
    setReading(false)
  }

  // Which store each job goes to: a hand pick, else the store matched by name
  // (self-order), else the page's current store (POS).
  const storeFor = (job, source) => {
    if (choice[job.key]) return choice[job.key]
    if (source === 'self') return matchStore(stores, job)?.id ?? ''
    // POS: the file name's store letter (…s / t / b / u / bb) picks the store, else the page's current store
    const byName = job.storeName ? matchStore(stores, job)?.id : null
    return byName ?? defaultStoreId ?? stores[0]?.id ?? ''
  }

  const jobs = files.flatMap((f) => (f.jobs ?? []).map((j) => ({ ...j, source: f.source, file: f.file, storeId: storeFor(j, f.source) })))
  const ready = jobs.filter((j) => j.storeId)
  // two files for the same store + day + source: the later one would overwrite the earlier
  const seen = new Map()
  const dupes = new Set()
  for (const j of ready) {
    const k = `${j.storeId}|${j.date}|${j.source}`
    if (seen.has(k)) dupes.add(k)
    seen.set(k, true)
  }

  useEffect(() => {
    if (!inputRef.current) return
    inputRef.current.value = ''
  }, [files.length])

  async function apply() {
    setApplying(true)
    setError('')
    try {
      for (const j of ready) await saveHourDay(j.storeId, j.date, j.source, j.hours)
      onImported?.(ready.length)
    } catch (e) {
      setError(e.message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="匯入 小時統計"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {ready.length > 0 ? '取消' : '關閉'}
          </Button>
          <Button disabled={ready.length === 0 || applying} onClick={apply}>
            {applying ? '匯入中…' : `匯入 ${ready.length} 筆`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice kind="info">
          可以一次選多個檔案：POS 的 Sales By Hour（.xls，一個檔一天、檔內沒有店名所以要自己選店）和自動點單的 Store Performance Report（.xlsx，可以多天、會用店名自動對應）。同一間店同一天重新匯入，會取代同一來源的舊數字，另一個來源不受影響。
        </Notice>
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".xls,.xlsx"
            onChange={(e) => e.target.files?.length && addFiles([...e.target.files])}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
          />
          {reading && <div className="mt-2 text-sm text-gray-500">讀取中…</div>}
        </div>
        {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
        {files.some((f) => f.error) && (
          <div className="space-y-1">
            {files
              .filter((f) => f.error)
              .map((f, i) => (
                <Notice key={i} kind="error">
                  {f.file}：{f.error}
                </Notice>
              ))}
          </div>
        )}
        {jobs.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-brand-100">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-brand-50 text-left text-xs font-semibold text-gray-600">
                  <th className="px-3 py-2">檔案</th>
                  <th className="px-3 py-2">來源</th>
                  <th className="px-3 py-2">分店</th>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2">小時</th>
                  <th className="px-3 py-2 text-right">營業額</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.key} className="border-t border-gray-100">
                    <td className="max-w-[180px] truncate px-3 py-2 text-xs text-gray-500" title={j.file}>
                      {j.file}
                    </td>
                    <td className="px-3 py-2">{SOURCE_LABEL[j.source]}</td>
                    <td className="px-3 py-2">
                      <select
                        className={`${inputCls} ${j.storeId ? '' : 'border-red-300'}`}
                        value={j.storeId}
                        onChange={(e) => setChoice((prev) => ({ ...prev, [j.key]: e.target.value }))}
                      >
                        {!j.storeId && <option value="">{j.storeName ? `找不到「${j.storeName}」，請選擇` : '請選擇'}</option>}
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{j.date}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                      {hourLabel(Math.min(...j.hours.map((h) => h.hour)))}–{hourLabel(Math.max(...j.hours.map((h) => h.hour)))}（{j.hours.length}）
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(sumHours(j.hours))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {dupes.size > 0 && <Notice kind="error">有兩個檔案是同一間店、同一天、同一來源，後面的會覆蓋前面的，請確認。</Notice>}
        {jobs.some((j) => !j.storeId) && <Notice kind="error">還有檔案沒有選分店，這幾筆不會匯入。</Notice>}
      </div>
    </Modal>
  )
}
