import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { Notice } from './bkUi'
import {
  acknowledgeMissed,
  brisbaneDayStr,
  getBackupDir,
  lastDueDay,
  loadBackupState,
  missedDays,
  runAutoBackup,
} from './bkBackup'

export const BACKUP_CHANGED_EVENT = 'bk-backup-changed'

function nearBackupTime() {
  const hour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', hour12: false }).format(new Date()))
  return hour >= 22
}

// Lives inside BkPage (so it only works while the BK page is open and logged in).
//  - On entering BK: reads the backup log; if today's 22:30 backup is due and
//    still missing it is made right away (when the folder permission is still
//    valid); any earlier day without a successful backup opens a warning.
//  - While BK stays open: checks every 30 s and makes the backup once it is 22:30.
export default function BackupGuard() {
  const [missed, setMissed] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const stateRef = useRef(null)
  const runningRef = useRef(false)

  const refresh = useCallback(async () => {
    let state
    try {
      state = await loadBackupState()
    } catch {
      return // table missing / offline: stay quiet, the settings page shows errors
    }
    stateRef.current = state
    const { settings, log } = state
    if (!settings.enabled) return setMissed([])

    // Today's backup is due and not done: try to make it now.
    const due = lastDueDay()
    const doneDue = log.some((r) => r.day === due && (r.status === 'ok' || r.status === 'acknowledged'))
    if (due === brisbaneDayStr() && !doneDue && due >= (settings.enabled_since ?? due) && !runningRef.current) {
      const handle = await getBackupDir()
      if (handle) {
        runningRef.current = true
        try {
          await runAutoBackup(handle, due)
          state = await loadBackupState()
          stateRef.current = state
        } finally {
          runningRef.current = false
        }
      }
    }
    setMissed(missedDays(state.settings, state.log))
  }, [])

  useEffect(() => {
    refresh()
    // The 30 s tick only has something to do around the 22:30 backup time, so
    // outside 22:00–23:59 (Brisbane) — or while the tab is hidden — it skips the
    // two Supabase reads. Opening BK and the change event still refresh at once.
    const id = setInterval(() => {
      if (document.hidden || !nearBackupTime()) return
      refresh()
    }, 30000)
    const onChange = () => refresh()
    window.addEventListener(BACKUP_CHANGED_EVENT, onChange)
    return () => {
      clearInterval(id)
      window.removeEventListener(BACKUP_CHANGED_EVENT, onChange)
    }
  }, [refresh])

  async function backupNow() {
    setBusy(true)
    setError('')
    setResult('')
    try {
      const handle = await getBackupDir()
      if (!handle) throw new Error('還沒有指定備份資料夾，請到 系統設置 › 備份 選擇。')
      const r = await runAutoBackup(handle, brisbaneDayStr(), { manual: true })
      if (!r.ok) throw new Error(r.error)
      await acknowledgeMissed(missed.map((m) => m.day))
      setResult(`已備份：${r.fileName}`)
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function dismiss() {
    setBusy(true)
    try {
      await acknowledgeMissed(missed.map((m) => m.day))
      setMissed([])
      setResult('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={missed.length > 0}
      onClose={() => setMissed([])}
      title="⚠ 自動備份沒有成功"
      footer={
        <>
          <Button variant="secondary" onClick={dismiss} disabled={busy}>
            知道了（不再提醒這幾天）
          </Button>
          <Button onClick={backupNow} disabled={busy}>
            {busy ? '備份中…' : '立即備份'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>下面這幾天晚上 10:30 的自動備份沒有成功：</p>
        <ul className="list-disc space-y-1 pl-5">
          {missed.map((m) => (
            <li key={m.day}>
              <span className="font-medium">{m.day}</span>
              <span className="text-gray-500">
                {m.error ? `（失敗：${m.error}）` : '（那天沒有備份：瀏覽器沒開、沒登入，或沒開著 BK 頁面）'}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-gray-500">
          過去的日子沒辦法補做；「立即備份」會把現在的資料備份到你指定的資料夾，並把這些日子標為已處理。
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        {result && <Notice kind="ok">{result}</Notice>}
      </div>
    </Modal>
  )
}
