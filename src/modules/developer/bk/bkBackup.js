// 系統設置 > 備份: BK's own export/restore, deliberately separate from the
// portal-wide src/lib/backup.js. That file is scoped on purpose to
// "reference data" (formula/quiz/training content) and explicitly excludes
// live operational data (rosters, attendance, staff PII) — BK's financial
// ledger is that same kind of live, growing, sensitive operational data, so
// it doesn't belong mixed into that export: different size, different
// sensitivity, different person who'd restore it (a developer, not whoever
// runs the portal's content backup), and keeping them apart means one export
// can't be blocked or bloated by the other. Same JSON-to-file mechanism,
// own table list.
import { supabase } from '../../../lib/supabaseClient'

// Every bk_* table, in an order that respects FKs on restore (a store before
// anything that references it, a cash entry before a debt row that points
// at it as source_entry_id, etc). Add new bk_* tables here as they're created.
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
]

const CONFLICT_KEYS = {
  bk_opening_balances: 'store_id',
}

export async function exportBkBackup() {
  const filename = `bk-backup-${new Date().toISOString().slice(0, 10)}.json`

  // Same reasoning as src/lib/backup.js: ask for the save location FIRST,
  // before any of the (possibly slow) table reads below, so the browser's
  // "must be handling a user gesture" rule for showSaveFilePicker still holds.
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

  const payload = { exported_at: new Date().toISOString(), tables: {} }
  for (const table of BK_BACKUP_TABLES) {
    const { data, error } = await supabase.from(table).select('*')
    if (error) throw new Error(`Failed exporting ${table}: ${error.message}`)
    payload.tables[table] = data
  }
  const json = JSON.stringify(payload, null, 2)

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

// Restores by upserting every row back into its table (matched on id, or the
// table's own key per CONFLICT_KEYS). Does NOT delete rows missing from the
// backup — additive/overwriting, same caveat as the portal-wide restore.
export async function restoreBkBackup(file) {
  const text = await file.text()
  const payload = JSON.parse(text)
  const results = []
  for (const table of BK_BACKUP_TABLES) {
    const rows = payload.tables?.[table]
    if (!rows?.length) continue
    const { error } = await supabase.from(table).upsert(rows, { onConflict: CONFLICT_KEYS[table] ?? 'id' })
    results.push({ table, count: rows.length, error: error?.message })
  }
  return results
}
