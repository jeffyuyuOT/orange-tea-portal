import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import { Notice } from '../bkUi'
import { BACKUP_CHANGED_EVENT, BACKUP_RAN_EVENT } from '../BackupGuard'
import {
  autoBackupSupported,
  backupTimeLabel,
  brisbaneDayStr,
  dirPermission,
  forgetBackupDir,
  getBackupDir,
  loadBackupState,
  missedDays,
  pickBackupDir,
  runAutoBackup,
  saveBackupTime,
  setBackupEnabled,
} from '../bkBackup'

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', hour12: false }) : '')
const fmtKb = (bytes) => `${Math.round(bytes / 1024).toLocaleString('en-AU')} KB`

// 系統設置 › 備份 › 自動備份 (browser version): pick a folder, switch on the
// nightly backup (time is chosen here), see the last results.
// Jeff, 2026-11-24: "按備份裡的選項都會很容易卡住 … 要先到別的分頁再回來才會解除" — every button
// shared ONE busy flag that stayed on until the whole action had finished, including a reload
// that read every backup file in the (Google Drive) folder. Now each button waits on its own,
// the file list loads in the background (newest 30 only), every wait has a way out, and a
// waiting action is released when the window is focused again.
function withTimeout(promise, ms, label) {
  let t
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`${label}逾時（超過 ${Math.round(ms / 1000)} 秒）`)), ms)
    }),
  ]).finally(() => clearTimeout(t))
}
const WATCHDOG_MS = 20000 // actions that involve no browser prompt should never take this long

export default function AutoBackupPanel() {
  const [state, setState] = useState(null)
  const [dir, setDir] = useState(null)
  const [perm, setPerm] = useState('')
  // Which action is waiting (null = none): 'pick' | 'grant' | 'toggle' | 'clear' | 'time' | 'test' | 'refresh'
  const [pending, setPending] = useState(null)
  const opRef = useRef(0)
  const pendingSinceRef = useRef(0)
  const listSeqRef = useRef(0)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [timeInput, setTimeInput] = useState('22:30')
  // Jeff, 2026-11-11: the list of backups is read straight from the chosen folder, so manual
  // backups show up too (they are deliberately not logged in the database). null = not readable.
  const [files, setFiles] = useState(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const supported = autoBackupSupported()
  const isP = (k) => pending === k

  // Only the newest 30 files are shown, so only those are opened (names carry the date, and
  // opening each file is slow on a cloud-synced folder). Runs in the background.
  const listFiles = useCallback(async (h, p) => {
    const seq = ++listSeqRef.current
    if (!h || p !== 'granted') {
      setFilesLoading(false)
      return setFiles(null)
    }
    setFilesLoading(true)
    try {
      const out = await withTimeout(
        (async () => {
          const names = []
          for await (const [name, entry] of h.entries()) {
            if (entry.kind === 'file' && /^bk-backup-.*\.json$/.test(name)) names.push(name)
          }
          names.sort().reverse()
          const rows = []
          for (const name of names.slice(0, 30)) {
            const f = await (await h.getFileHandle(name)).getFile()
            rows.push({ name, size: f.size, modified: f.lastModified, manual: /-manual-/.test(name) })
          }
          rows.sort((a, b) => b.modified - a.modified)
          return rows
        })(),
        30000,
        '讀取資料夾裡的檔案清單（雲端資料夾可能很慢）'
      )
      if (seq === listSeqRef.current) setFiles(out)
    } catch (e) {
      if (seq === listSeqRef.current) {
        setFiles(null)
        setError(`讀不到資料夾裡的檔案：${e.message}`)
      }
    } finally {
      if (seq === listSeqRef.current) setFilesLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const st = await withTimeout(loadBackupState(), 20000, '讀取備份設定')
      setState(st)
      setTimeInput(backupTimeLabel())
      const h = await withTimeout(getBackupDir(), 8000, '讀取備份資料夾設定')
      setDir(h)
      const p = h ? await withTimeout(dirPermission(h), 8000, '檢查資料夾權限') : ''
      setPerm(p)
      listFiles(h, p) // background — deliberately not awaited
    } catch (e) {
      setError(e.message)
    }
  }, [listFiles])
  useEffect(() => {
    load()
  }, [load])
  // BackupGuard (mounted app-wide) tells us when it made a backup in the background.
  useEffect(() => {
    const onRan = () => load()
    window.addEventListener(BACKUP_RAN_EVENT, onRan)
    return () => window.removeEventListener(BACKUP_RAN_EVENT, onRan)
  }, [load])

  // Not awaited by the buttons: the action itself is done once it has been saved.
  const changed = () => {
    load()
    window.dispatchEvent(new Event(BACKUP_CHANGED_EVENT))
  }

  async function guarded(key, fn) {
    const id = ++opRef.current
    pendingSinceRef.current = Date.now()
    setPending(key)
    setError('')
    setMsg('')
    try {
      await fn()
    } catch (e) {
      if (e?.name !== 'AbortError' && opRef.current === id) setError(e.message)
    } finally {
      if (opRef.current === id) setPending(null)
    }
  }

  // A waiting action is let go when the window is focused again (what switching tabs used to
  // do by accident — it also dismisses the browser's permission prompt), and the actions that
  // never involve a browser prompt are let go after WATCHDOG_MS. The folder picker is left
  // alone: it is a modal window that only ends when the user picks or cancels.
  useEffect(() => {
    if (!pending || pending === 'pick') return undefined
    const release = (reason) => {
      opRef.current += 1 // a late result of the abandoned action is ignored
      setPending(null)
      if (reason) setError(reason)
      load()
    }
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - pendingSinceRef.current < 2000) return
      release('')
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const timer =
      pending === 'grant' || pending === 'test'
        ? null
        : setTimeout(() => release('這個動作等了太久，已解除等待；請看下方狀態確認有沒有成功。'), WATCHDOG_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      if (timer) clearTimeout(timer)
    }
  }, [pending, load])

  const pick = () =>
    guarded('pick', async () => {
      await pickBackupDir()
      changed()
    })
  const grant = () =>
    guarded('grant', async () => {
      await dirPermission(dir, true)
      changed()
    })
  const toggle = () =>
    guarded('toggle', async () => {
      if (!state.settings.enabled && !dir) throw new Error('請先選擇備份資料夾。')
      await withTimeout(setBackupEnabled(!state.settings.enabled), 15000, '儲存設定')
      changed()
    })
  const clearDir = () =>
    guarded('clear', async () => {
      await forgetBackupDir()
      if (state.settings.enabled) await withTimeout(setBackupEnabled(false), 15000, '儲存設定')
      changed()
    })
  const saveTime = () =>
    guarded('time', async () => {
      await withTimeout(saveBackupTime(timeInput), 15000, '儲存時間')
      setMsg(`已儲存：每天 ${timeInput}（布里斯本時間）自動備份。`)
      changed()
    })
  const testNow = () =>
    guarded('test', async () => {
      const r = await runAutoBackup(dir, brisbaneDayStr(), { manual: true })
      if (!r.ok) throw new Error(r.error)
      setMsg(`測試備份成功：${r.fileName}`)
      load()
    })

  if (!state) return error ? <Notice kind="error">{error}</Notice> : null
  const enabled = state.settings.enabled
  const missed = missedDays(state.settings, state.log)
  const permText = { granted: '已授權', prompt: '需要重新授權', denied: '被拒絕' }[perm] ?? ''

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-brand-900">自動備份（瀏覽器版）</h3>
      <Notice kind="info">
        每天在下面設定的時間（布里斯本時間）自動把 BK 全部資料備份成一個檔案到你指定的資料夾，檔名 bk-backup-日期.json。瀏覽器版有幾個限制：一定要用 Chrome / Edge、OT Portal 已登入、而且 BK 頁面開著（可以在背景分頁）才會執行；沒登入或瀏覽器沒開就不會備份——下次進入 BK 頁面時會跳出警示說明哪一天沒成功。重新開啟瀏覽器後，可能要在這裡按一次「重新授權」。
      </Notice>
      {!supported && <Notice kind="error">這個瀏覽器不支援選擇資料夾，請改用 Chrome 或 Edge。</Notice>}
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}
      {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}

      <div className="rounded-xl border border-brand-100 bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500">備份資料夾：</span>
          <span className="font-medium">{dir ? dir.name : '（尚未選擇）'}</span>
          {dir && <span className={perm === 'granted' ? 'text-green-600' : 'text-red-600'}>{permText}</span>}
          <div className="ml-auto flex flex-wrap gap-2">
            {dir && perm !== 'granted' && (
              <Button variant="secondary" onClick={grant} disabled={isP('grant')}>
                {isP('grant') ? '等待授權…' : '重新授權'}
              </Button>
            )}
            <Button variant="secondary" onClick={pick} disabled={isP('pick') || !supported}>
              {isP('pick') ? '等待選擇資料夾…' : dir ? '更換資料夾' : '選擇資料夾'}
            </Button>
            {dir && (
              <Button variant="secondary" onClick={testNow} disabled={isP('test') || perm !== 'granted'}>
                {isP('test') ? '備份中…' : '立即測試備份'}
              </Button>
            )}
            {dir && (
              <Button variant="secondary" onClick={clearDir} disabled={isP('clear')}>
                {isP('clear') ? '處理中…' : '清除'}
              </Button>
            )}
          </div>
        </div>
        {isP('grant') && (
          <p className="mt-1 text-xs text-brand-700">請看這個瀏覽器網址列旁邊的授權提示，按「允許」。沒看到的話，回到這個視窗就會自動取消等待。</p>
        )}
        {isP('pick') && (
          <p className="mt-1 text-xs text-brand-700">請在跳出的「選擇資料夾」視窗操作；它可能被壓在瀏覽器視窗後面，用工作列找一下。</p>
        )}
        <p className="mt-1 text-xs text-gray-400">資料夾只記在這台電腦的這個瀏覽器；換電腦或瀏覽器要重新選擇。</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-100 bg-white p-3 text-sm">
        <span className="text-gray-500">自動備份時間（布里斯本）：</span>
        <input
          type="time"
          className="rounded-lg border border-brand-200 px-2 py-1 text-sm"
          value={timeInput}
          onChange={(e) => setTimeInput(e.target.value)}
        />
        <Button variant="secondary" onClick={saveTime} disabled={isP('time') || !timeInput || timeInput === backupTimeLabel()}>
          {isP('time') ? '儲存中…' : '儲存時間'}
        </Button>
        <span className="text-xs text-gray-400">目前：每天 {backupTimeLabel()}。電腦要在那個時間開著、BK 頁面開著才會備份。</span>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={toggle} disabled={isP('toggle') || !supported} variant={enabled ? 'secondary' : undefined}>
          {isP('toggle') ? '處理中…' : enabled ? '關閉自動備份' : '開啟自動備份'}
        </Button>
        <span className={`text-sm font-medium ${enabled ? 'text-green-600' : 'text-gray-500'}`}>
          {enabled ? `已開啟（從 ${state.settings.enabled_since} 起）` : '未開啟'}
        </span>
      </div>

      {missed.length > 0 && (
        <Notice kind="error">沒有成功備份的日子：{missed.map((m) => m.day).join('、')}</Notice>
      )}

      {dir && perm === 'granted' && files && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-brand-900">資料夾裡的備份檔（含手動備份）</h4>
            <Button variant="secondary" onClick={() => guarded('refresh', load)} disabled={isP('refresh') || filesLoading}>
              {filesLoading ? '讀取中…' : '重新整理'}
            </Button>
          </div>
          {files.length === 0 ? (
            <p className="text-sm text-gray-500">資料夾裡還沒有 bk-backup-*.json 檔案。</p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-xl border border-brand-100">
              <table className="min-w-full text-sm">
                <thead className="bg-brand-100 text-left text-xs text-gray-700">
                  <tr>
                    <th className="px-3 py-2">檔名</th>
                    <th className="px-3 py-2">類型</th>
                    <th className="px-3 py-2">修改時間（布里斯本）</th>
                    <th className="px-3 py-2">大小</th>
                  </tr>
                </thead>
                <tbody>
                  {files.slice(0, 30).map((f) => (
                    <tr key={f.name} className="border-t border-gray-100">
                      <td className="px-3 py-1.5">{f.name}</td>
                      <td className="px-3 py-1.5 text-gray-500">{f.manual ? '手動' : '自動'}</td>
                      <td className="px-3 py-1.5 text-gray-500">{fmtTime(new Date(f.modified).toISOString())}</td>
                      <td className="px-3 py-1.5 text-gray-500">{fmtKb(f.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {state.log.length > 0 && (
        <h4 className="text-sm font-semibold text-brand-900">每日自動備份紀錄（資料庫）</h4>
      )}
      {state.log.length > 0 && (
        <div className="max-h-64 overflow-auto rounded-xl border border-brand-100">
          <table className="min-w-full text-sm">
            <thead className="bg-brand-100 text-left text-xs text-gray-700">
              <tr>
                <th className="px-3 py-2">日期</th>
                <th className="px-3 py-2">結果</th>
                <th className="px-3 py-2">時間</th>
                <th className="px-3 py-2">檔案／原因</th>
              </tr>
            </thead>
            <tbody>
              {state.log.slice(0, 30).map((r) => (
                <tr key={r.day} className="border-t border-gray-100">
                  <td className="px-3 py-1.5">{r.day}</td>
                  <td className={`px-3 py-1.5 ${r.status === 'ok' ? 'text-green-600' : r.status === 'failed' ? 'text-red-600' : 'text-gray-500'}`}>
                    {{ ok: '成功', failed: '失敗', acknowledged: '已知悉（未備份）' }[r.status]}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500">{fmtTime(r.finished_at)}</td>
                  <td className="px-3 py-1.5 text-gray-500">{r.file_name ?? r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
