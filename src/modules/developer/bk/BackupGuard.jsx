import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { Notice } from './bkUi'
import {
  acknowledgeMissed,
  brisbaneDayStr,
  getBackupDir,
  backupTimeLabel,
  dirPermission,
  lastDueDay,
  loadBackupState,
  missedDays,
  runAutoBackup,
} from './bkBackup'

export const BACKUP_CHANGED_EVENT = 'bk-backup-changed'
// Fired after the guard itself wrote a backup / log row, so an open 系統設置 › 備份 page can reload.
export const BACKUP_RAN_EVENT = 'bk-backup-ran'

// Brisbane clock minutes minus the backup time: negative = still before it.
function minutesFromBackupTime() {
  const [h, m] = backupTimeLabel().split(':').map(Number)
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const now = (Number(parts.find((p) => p.type === 'hour').value) % 24) * 60 + Number(parts.find((p) => p.type === 'minute').value)
  return now - (h * 60 + m)
}
// The 30 minutes leading up to the backup time (and the minute it is due): the permission
// reminder is shown again here even if it was dismissed earlier in the day.
const inReminderWindow = () => {
  const d = minutesFromBackupTime()
  return d >= -30 && d <= 0
}

// True once today's backup time has passed and today's backup is not done yet.
function backupPending(state) {
  if (!state?.settings?.enabled) return false
  const [h, m] = backupTimeLabel().split(':').map(Number)
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const now = Number(parts.find((p) => p.type === 'hour').value) % 24 * 60 + Number(parts.find((p) => p.type === 'minute').value)
  if (now < h * 60 + m) return false
  const today = brisbaneDayStr()
  return !state.log.some((r) => r.day === today && (r.status === 'ok' || r.status === 'acknowledged'))
}

// Jeff, 2026-10-26: now mounted once in AppShell (for people who can open BK), so the
// nightly backup runs on ANY page while the browser is open and signed in — not only
// while the BK page itself is showing. The BK tables need a 2FA-verified (aal2) session,
// so it stays idle until the session is at that level.
//  - On startup / sign-in: reads the backup log; if today's 22:30 backup is due and
//    still missing it is made right away (when the folder permission is still
//    valid); any earlier day without a successful backup opens a warning.
//  - While the app stays open: checks every 30 s and makes the backup once the chosen time (系統設置 › 備份) arrives.
export default function BackupGuard() {
  const [missed, setMissed] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  // Jeff, 2026-11-11: warn as soon as the app starts if the backup folder is missing or
  // needs re-authorising (Chrome/Edge drop the folder permission after a restart), instead
  // of finding out at backup time. null = fine; 'nodir' | 'prompt' | 'denied' = problem.
  const [permIssue, setPermIssue] = useState(null)
  const [permDismissed, setPermDismissed] = useState(false) // false | 'early' | 'late'
  const [inWindow, setInWindow] = useState(inReminderWindow())
  const [permBusy, setPermBusy] = useState(false)
  const stateRef = useRef(null)
  const runningRef = useRef(false)

  const checkPerm = useCallback(async () => {
    if (!stateRef.current?.settings?.enabled) return setPermIssue(null)
    const handle = await getBackupDir()
    if (!handle) return setPermIssue('nodir')
    let p = 'denied'
    try {
      p = await dirPermission(handle)
    } catch {
      /* handle no longer valid (folder deleted/moved) */
    }
    setPermIssue(p === 'granted' ? null : p)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (data?.currentLevel !== 'aal2') return
    } catch {
      return
    }
    let state
    try {
      state = await loadBackupState()
    } catch {
      return // table missing / offline: stay quiet, the settings page shows errors
    }
    stateRef.current = state
    const { settings, log } = state
    if (!settings.enabled) {
      setPermIssue(null)
      return setMissed([])
    }

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
          window.dispatchEvent(new Event(BACKUP_RAN_EVENT))
        } finally {
          runningRef.current = false
        }
      }
    }
    setMissed(missedDays(state.settings, state.log))
    await checkPerm()
  }, [checkPerm])

  useEffect(() => {
    refresh()
    // The 30 s tick only has something to do once the backup time has passed and
    // today's backup is still missing; otherwise it skips the two Supabase reads.
    // Jeff, 2026-10-28: it used to skip entirely while the tab was hidden, so with the
    // window minimised / covered / screen off at 22:00 the backup never ran (no request
    // reached Supabase at all that night). It now runs hidden too (the browser only slows
    // a hidden tab's timer to about once a minute), and it also retries while no state has
    // been loaded yet (e.g. the 2FA step was finished after the page opened).
    const id = setInterval(() => {
      setInWindow(inReminderWindow())
      if (stateRef.current && !backupPending(stateRef.current)) {
        if (inReminderWindow()) checkPerm() // local check only, no Supabase reads
        return
      }
      refresh()
    }, 30000)
    const onChange = () => refresh()
    // Coming back to the tab / window (or waking the computer) re-checks at once.
    const onVisible = () => {
      if (document.hidden) return
      if (!stateRef.current || backupPending(stateRef.current)) refresh()
      else checkPerm()
    }
    window.addEventListener(BACKUP_CHANGED_EVENT, onChange)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(id)
      window.removeEventListener(BACKUP_CHANGED_EVENT, onChange)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refresh, checkPerm])

  async function grantPerm() {
    setPermBusy(true)
    try {
      const handle = await getBackupDir()
      if (handle) await dirPermission(handle, true) // needs this click
      await checkPerm()
    } catch {
      await checkPerm()
    } finally {
      setPermBusy(false)
    }
  }
  function laterPerm() {
    setPermDismissed(inReminderWindow() ? 'late' : 'early')
  }

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
      window.dispatchEvent(new Event(BACKUP_RAN_EVENT))
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

  // The permission reminder never stacks on top of the "missed backup" window.
  const showPerm =
    !!permIssue && missed.length === 0 && (permDismissed === false || (permDismissed === 'early' && inWindow))
  const permText = {
    nodir: '自動備份已開啟，但這台電腦的這個瀏覽器還沒有指定備份資料夾，所以今晚不會備份。請到 系統設置 › 備份 選擇資料夾。',
    prompt: `瀏覽器需要你重新授權備份資料夾的寫入權限（電腦重新開機或關掉所有視窗後都會這樣）。不授權的話，今天 ${backupTimeLabel()} 的自動備份會失敗。`,
    denied: '備份資料夾的寫入權限被拒絕了，今晚的自動備份會失敗。請到 系統設置 › 備份 重新授權或更換資料夾。',
  }[permIssue]

  return (
    <>
    <Modal
      open={showPerm}
      onClose={laterPerm}
      title="⚠ 自動備份資料夾需要授權"
      footer={
        <>
          <Button variant="secondary" onClick={laterPerm} disabled={permBusy}>
            稍後
          </Button>
          {permIssue === 'prompt' && (
            <Button onClick={grantPerm} disabled={permBusy}>
              {permBusy ? '授權中…' : '現在授權'}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm">{permText}</p>
    </Modal>
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
        <p>下面這幾天（{backupTimeLabel()}）的自動備份沒有成功：</p>
        <ul className="list-disc space-y-1 pl-5">
          {missed.map((m) => (
            <li key={m.day}>
              <span className="font-medium">{m.day}</span>
              <span className="text-gray-500">
                {m.error ? `（失敗：${m.error}）` : '（那天沒有備份：瀏覽器沒開、沒登入，或還沒完成兩步驟驗證）'}
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
    </>
  )
}
