import * as XLSX from 'xlsx'
import { supabase } from './supabaseClient'

// ---------------------------------------------------------------------------
// A single registry of every "Import File" type available in
// Admin Center > System Setting. Adding a new importable thing later means
// adding one entry here — the UI (download template / detect / run) is
// generic and doesn't need to change.
//
// Detection: each template's header row is a fixed, distinctive set of
// column names (not the filename, which users rename/duplicate constantly —
// "formula-import-template (2).xlsx" is still a formula file). When a file
// is uploaded we read its header row + sheet name and match them against
// every registered type; the best match is pre-selected in the UI but the
// person can override it before confirming, so a renamed sheet or edited
// header never blocks the import outright.
// ---------------------------------------------------------------------------

export const IMPORT_TYPES = {
  ingredient: {
    key: 'ingredient',
    label: 'Ingredient Master',
    sheetName: 'Ingredient Import',
    columns: [
      'Ingredient Name',
      'Unit',
      'Abbreviation',
      'Font Color (hex, optional)',
      'Background Color (hex, optional)',
      'Bold (yes/no, optional)',
      'Italic (yes/no, optional)',
    ],
    exampleRows: [['Black Tea Base', 'ml', 'BT', '#1f2937', '#fff7ed', 'no', 'no']],
    colWidths: [24, 10, 14, 20, 24, 18, 18],
    run: importIngredients,
  },
  formula: {
    key: 'formula',
    label: 'Formula (items + ingredients)',
    sheetName: 'Formula Import',
    columns: [
      'Group (drink/tea/toppings/others)',
      'Category (drink group only, must already exist)',
      'Name (English)',
      'Name (Chinese)',
      'Size (drink items with multiple sizes only, must already exist)',
      'Ingredients (Name:Qty, Name:Qty, ... — optional, leave blank to just create the item)',
      'Notes (optional)',
    ],
    // One row per SIZE (not per ingredient) — an item with M/L is just 2
    // rows, an item with no sizes is 1 row. All of that row's ingredients
    // go in one cell, comma-separated, each as "Ingredient Name:Quantity"
    // (the name must match an existing Ingredient Master entry; the part
    // after the colon can be anything — "100ml", "little", "1:20", etc.).
    // A Hot version is a row for the SAME item name with " Hot" appended to
    // the Size ("M Hot") — it's a toggle on the item, not a separate item,
    // so it doesn't double up the category's item count.
    exampleRows: [
      ['drink', 'Fruit Tea', 'Example Fruit Tea', '範例水果茶', 'M', 'Black Tea Base:100ml, Passionfruit Syrup:30ml', ''],
      ['drink', 'Fruit Tea', 'Example Fruit Tea', '範例水果茶', 'L', 'Black Tea Base:150ml, Passionfruit Syrup:45ml', ''],
      ['drink', 'Fruit Tea', 'Example Fruit Tea', '範例水果茶', 'M Hot', 'Black Tea Base:100ml, Hot Water:to full', ''],
      ['tea', '', 'Example Hot Tea', '範例熱茶', '', 'Green Tea Leaves:5g', ''],
    ],
    colWidths: [28, 32, 28, 20, 20, 60, 30],
    run: importFormula,
  },
  quiz: {
    key: 'quiz',
    label: 'Quiz Bank',
    sheetName: 'Quiz Import',
    columns: [
      'Group (drink/tea/toppings/others/shop_training)',
      'Category (drink group only)',
      'Linked Item Name (must match an existing formula item or Shop Training title)',
      'Question',
      'Choice A',
      'Choice B',
      'Choice C',
      'Choice D',
      'Correct Choice (A/B/C/D)',
      'Importance (1-3, 1 = most important)',
      'Store Codes (comma separated, blank = all stores)',
    ],
    exampleRows: [
      [
        'drink',
        'Fruit Tea',
        'Example Fruit Tea',
        'How much black tea base goes in an Example Fruit Tea?',
        '100ml',
        '150ml',
        '200ml',
        '250ml',
        'B',
        '2',
        '',
      ],
    ],
    colWidths: [26, 22, 36, 36, 14, 14, 14, 14, 20, 22, 30],
    run: importQuiz,
  },
  shop_training: {
    key: 'shop_training',
    label: 'Shop Training',
    sheetName: 'Shop Training Import',
    columns: ['Title', 'Content (plain text or simple HTML)', 'Visible to Training (yes/no)'],
    exampleRows: [['Opening Checklist', '<p>1. Turn on machines...</p>', 'no']],
    colWidths: [28, 50, 22],
    run: importShopTraining,
  },
  staff: {
    key: 'staff',
    label: 'Staff (update existing accounts)',
    sheetName: 'Staff Import',
    columns: [
      'Email (must already have an account)',
      'First Name',
      'Last Name',
      'Phone',
      'Date of Birth (YYYY-MM-DD)',
      'Store Code',
      'Role (admin/shop_manager/staff/training)',
    ],
    exampleRows: [],
    colWidths: [30, 18, 18, 16, 20, 14, 24],
    run: importStaff,
  },
}

export function downloadTemplate(typeKey) {
  const type = IMPORT_TYPES[typeKey]
  const sheet = XLSX.utils.aoa_to_sheet([type.columns, ...type.exampleRows])
  sheet['!cols'] = type.colWidths.map((wch) => ({ wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, type.sheetName)
  XLSX.writeFile(wb, `${typeKey}-import-template.xlsx`)
}

// Reads just enough of the file to identify it and preview row count,
// without committing to a type yet.
export async function readWorkbookForImport(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf)
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const headerRow = (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] ?? []).map((h) => String(h).trim())
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  return { sheetName, headerRow, rows, rowCount: rows.length }
}

export function detectImportType(sheetName, headerRow) {
  // Strong signal: the sheet tab name matches a template's sheet name exactly.
  const bySheetName = Object.values(IMPORT_TYPES).find((t) => t.sheetName === sheetName)
  if (bySheetName) return bySheetName.key

  // Fallback: score by how many of the type's expected columns are present.
  let best = null
  let bestScore = 0
  for (const type of Object.values(IMPORT_TYPES)) {
    const score = type.columns.filter((c) => headerRow.includes(c)).length
    if (score > bestScore) {
      bestScore = score
      best = type.key
    }
  }
  return bestScore >= 2 ? best : null
}

// --- Ingredient Master import (also sets a Format Rule row if any of the
// optional style columns are filled in). ---
async function importIngredients(rows) {
  let created = 0
  const errors = []
  for (const row of rows) {
    const name = String(row['Ingredient Name'] ?? '').trim()
    if (!name) continue
    const unit = String(row['Unit'] ?? '').trim() || null
    const abbreviation = String(row['Abbreviation'] ?? '').trim()
    const fontColor = String(row['Font Color (hex, optional)'] ?? '').trim()
    const bgColor = String(row['Background Color (hex, optional)'] ?? '').trim()
    const boldRaw = String(row['Bold (yes/no, optional)'] ?? '').trim().toLowerCase()
    const italicRaw = String(row['Italic (yes/no, optional)'] ?? '').trim().toLowerCase()
    const isBold = ['yes', 'y', 'true', '1'].includes(boldRaw)
    const isItalic = ['yes', 'y', 'true', '1'].includes(italicRaw)

    const { data, error } = await supabase.from('ingredient_master').insert({ name, unit }).select().single()
    if (error) {
      errors.push(`"${name}": ${error.message}`)
      continue
    }
    created += 1
    if (abbreviation || fontColor || bgColor || boldRaw || italicRaw) {
      const rule = { ingredient_id: data.id }
      if (abbreviation) rule.abbreviation = abbreviation
      if (fontColor) rule.font_color = fontColor
      if (bgColor) rule.background_color = bgColor
      if (boldRaw) rule.is_bold = isBold
      if (italicRaw) rule.is_italic = isItalic
      const { error: ruleError } = await supabase.from('ingredient_format_rules').upsert(rule, { onConflict: 'ingredient_id' })
      if (ruleError) errors.push(`"${name}" format rule: ${ruleError.message}`)
    }
  }
  return { summary: `${created} ingredient(s) created`, errors }
}

// Splits one "Ingredients" cell — "Black Tea Base:100ml, Passionfruit
// Syrup:30ml" — into [{ingredientName, quantity}, ...]. The part before the
// first colon in each comma-separated chunk is the ingredient name (must
// match Ingredient Master); everything after it is the quantity, free text.
function parseIngredientsCell(raw) {
  return String(raw ?? '')
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const idx = chunk.indexOf(':')
      if (idx === -1) return { ingredientName: chunk, quantity: '' }
      return { ingredientName: chunk.slice(0, idx).trim(), quantity: chunk.slice(idx + 1).trim() }
    })
    .filter((t) => t.ingredientName)
}

// A trailing " Hot" (case-insensitive) on the Size cell marks that row as
// the item's Hot version instead of a separate item — "M Hot" -> size "M",
// isHot true; "Hot" alone (no sizes) -> size "", isHot true; anything else
// is unaffected.
function parseSizeCell(raw) {
  const trimmed = raw.trim()
  const match = trimmed.match(/^(.*?)\s*hot$/i)
  if (match) return { size: match[1].trim(), isHot: true }
  return { size: trimmed, isHot: false }
}

// --- Formula import: creates/updates formula_items (name/group/category)
// AND their ingredients in one pass — one row per SIZE (not per
// ingredient): all of a size's ingredients are packed into a single
// "Name:Qty, Name:Qty" cell (see parseIngredientsCell), so an item with
// M/L sizes is 2 rows total instead of one row per ingredient per size.
// Method (steps) still has to be added per item in Admin Center — there's
// no reasonable spreadsheet shape for rich text + images, so that part
// isn't covered here.
//
// Re-uploading a sheet for an item that already exists (matched by
// name + group + category) updates it rather than creating a duplicate,
// and replaces its ingredient list with what's in the sheet — so fixing a
// typo and re-importing doesn't pile up duplicate ingredient rows.
async function importFormula(rows) {
  const { data: categories } = await supabase.from('formula_categories').select('id, name').eq('group_key', 'drink')
  const categoryByName = new Map((categories ?? []).map((c) => [c.name.toLowerCase(), c.id]))
  const { data: ingredientRows } = await supabase.from('ingredient_master').select('id, name')
  const ingredientByName = new Map((ingredientRows ?? []).map((i) => [i.name.toLowerCase(), i.id]))
  const { data: sizeRows } = await supabase.from('drink_sizes').select('id, name')
  const sizeByName = new Map((sizeRows ?? []).map((s) => [s.name.toLowerCase(), s.id]))
  const { data: existingItems } = await supabase.from('formula_items').select('id, name_en, group_key, category_id, sort_order')

  // Newly-created items used to all get the same hardcoded sort_order (999),
  // which ties them all together — the admin "↑ ↓" reorder buttons swap
  // sort_order values, but Postgres doesn't promise a stable order among
  // rows that tie, so the on-screen order could shuffle itself on every
  // reload ("跳來跳去"). Give each new item its own increasing number
  // instead, picking up after whatever's already in that group/category.
  const nextSortOrderByGroup = new Map()
  for (const i of existingItems ?? []) {
    const groupKey = `${i.group_key}|${i.category_id ?? ''}`
    const current = nextSortOrderByGroup.get(groupKey) ?? 0
    nextSortOrderByGroup.set(groupKey, Math.max(current, (i.sort_order ?? 0) + 1))
  }
  function takeNextSortOrder(group, categoryId) {
    const groupKey = `${group}|${categoryId ?? ''}`
    const next = nextSortOrderByGroup.get(groupKey) ?? 0
    nextSortOrderByGroup.set(groupKey, next + 1)
    return next
  }

  // Fold the sheet's rows into one entry per item, collecting each item's
  // size rows (each carrying its own packed ingredient list) along the way.
  const itemGroups = new Map()
  for (const row of rows) {
    const nameEn = String(row['Name (English)'] ?? '').trim()
    if (!nameEn) continue
    const group = String(row['Group (drink/tea/toppings/others)'] ?? '').trim().toLowerCase()
    const categoryName = String(row['Category (drink group only, must already exist)'] ?? '').trim()
    const nameZh = String(row['Name (Chinese)'] ?? '').trim()
    const key = `${group}|${categoryName.toLowerCase()}|${nameEn.toLowerCase()}`
    if (!itemGroups.has(key)) itemGroups.set(key, { group, categoryName, nameEn, nameZh: '', notes: '', sizeRows: [], hasHotVersion: false })
    const entry = itemGroups.get(key)
    if (nameZh) entry.nameZh = nameZh
    const notes = String(row['Notes (optional)'] ?? '').trim()
    if (notes) entry.notes = notes
    const sizeRaw = String(row['Size (drink items with multiple sizes only, must already exist)'] ?? '').trim()
    const { size, isHot } = parseSizeCell(sizeRaw)
    const ingredientsRaw = String(row['Ingredients (Name:Qty, Name:Qty, ... — optional, leave blank to just create the item)'] ?? '').trim()
    if (ingredientsRaw) entry.sizeRows.push({ size, isHot, tokens: parseIngredientsCell(ingredientsRaw) })
    if (isHot) entry.hasHotVersion = true
  }

  let itemsCreated = 0
  let itemsUpdated = 0
  let ingredientsSaved = 0
  const errors = []

  for (const entry of itemGroups.values()) {
    const { group, categoryName, nameEn, nameZh, notes, sizeRows: entrySizeRows, hasHotVersion } = entry
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

    const existing = (existingItems ?? []).find(
      (i) => i.name_en.toLowerCase() === nameEn.toLowerCase() && i.group_key === group && (group !== 'drink' || i.category_id === categoryId)
    )
    let itemId = existing?.id
    if (existing) {
      const { error } = await supabase
        .from('formula_items')
        .update({ name_zh: nameZh || null, notes: notes || null, has_hot_version: hasHotVersion })
        .eq('id', itemId)
      if (error) {
        errors.push(`Row "${nameEn}": ${error.message}`)
        continue
      }
      itemsUpdated += 1
      await supabase.from('formula_item_ingredients').delete().eq('formula_item_id', itemId)
      if (group === 'drink') await supabase.from('formula_item_sizes').delete().eq('formula_item_id', itemId)
    } else {
      const { data, error } = await supabase
        .from('formula_items')
        .insert({
          group_key: group,
          category_id: categoryId,
          name_en: nameEn,
          name_zh: nameZh || null,
          notes: notes || null,
          has_hot_version: hasHotVersion,
          sort_order: takeNextSortOrder(group, categoryId),
        })
        .select()
        .single()
      if (error) {
        errors.push(`Row "${nameEn}": ${error.message}`)
        continue
      }
      itemId = data.id
      itemsCreated += 1
    }

    if (!entrySizeRows.length) continue

    const sizeNamesUsed = [...new Set(entrySizeRows.map((r) => r.size).filter(Boolean))]
    const sizeIdByName = new Map()
    let sizeError = false
    for (const sizeName of sizeNamesUsed) {
      if (group !== 'drink') {
        errors.push(`Row "${nameEn}": Size only applies to drink items`)
        sizeError = true
        break
      }
      const sizeId = sizeByName.get(sizeName.toLowerCase())
      if (!sizeId) {
        errors.push(`Row "${nameEn}": size "${sizeName}" not found — add it first in Formula Database > Drink Sizes.`)
        sizeError = true
        break
      }
      sizeIdByName.set(sizeName.toLowerCase(), sizeId)
    }
    if (sizeError) continue

    if (sizeNamesUsed.length) {
      await supabase
        .from('formula_item_sizes')
        .insert([...sizeIdByName.values()].map((size_id) => ({ formula_item_id: itemId, size_id })))
    }

    const toInsert = []
    entrySizeRows.forEach((sizeRow) => {
      sizeRow.tokens.forEach((tok) => {
        const ingredientId = ingredientByName.get(tok.ingredientName.toLowerCase())
        if (!ingredientId) {
          errors.push(`Row "${nameEn}": ingredient "${tok.ingredientName}" not found — add it first via the Ingredient Master import.`)
          return
        }
        toInsert.push({
          formula_item_id: itemId,
          ingredient_id: ingredientId,
          quantity_text: tok.quantity,
          size_id: sizeRow.size ? sizeIdByName.get(sizeRow.size.toLowerCase()) ?? null : null,
          is_hot: sizeRow.isHot,
          sort_order: toInsert.length,
        })
      })
    })
    if (toInsert.length) {
      const { error } = await supabase.from('formula_item_ingredients').insert(toInsert)
      if (error) errors.push(`Row "${nameEn}": ${error.message}`)
      else ingredientsSaved += toInsert.length
    }
  }

  return {
    summary: `${itemsCreated} item(s) created, ${itemsUpdated} updated, ${ingredientsSaved} ingredient(s) saved`,
    errors,
  }
}

// --- Quiz Bank import ---
async function importQuiz(rows) {
  const { data: categories } = await supabase.from('formula_categories').select('id, name').eq('group_key', 'drink')
  const categoryByName = new Map((categories ?? []).map((c) => [c.name.toLowerCase(), c.id]))
  const { data: formulaItems } = await supabase.from('formula_items').select('id, name_en, group_key, category_id')
  const { data: trainingItems } = await supabase.from('shop_training_items').select('id, title')
  const { data: stores } = await supabase.from('stores').select('id, code')
  const storeByCode = new Map((stores ?? []).map((s) => [s.code.toLowerCase(), s.id]))

  let created = 0
  const errors = []
  for (const row of rows) {
    const group = String(row['Group (drink/tea/toppings/others/shop_training)'] ?? '').trim().toLowerCase()
    const categoryName = String(row['Category (drink group only)'] ?? '').trim()
    const linkedName = String(row['Linked Item Name (must match an existing formula item or Shop Training title)'] ?? '').trim()
    const question = String(row['Question'] ?? '').trim()
    if (!question) continue
    if (!['drink', 'tea', 'toppings', 'others', 'shop_training'].includes(group)) {
      errors.push(`"${question.slice(0, 30)}…": invalid group "${group}"`)
      continue
    }

    let categoryId = null
    if (group === 'drink') {
      categoryId = categoryByName.get(categoryName.toLowerCase())
      if (!categoryId) {
        errors.push(`"${question.slice(0, 30)}…": category "${categoryName}" not found`)
        continue
      }
    }

    let formulaItemId = null
    let shopTrainingItemId = null
    if (group === 'shop_training') {
      const match = (trainingItems ?? []).find((t) => t.title.toLowerCase() === linkedName.toLowerCase())
      if (!match) {
        errors.push(`"${question.slice(0, 30)}…": Shop Training item "${linkedName}" not found`)
        continue
      }
      shopTrainingItemId = match.id
    } else {
      const match = (formulaItems ?? []).find(
        (i) => i.name_en.toLowerCase() === linkedName.toLowerCase() && i.group_key === group && (group !== 'drink' || i.category_id === categoryId)
      )
      if (!match) {
        errors.push(`"${question.slice(0, 30)}…": formula item "${linkedName}" not found in that group/category`)
        continue
      }
      formulaItemId = match.id
    }

    const choices = ['A', 'B', 'C', 'D']
      .map((key) => ({ key, text: String(row[`Choice ${key}`] ?? '').trim() }))
      .filter((c) => c.text)
    const correctChoice = String(row['Correct Choice (A/B/C/D)'] ?? '').trim().toUpperCase()
    if (!choices.length || !choices.some((c) => c.key === correctChoice)) {
      errors.push(`"${question.slice(0, 30)}…": correct choice "${correctChoice}" doesn't match any filled-in choice`)
      continue
    }
    const importance = Number(row['Importance (1-3, 1 = most important)']) || 2

    const { data: inserted, error } = await supabase
      .from('quiz_questions')
      .insert({
        group_key: group,
        category_id: categoryId,
        formula_item_id: formulaItemId,
        shop_training_item_id: shopTrainingItemId,
        question,
        choices,
        correct_choice: correctChoice,
        importance,
      })
      .select()
      .single()
    if (error) {
      errors.push(`"${question.slice(0, 30)}…": ${error.message}`)
      continue
    }

    const storeCodesRaw = String(row['Store Codes (comma separated, blank = all stores)'] ?? '').trim()
    if (storeCodesRaw) {
      const ids = storeCodesRaw
        .split(',')
        .map((c) => storeByCode.get(c.trim().toLowerCase()))
        .filter(Boolean)
      if (ids.length) await supabase.from('quiz_question_stores').insert(ids.map((store_id) => ({ question_id: inserted.id, store_id })))
    }
    created += 1
  }
  return { summary: `${created} quiz question(s) created`, errors }
}

// --- Shop Training import ---
async function importShopTraining(rows) {
  const { count: existingCount } = await supabase.from('shop_training_items').select('id', { count: 'exact', head: true })
  let sortOrder = existingCount ?? 0
  let created = 0
  const errors = []
  for (const row of rows) {
    const title = String(row['Title'] ?? '').trim()
    if (!title) continue
    const content = String(row['Content (plain text or simple HTML)'] ?? '').trim()
    const visible = ['yes', 'y', 'true', '1'].includes(String(row['Visible to Training (yes/no)'] ?? '').trim().toLowerCase())
    const { error } = await supabase
      .from('shop_training_items')
      .insert({ title, content_html: content, visible_to_training: visible, sort_order: sortOrder })
    if (error) errors.push(`"${title}": ${error.message}`)
    else {
      created += 1
      sortOrder += 1
    }
  }
  return { summary: `${created} shop training item(s) created`, errors }
}

// --- Staff import: updates EXISTING profiles matched by email. New logins
// still need to be invited via Supabase Auth first (client apps can't
// create auth users without exposing a service-role key) — see README. ---
async function importStaff(rows) {
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
  return { summary: `${updated} staff record(s) updated`, errors }
}
