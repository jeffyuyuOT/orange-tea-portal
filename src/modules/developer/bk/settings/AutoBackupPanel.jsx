import { useCallback, useEffect, useState } from 'react'
import Button from '../../../../components/ui/Button'
import { Notice } from '../bkUi'
import { BACKUP_CHANGED_EVENT } from '../BackupGuard'
import {
  autoBackupSupported,
  brisbaneDayStr,
  dirPermission,
  forgetBackupDir,
  getBackupDir,
  loadBackupState,
  missedDays,
  pickBackupDir,
  runAutoBackup,
  setBackupEnabled,
} from '../bkBackup'

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', hour12: false }) : '')

// 系統設置 › 備份 › 自動備份 (browser version): pick a folder, switch on the
// nightly 22:30 backup, see the last results.
export default function AutoBackupPanel() {
  const [state, setState] = useState(null)
  const [dir, setDir] = useState(null)
  const [perm, setPerm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const supported = autoBackupSupported()

  const load = useCallback(async () => {
    try {
      setState(await loadBackupState())
      const h = await getBackupDir()
      setDir(h)
      setPerm(h ? await dirPermission(h) : '')
    } catch (e) {
      setError(e.message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const changed = async () => {
    await load()
    window.dispatchEvent(new Event(BACKUP_CHANGED_EVENT))
  }

  async function guarded(fn) {
    setBusy(true)
    setError('')
    setMsg('')
    try {
      await fn()
    } catch (e) {
      if (e?.name !== 'AbortError') setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const pick = () =>
    guarded(async () => {
      await pickBackupDir()
      await changed()
    })
  const grant = () =>
    guarded(async () => {
      await dirPermission(dir, true)
      await changed()
    })
  const toggle = () =>
    guarded(async () => {
      if (!state.settings.enabled && !dir) throw new Error('請先選擇備份資料夾。')
      await setBackupEnabled(!state.settings.enabled)
      await changed()
    })
  const clearDir = () =>
    guarded(async () => {
      await forgetBackupDir()
      if (state.settings.enabled) await setBackupEnabled(false)
      await changed()
    })
  const testNow = () =>
    guarded(async () => {
      const r = await runAutoBackup(dir, brisbaneDayStr(), { manual: true })
      if (!r.ok) throw new Error(r.error)
      setMsg(`測試備份成功：${r.fileName}`)
    })

  if (!state) return error ? <Notice kind="error">{error}</Notice> : null
  const enabled = state.settings.enabled
  const missed = missedDays(state.settings, state.log)
  const permText = { granted: '已授權', prompt: '需要重新授權', denied: '被拒絕' }[perm] ?? ''

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-brand-900">自動備份（瀏覽器版）</h3>
      <Notice kind="info">
        每天晚上 10:30（布里斯本時間）自動把 BK 全部資料備份成一個檔案到你指定的資料夾，檔名 bk-backup-日期.json。瀏覽器版有幾個限制：一定要用 Chrome / Edge、OT Portal 已登入、而且 BK 頁面開著（可以在背景分頁）才會執行；沒登入或瀏覽器沒開就不會備份——下次進入 BK 頁面時會跳出警示說明哪一天沒成功。重新開啟瀏覽器後，可能要在這裡按一次「重新授權」。
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
              <Button variant="secondary" onClick={grant} disabled={busy}>
                重新授權
              </Button>
            )}
            <Button variant="secondary" onClick={pick} disabled={busy || !supported}>
              {dir ? '更換資料夾' : '選擇資料夾'}
            </Button>
            {dir && (
              <Button variant="secondary" onClick={testNow} disabled={busy || perm !== 'granted'}>
                立即測試備份
              </Button>
            )}
            {dir && (
              <Button variant="secondary" onClick={clearDir} disabled={busy}>
                清除
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-400">資料夾只記在這台電腦的這個瀏覽器；換電腦或瀏覽器要重新選擇。</p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={toggle} disabled={busy || !supported} variant={enabled ? 'secondary' : undefined}>
          {enabled ? '關閉自動備份' : '開啟自動備份'}
        </Button>
        <span className={`text-sm font-medium ${enabled ? 'text-green-600' : 'text-gray-500'}`}>
          {enabled ? `已開啟（從 ${state.settings.enabled_since} 起）` : '未開啟'}
        </span>
      </div>

      {missed.length > 0 && (
        <Notice kind="error">沒有成功備份的日子：{missed.map((m) => m.day).join('、')}</Notice>
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
