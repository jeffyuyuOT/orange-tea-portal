import { supabase } from './supabaseClient'

// Tables that make up "reference data" (formula/quiz/training content) as
// opposed to live operational data (rosters, leave, staff PII) or auth.
// Exporting/restoring only this set keeps backup/restore safe to run
// without touching people's accounts or schedules.
const BACKUP_TABLES = [
  'stores',
  'formula_categories',
  'formula_items',
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
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orange-tea-portal-backup-${new Date().toISOString().slice(0, 10)}.json`
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
