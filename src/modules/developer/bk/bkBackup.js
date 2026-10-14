// 系統設置 > 備份: BK's own export/restore, deliberately separate from the
// portal-wide src/lib/backup.js (that one is scoped to reference data; BK's
// ledger is live, growing, sensitive operational data, so it has its own
// export and its own table list).
//
// Also holds the browser-side AUTO backup (migration 0112): every day at 22:30
// Brisbane time, while the BK page is open and logged in, the whole backup is
// written into a folder the user picked (File System Access API — Chrome/Edge).
// The folder handle lives in this browser's IndexedDB. If a day has no 'ok'
// log row after 22:30, BkPage warns about it on the next visit.
import { supabase } from '../../../lib/supabaseClient'

// Every bk_* table, in an order that respects FKs on restore. Add new bk_*
// tables here as they're created (bk_backup_* are deliberately NOT included).
const BK_BACKUP_TABLES = [
  'bk_stores',
  'bk_payment_types',
  'bk_opening_balances',
  'bk_sf_months',
  'bk_sf_days',
  'bk_cash_days',
  'bk_cash_entries',
  'bk_store_debts',
  'bk_parties',
  'bk_payouts',
  'bk_dividend_entries',
  'bk_settlements',
  'bk_owed_jeff_entries',
  'bk_owed_emma_claims',
  'bk_sales_stores',
  'bk_sales_days',
]

// Primary key of each table (upsert conflict target + stable paging order).
const PRIMARY_KEYS = {
  bk_opening_balances: 'store_id',
  bk_sf_days: 'sf_month_id,day',
  bk_cash_days: 'store_id,day',
  bk_sales_days: 'store_id,day',
}
const pkOf = (table) => PRIMARY_KEYS[table] ?? 'id'

const PAGE = 1000

// PostgREST caps a response at 1000 rows, so read page by page.
async function fetchAllRows(table) {
  const order = pkOf(table).split(',')
  const rows = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select('*')
    for (const col of order) q = q.order(col)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(`Failed exporting ${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

export async function buildBkBackupJson() {
  const payload = { exported_at: new Date().toISOString(), tables: {} }
  for (const table of BK_BACKUP_TABLES) payload.tables[table] = await fetchAllRows(table)
  return JSON.stringify(payload, null, 2)
}

export async function exportBkBackup() {
  const filename = `bk-backup-${new Date().toISOString().slice(0, 10)}.json`

  // Ask for the save location FIRST (user-gesture rule for showSaveFilePicker).
  let handle = null
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }],
      })
    } catch (err) {
      if (err?.name === 'AbortError') return
      throw err
    }
  }

  const json = await buildBkBackupJson()

  if (handle) {
    const writable = await handle.createWritable()
    await writable.write(json)
    await writable.close()
    return
  }

  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Restores by upserting every row back (matched on the table's primary key).
// Does NOT delete rows missing from the backup.
export async function restoreBkBackup(file) {
  const text = await file.text()
  const payload = JSON.parse(text)
  const results = []
  for (const table of BK_BACKUP_TABLES) {
    const rows = payload.tables?.[table]
    if (!rows?.length) continue
    let error = null
    for (let i = 0; i < rows.length && !error; i += 500) {
      const res = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict: pkOf(table) })
      error = res.error
    }
    results.push({ table, count: rows.length, error: error?.message })
  }
  return results
}

// ---------------------------------------------------------------------------
// Auto backup (browser version)
// ---------------------------------------------------------------------------

export const BACKUP_HOUR = 22
export const BACKUP_MINUTE = 30
const BRISBANE_OFFSET_MS = 10 * 3600 * 1000 // Brisbane is UTC+10 all year (no DST)

export const autoBackupSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

// "Brisbane wall clock" as a Date whose UTC fields hold Brisbane's fields.
const brisbaneWall = (ms = Date.now()) => new Date(ms + BRISBANE_OFFSET_MS)
const dayStr = (d) => d.toISOString().slice(0, 10)

export function brisbaneDayStr(ms = Date.now()) {
  return dayStr(brisbaneWall(ms))
}

// The latest day whose 22:30 has already passed (today after 22:30, else yesterday).
export function lastDueDay(ms = Date.now()) {
  const w = brisbaneWall(ms)
  const minutes = w.getUTCHours() * 60 + w.getUTCMinutes()
  if (minutes >= BACKUP_HOUR * 60 + BACKUP_MINUTE) return dayStr(w)
  return dayStr(new Date(w.getTime() - 86400000))
}

// Milliseconds from now until the next 22:30 Brisbane.
export function msUntilNextBackup(ms = Date.now()) {
  const w = brisbaneWall(ms)
  const target = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), BACKUP_HOUR, BACKUP_MINUTE))
  if (target.getTime() <= w.getTime()) target.setUTCDate(target.getUTCDate() + 1)
  return target.getTime() - w.getTime()
}

const addDay = (s, n) => dayStr(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000))

// --- folder handle in IndexedDB ---
const IDB_NAME = 'ot-portal-bk'
const IDB_STORE = 'handles'
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbOp(mode, fn) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode)
    const req = fn(tx.objectStore(IDB_STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
  })
}
export async function getBackupDir() {
  try {
    return (await idbOp('readonly', (s) => s.get('backupDir'))) ?? null
  } catch {
    return null
  }
}
export const forgetBackupDir = () => idbOp('readwrite', (s) => s.delete('backupDir'))

// Must be called from a click. Remembers the picked folder.
export async function pickBackupDir() {
  const handle = await window.showDirectoryPicker({ id: 'bk-backup', mode: 'readwrite' })
  await idbOp('readwrite', (s) => s.put(handle, 'backupDir'))
  return handle
}

// 'granted' | 'prompt' | 'denied'; with request=true (needs a click) it asks.
export async function dirPermission(handle, request = false) {
  const opts = { mode: 'readwrite' }
  let state = await handle.queryPermission(opts)
  if (state !== 'granted' && request) state = await handle.requestPermission(opts)
  return state
}

// --- settings + log ---
export async function loadBackupState() {
  const [s, l] = await Promise.all([
    supabase.from('bk_backup_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('bk_backup_log').select('*').order('day', { ascending: false }).limit(400),
  ])
  if (s.error) throw new Error(s.error.message)
  if (l.error) throw new Error(l.error.message)
  return { settings: s.data ?? { enabled: false, enabled_since: null }, log: l.data ?? [] }
}

export async function setBackupEnabled(enabled) {
  const patch = { id: 1, enabled, updated_at: new Date().toISOString() }
  if (enabled) patch.enabled_since = brisbaneDayStr()
  const { error } = await supabase.from('bk_backup_settings').upsert(patch, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

async function writeLog(day, status, fileName, errorText) {
  const { error } = await supabase
    .from('bk_backup_log')
    .upsert({ day, status, file_name: fileName ?? null, error: errorText ?? null, finished_at: new Date().toISOString() }, { onConflict: 'day' })
  if (error) throw new Error(error.message)
}

// Days (oldest first) that were due, are not 'ok' and were not acknowledged.
// Failed ones carry their error. Looks back at most 60 days.
export function missedDays(settings, log, ms = Date.now()) {
  if (!settings?.enabled || !settings.enabled_since) return []
  const byDay = new Map(log.map((r) => [r.day, r]))
  const last = lastDueDay(ms)
  let day = settings.enabled_since
  const floor = addDay(last, -59)
  if (day < floor) day = floor
  const out = []
  for (; day <= last; day = addDay(day, 1)) {
    const r = byDay.get(day)
    if (!r || r.status === 'failed') out.push({ day, error: r?.error ?? null })
  }
  return out
}

export async function acknowledgeMissed(days) {
  for (const d of days) await writeLog(d, 'acknowledged', null, null)
}

// Writes bk-backup-<day>.json into the chosen folder and logs the result.
// `forDay` is the day the backup counts for (default: today, Brisbane).
// `manual` (the "立即備份" button): the file gets a time stamp, nothing is logged
// for the day (so tonight's 22:30 backup still runs), and the permission may be
// requested because it comes from a click.
export async function runAutoBackup(handle, forDay = brisbaneDayStr(), { manual = false } = {}) {
  const stamp = new Date(Date.now() + BRISBANE_OFFSET_MS).toISOString().slice(11, 16).replace(':', '')
  const fileName = manual ? `bk-backup-${forDay}-manual-${stamp}.json` : `bk-backup-${forDay}.json`
  try {
    if ((await dirPermission(handle, manual)) !== 'granted') {
      throw new Error('瀏覽器沒有這個備份資料夾的寫入權限（重新開啟瀏覽器後需要再按一次「授權」）')
    }
    const json = await buildBkBackupJson()
    const fh = await handle.getFileHandle(fileName, { create: true })
    const w = await fh.createWritable()
    await w.write(json)
    await w.close()
    if (!manual) await writeLog(forDay, 'ok', fileName, null)
    return { ok: true, fileName }
  } catch (e) {
    if (manual) return { ok: false, error: e.message }
    try {
      await writeLog(forDay, 'failed', null, e.message)
    } catch {
      /* log write failed too — the day simply stays missed */
    }
    return { ok: false, error: e.message }
  }
}
