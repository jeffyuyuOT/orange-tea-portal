import { supabase } from './supabaseClient'

// Tables that make up "reference data" (formula/quiz/training content) as
// opposed to live operational data (rosters, leave, staff PII) or auth.
// Exporting/restoring only this set keeps backup/restore safe to run
// without touching people's accounts or schedules.
const BACKUP_TABLES = [
  'stores',
  'drink_sizes',
  'formula_categories',
  'formula_items',
  'formula_item_sizes',
  'formula_item_ingredients',
  'formula_item_steps',
  'formula_item_stores',
  'ingredient_master',
  'ingredient_format_rules',
  'shop_training_items',
  'quiz_questions',
  'quiz_question_stores',
  'quiz_settings',
  'roster_staffing_rules',
]

export async function exportBackup() {
  const payload = { exported_at: new Date().toISOString(), tables: {} }
  for (const table of BACKUP_TABLES) {
    const { data, error } = await supabase.from(table).select('*')
    if (error) throw new Error(`Failed exporting ${table}: ${error.message}`)
    payload.tables[table] = data
  }
  const json = JSON.stringify(payload, null, 2)
  const filename = `orange-tea-portal-backup-${new Date().toISOString().slice(0, 10)}.json`

  // Chromium browsers (Chrome / Edge) support the File System Access API,
  // which opens a real "Save As" dialog so the person can pick the folder.
  // Other browsers (Firefox, Safari) don't implement it, so we fall back to
  // a normal browser download in that case.
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      return
    } catch (err) {
      // Person closed the folder picker without choosing a location —
      // treat it as "cancelled", not an error, and don't fall through to a
      // surprise download they didn't ask for.
      if (err?.name === 'AbortError') return
      throw err
    }
  }

  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Restores by upserting every row back into its table (matched on id).
// Does NOT delete rows that aren't in the backup — run this on a fresh
// project, or accept that it's additive/overwriting rather than a full
// mirror.
const CONFLICT_KEYS = {
  quiz_settings: 'store_id',
  ingredient_format_rules: 'ingredient_id',
  formula_item_stores: 'formula_item_id,store_id',
  formula_item_sizes: 'formula_item_id,size_id',
  quiz_question_stores: 'question_id,store_id',
}

export async function restoreBackup(file) {
  const text = await file.text()
  const payload = JSON.parse(text)
  const results = []
  for (const table of BACKUP_TABLES) {
    const rows = payload.tables?.[table]
    if (!rows?.length) continue
    const { error } = await supabase.from(table).upsert(rows, { onConflict: CONFLICT_KEYS[table] ?? 'id' })
    results.push({ table, count: rows.length, error: error?.message })
  }
  return results
}
