import * as XLSX from 'xlsx'
import { supabase } from './supabaseClient'

// --- Formula import: creates formula_items (name/group/category only —
// ingredients & steps are still added per-item in Admin Center, since
// they involve picking specific ingredient_master rows). ---

export function downloadFormulaTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Group (drink/tea/toppings/others)', 'Category (drink group only, must already exist)', 'Name (English)', 'Name (Chinese)'],
    ['drink', 'Fruit Tea', 'Example Fruit Tea', '範例水果茶'],
  ])
  sheet['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 28 }, { wch: 20 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Formula Import')
  XLSX.writeFile(wb, 'formula-import-template.xlsx')
}

export async function importFormulaFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })

  const { data: categories } = await supabase.from('formula_categories').select('id, name').eq('group_key', 'drink')
  const categoryByName = new Map((categories ?? []).map((c) => [c.name.toLowerCase(), c.id]))

  let created = 0
  const errors = []
  for (const row of rows) {
    const group = String(row['Group (drink/tea/toppings/others)'] ?? '').trim().toLowerCase()
    const categoryName = String(row['Category (drink group only, must already exist)'] ?? '').trim()
    const nameEn = String(row['Name (English)'] ?? '').trim()
    const nameZh = String(row['Name (Chinese)'] ?? '').trim()
    if (!nameEn) continue
    if (!['drink', 'tea', 'toppings', 'others'].includes(group)) {
      errors.push(`Row "${nameEn}": invalid group "${group}"`)
      continue
    }
    let categoryId = null
    if (group === 'drink') {
      categoryId = categoryByName.get(categoryName.toLowerCase())
      if (!categoryId) {
        errors.push(`Row "${nameEn}": category "${categoryName}" not found — create it first in Formula Database.`)
        continue
      }
    }
    const { error } = await supabase.from('formula_items').insert({ group_key: group, category_id: categoryId, name_en: nameEn, name_zh: nameZh || null, sort_order: 999 })
    if (error) errors.push(`Row "${nameEn}": ${error.message}`)
    else created += 1
  }
  return { created, errors }
}

// --- Staff import: updates EXISTING profiles matched by email. New logins
// still need to be invited via Supabase Auth first (client apps can't
// create auth users without exposing a service-role key) — see README. ---

export function downloadStaffTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Email (must already have an account)', 'First Name', 'Last Name', 'Phone', 'Date of Birth (YYYY-MM-DD)', 'Store Code', 'Role (admin/shop_manager/staff/training)'],
  ])
  sheet['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 24 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Staff Import')
  XLSX.writeFile(wb, 'staff-import-template.xlsx')
}

export async function importStaffFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })

  const { data: stores } = await supabase.from('stores').select('id, code')
  const storeByCode = new Map((stores ?? []).map((s) => [s.code, s.id]))

  let updated = 0
  const errors = []
  for (const row of rows) {
    const email = String(row['Email (must already have an account)'] ?? '').trim()
    if (!email) continue
    const storeCode = String(row['Store Code'] ?? '').trim()
    const patch = {
      first_name: String(row['First Name'] ?? '').trim() || null,
      last_name: String(row['Last Name'] ?? '').trim() || null,
      phone: String(row['Phone'] ?? '').trim() || null,
      date_of_birth: String(row['Date of Birth (YYYY-MM-DD)'] ?? '').trim() || null,
      role: String(row['Role (admin/shop_manager/staff/training)'] ?? '').trim() || undefined,
      primary_store_id: storeByCode.get(storeCode) ?? undefined,
    }
    Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])
    const { error, count } = await supabase.from('profiles').update(patch).eq('email', email).select('id', { count: 'exact' })
    if (error) errors.push(`${email}: ${error.message}`)
    else if (!count) errors.push(`${email}: no existing account found — invite them first via Supabase Auth.`)
    else updated += 1
  }
  return { updated, errors }
}
