// NOTE: this uses the plain 'xlsx' package (same as backup.js/importTemplates.js),
// not 'xlsx-js-style' — that fork touches Node's 'stream' module at load time,
// which breaks under this project's (Rolldown) Vite build with a blank white
// screen. The free 'xlsx' writer silently ignores the `.s` style objects
// below (no colours/borders in the output), which is why they're still
// here — harmless, and kept in case a style-capable writer becomes viable
// later — but the resulting .xlsx is plain text/borders-free for now.
import * as XLSX from 'xlsx'
import { supabase } from './supabaseClient'

// ---------------------------------------------------------------------------
// "Menu Export" (System Setting > Menu Export): a print-friendly PDF or a
// coloured .xlsx of the formula database, filtered to whichever sections
// (drink/tea/toppings/others/shop training) and store the person picks.
//
// PDF is produced by opening a fresh window with its own print stylesheet
// (small @page margin, dense layout — no server-side PDF library needed)
// and calling window.print(); the person chooses "Save as PDF" in the print
// dialog to get an actual file.
//
// Excel is a real, directly-downloaded .xlsx via 'xlsx-js-style' (a
// SheetJS fork that can actually WRITE cell colours/bold — the plain
// 'xlsx' package used elsewhere in this project can only write bare text,
// which isn't enough here since ingredients need to be colour-coded per
// their Format Rule, same as on screen).
//
// Both renderers build one small ingredient x size TABLE per item (not a
// single shared table across every item — each item has its own set of
// ingredients) so quantities line up into real columns instead of drifting
// out of alignment as flowing comma-separated text.
// ---------------------------------------------------------------------------

const GROUP_LABELS = { drink: 'Drink', tea: 'Tea', toppings: 'Toppings', others: 'Others' }
const FORMULA_GROUPS = ['drink', 'tea', 'toppings', 'others']

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function stripHtmlPlain(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

// The distinct ingredients used across an item's sizes, in first-seen order
// — these become the columns of that item's mini table. Shared between the
// PDF and Excel renderers so they always agree on which columns exist.
function ingredientColumns(item) {
  const columns = []
  const seen = new Set()
  for (const ing of item.ingredients) {
    const key = ing.ingredient_id ?? ing.id
    if (!seen.has(key)) {
      seen.add(key)
      columns.push(ing)
    }
  }
  return columns
}

function cellFor(item, colKey, sizeId) {
  return item.ingredients.find((ing) => (ing.ingredient_id ?? ing.id) === colKey && (ing.size_id ?? null) === (sizeId ?? null))
}

// Fetches and shapes everything an export needs, filtered to the selected
// sections and (optionally) one store. A formula item with no
// formula_item_stores rows at all is visible everywhere — same "no rows =
// all stores" convention ItemEditModal/FormulaItemDetail already use.
export async function fetchMenuExportData({ groups, storeId }) {
  const formulaGroups = groups.filter((g) => FORMULA_GROUPS.includes(g))
  const includeShopTraining = groups.includes('shop_training')
  const sections = []

  if (formulaGroups.length) {
    const { data: categories } = await supabase
      .from('formula_categories')
      .select('id, name, group_key, sort_order')
      .eq('group_key', 'drink')
      .order('sort_order')
      .order('id')
    const categoryById = new Map((categories ?? []).map((c) => [c.id, c]))

    const { data: itemRows, error } = await supabase
      .from('formula_items')
      .select(
        '*, formula_item_ingredients(*, ingredient_master(name, unit, ingredient_format_rules(*))), formula_item_stores(store_id), formula_item_sizes(size_id, drink_sizes(id, name, sort_order))'
      )
      .in('group_key', formulaGroups)
      .eq('is_active', true)
      .order('sort_order')
      .order('id')
    if (error) throw error

    const items = (itemRows ?? [])
      .filter(
        (row) => storeId === 'all' || !row.formula_item_stores.length || row.formula_item_stores.some((r) => r.store_id === storeId)
      )
      .map((row) => ({
        id: row.id,
        group_key: row.group_key,
        category_id: row.category_id,
        name_en: row.name_en,
        name_zh: row.name_zh,
        display_mode: row.display_mode,
        custom_image_path: row.custom_image_path,
        notes: row.notes,
        // Same filter as FormulaItemDetail.jsx: drop ingredient rows where
        // no ingredient was ever actually picked — a leftover blank
        // "+ Add ingredient" row otherwise shows up here as its own column
        // labelled "?" (ingredient_master comes back null for it). Also
        // drop Hot-version rows — this export prints one fixed table per
        // item, so an item with a Hot toggle exports its Iced/Cold formula
        // (the Hot one is still there live on the Formula page).
        ingredients: (row.formula_item_ingredients ?? []).filter((ing) => ing.ingredient_id && !ing.is_hot),
        sizes: (row.formula_item_sizes ?? [])
          .map((r) => r.drink_sizes)
          .filter(Boolean)
          .sort((a, b) => a.sort_order - b.sort_order),
      }))

    for (const groupKey of formulaGroups) {
      const groupItems = items.filter((i) => i.group_key === groupKey)
      if (groupKey === 'drink') {
        const cats = [...(categories ?? [])].sort((a, b) => a.sort_order - b.sort_order)
        const categoryBlocks = cats
          .map((c) => ({ name: c.name, items: groupItems.filter((i) => i.category_id === c.id) }))
          .filter((c) => c.items.length)
        const uncategorized = groupItems.filter((i) => !categoryById.has(i.category_id))
        if (uncategorized.length) categoryBlocks.push({ name: 'Uncategorized', items: uncategorized })
        sections.push({ key: groupKey, label: GROUP_LABELS[groupKey], categories: categoryBlocks })
      } else {
        sections.push({ key: groupKey, label: GROUP_LABELS[groupKey], categories: [{ name: null, items: groupItems }] })
      }
    }
  }

  let shopTraining = null
  if (includeShopTraining) {
    const { data } = await supabase.from('shop_training_items').select('title, content_html').order('sort_order').order('id')
    shopTraining = data ?? []
  }

  return { sections, shopTraining }
}

// ---------------------------------------------------------------------------
// PDF (print window)
// ---------------------------------------------------------------------------

// Same Format Rule fallback colours used on-screen (FormulaItemDetail.jsx)
// so the printed sheet looks like what staff already see in the app.
function ruleStyleCss(rule) {
  const color = rule?.font_color || '#1f2937'
  const bg = rule?.background_color || '#fff7ed'
  const weight = rule?.is_bold ? 700 : 400
  const style = rule?.is_italic ? 'italic' : 'normal'
  return `color:${color};background-color:${bg};font-weight:${weight};font-style:${style};`
}

function itemHtml(item) {
  const nameHtml = `${escapeHtml(item.name_en)}${item.name_zh ? ` <span class="zh">· ${escapeHtml(item.name_zh)}</span>` : ''}`

  if (item.display_mode === 'custom' && item.custom_image_path) {
    return `<div class="item"><div class="item-name">${nameHtml}</div><img class="custom" src="${escapeHtml(item.custom_image_path)}" />${
      item.notes ? `<div class="notes">${escapeHtml(item.notes)}</div>` : ''
    }</div>`
  }

  const columns = ingredientColumns(item)
  const hasSizes = item.sizes.length > 0
  const sizeRows = hasSizes ? item.sizes : [null]

  const tableHtml = columns.length
    ? `<table class="ing-table">
        <thead><tr>
          ${hasSizes ? '<th></th>' : ''}
          ${columns
            .map((col) => {
              const rule = col.ingredient_master?.ingredient_format_rules
              const label = rule?.abbreviation || col.ingredient_master?.name || '?'
              return `<th style="${ruleStyleCss(rule)}">${escapeHtml(label)}</th>`
            })
            .join('')}
        </tr></thead>
        <tbody>
          ${sizeRows
            .map((size) => {
              const cells = columns
                .map((col) => {
                  const colKey = col.ingredient_id ?? col.id
                  const cell = cellFor(item, colKey, size?.id)
                  const rule = col.ingredient_master?.ingredient_format_rules
                  const unit = col.ingredient_master?.unit
                  return `<td style="${ruleStyleCss(rule)}" title="${cell?.quantity_text && unit ? escapeHtml(unit) : ''}">${escapeHtml(cell?.quantity_text || '')}</td>`
                })
                .join('')
              return `<tr>${hasSizes ? `<td class="size-label">${escapeHtml(size.name)}</td>` : ''}${cells}</tr>`
            })
            .join('')}
        </tbody>
      </table>`
    : ''

  return `<div class="item">
    <div class="item-name">${nameHtml}</div>
    ${tableHtml}
    ${item.notes ? `<div class="notes">${escapeHtml(item.notes)}</div>` : ''}
  </div>`
}

function buildPrintHtml({ sections, shopTraining }) {
  const sectionsHtml = sections
    .map((section) => {
      const catsHtml = section.categories
        .map((cat) => {
          const itemsHtml = cat.items.map(itemHtml).join('')
          return cat.name ? `<h2 class="category-title">${escapeHtml(cat.name)}</h2>${itemsHtml}` : itemsHtml
        })
        .join('')
      return `<h1 class="section-title">${escapeHtml(section.label)}</h1>${catsHtml || '<p class="empty">No items.</p>'}`
    })
    .join('')

  const trainingHtml = shopTraining
    ? `<h1 class="section-title">Shop Training</h1>${
        shopTraining.length
          ? shopTraining
              .map(
                (t) =>
                  `<div class="item"><div class="item-name">${escapeHtml(t.title)}</div><div class="training-content">${t.content_html || ''}</div></div>`
              )
              .join('')
          : '<p class="empty">No items.</p>'
      }`
    : ''

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Orange Tea Menu Export</title>
<style>
  @page { size: A4; margin: 6mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; font-size: 10.5px; color: #1f2937; margin: 0; padding: 0; }
  h1.section-title { font-size: 15px; margin: 10px 0 4px; padding-bottom: 2px; border-bottom: 2px solid #f97316; color: #c2410c; break-after: avoid; }
  h1.section-title:first-child { margin-top: 0; }
  h2.category-title { font-size: 12px; margin: 6px 0 2px; color: #9a3412; break-after: avoid; }
  .item { break-inside: avoid; padding: 3px 0; border-bottom: 1px dotted #e5e7eb; }
  .item-name { font-weight: 700; margin-bottom: 2px; }
  .item-name .zh { font-weight: 400; color: #6b7280; }
  .ing-table { border-collapse: collapse; margin-left: 6px; }
  .ing-table th, .ing-table td { border: 1px solid #d1d5db; padding: 1px 5px; font-size: 9.5px; text-align: center; white-space: nowrap; }
  .ing-table td.size-label, .ing-table th:first-child { text-align: left; font-weight: 600; background: #f9fafb; color: #374151; }
  .notes { margin-left: 6px; font-style: italic; color: #6b7280; font-size: 9.5px; }
  .empty { color: #9ca3af; font-size: 10px; }
  img.custom { max-width: 110px; max-height: 80px; display: block; margin: 2px 0 2px 6px; }
  .training-content { margin-left: 6px; font-size: 10px; }
</style>
</head>
<body>
${sectionsHtml}
${trainingHtml}
</body>
</html>`
}

// Opens a fresh window with the print stylesheet above, then triggers the
// browser's print dialog — the person picks "Save as PDF" as the
// destination there to get a file. Margins are already minimal via @page,
// though the print dialog's own "Margins" option (set to "Default") is
// what makes Chrome/Edge actually honour that CSS value.
export function exportMenuAsPdf(data) {
  const html = buildPrintHtml(data)
  const win = window.open('', '_blank', 'width=900,height=1200')
  if (!win) {
    alert("Your browser blocked the print window — please allow pop-ups for this site and try 'Export PDF' again.")
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.onload = () => {
    win.focus()
    win.print()
  }
}

// ---------------------------------------------------------------------------
// Excel (.xlsx, coloured cells via xlsx-js-style)
// ---------------------------------------------------------------------------

const THIN_BORDER = { style: 'thin', color: { rgb: 'D1D5DB' } }
const CELL_BORDER = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER }

function hexNoHash(hex, fallback) {
  return (hex || fallback).replace('#', '').toUpperCase()
}

function ruleXlsxStyle(rule, { header }) {
  return {
    font: {
      color: { rgb: hexNoHash(rule?.font_color, '1F2937') },
      bold: !!rule?.is_bold || !!header,
      italic: !!rule?.is_italic,
      sz: 10,
    },
    fill: { fgColor: { rgb: hexNoHash(rule?.background_color, 'FFF7ED') } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
    border: CELL_BORDER,
  }
}

const LABEL_STYLE = {
  font: { color: { rgb: '374151' }, bold: true, sz: 10 },
  fill: { fgColor: { rgb: 'F9FAFB' } },
  alignment: { horizontal: 'left', vertical: 'center' },
  border: CELL_BORDER,
}

const TITLE_STYLE = {
  font: { color: { rgb: '9A3412' }, bold: true, sz: 11 },
  fill: { fgColor: { rgb: 'FFF7ED' } },
  alignment: { horizontal: 'left', vertical: 'center' },
}

const NOTE_STYLE = {
  font: { color: { rgb: '6B7280' }, italic: true, sz: 9 },
  alignment: { horizontal: 'left', vertical: 'center' },
}

function setCell(ws, r, c, value, style) {
  ws[XLSX.utils.encode_cell({ r, c })] = { v: value ?? '', t: 's', s: style }
}

// Writes one item as a self-contained little block: a title row (item name
// shown ONCE, not repeated per size), a header row of ingredient columns,
// then one row per size (or a single row for a non-sized item) with the
// quantities coloured to match their column header — same idea as the
// on-screen Standard matrix. Returns the next free row and the widest
// column index used, so the caller can size the sheet.
function writeItemBlock(ws, startRow, item, categoryLabel, merges) {
  let r = startRow
  const columns = ingredientColumns(item)
  const hasSizes = item.sizes.length > 0
  const totalCols = Math.max(1 + columns.length, 1)

  const titleText = `${categoryLabel ? categoryLabel + ' — ' : ''}${item.name_en}${item.name_zh ? ' · ' + item.name_zh : ''}`
  setCell(ws, r, 0, titleText, TITLE_STYLE)
  for (let c = 1; c < totalCols; c++) setCell(ws, r, c, '', TITLE_STYLE)
  if (totalCols > 1) merges.push({ s: { r, c: 0 }, e: { r, c: totalCols - 1 } })
  r += 1

  if (item.display_mode === 'custom') {
    setCell(ws, r, 0, '(custom image — see app)', NOTE_STYLE)
    r += 1
  } else if (columns.length) {
    setCell(ws, r, 0, hasSizes ? 'Size' : '', LABEL_STYLE)
    columns.forEach((col, i) => {
      const rule = col.ingredient_master?.ingredient_format_rules
      const label = rule?.abbreviation || col.ingredient_master?.name || '?'
      setCell(ws, r, 1 + i, label, ruleXlsxStyle(rule, { header: true }))
    })
    r += 1

    const sizeRows = hasSizes ? item.sizes : [null]
    for (const size of sizeRows) {
      setCell(ws, r, 0, size ? size.name : '', LABEL_STYLE)
      columns.forEach((col, i) => {
        const colKey = col.ingredient_id ?? col.id
        const cell = cellFor(item, colKey, size?.id)
        const rule = col.ingredient_master?.ingredient_format_rules
        setCell(ws, r, 1 + i, cell?.quantity_text || '', ruleXlsxStyle(rule, { header: false }))
      })
      r += 1
    }
  }

  if (item.notes) {
    setCell(ws, r, 0, item.notes, NOTE_STYLE)
    r += 1
  }

  return { nextRow: r + 1, maxCol: totalCols - 1 } // +1 blank spacer row before the next item
}

// Real, directly-downloaded .xlsx — one sheet per selected section, with
// each item rendered as its own small coloured ingredient/size table (see
// writeItemBlock) rather than one flat row of comma-separated text, so
// quantities line up under their ingredient and match the same colours
// shown on screen.
export function exportMenuAsExcel({ sections, shopTraining }) {
  const wb = XLSX.utils.book_new()
  const margins = { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, header: 0, footer: 0 }

  for (const section of sections) {
    const ws = {}
    const merges = []
    let row = 0
    let maxCol = 0
    for (const cat of section.categories) {
      for (const item of cat.items) {
        const result = writeItemBlock(ws, row, item, cat.name, merges)
        row = result.nextRow
        maxCol = Math.max(maxCol, result.maxCol)
      }
    }
    if (row === 0) {
      setCell(ws, 0, 0, 'No items.', {})
      row = 1
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row - 1, c: maxCol } })
    ws['!merges'] = merges
    ws['!margins'] = margins
    ws['!cols'] = [{ wch: 32 }, ...Array(maxCol).fill({ wch: 10 })]
    XLSX.utils.book_append_sheet(wb, ws, section.label.slice(0, 31))
  }

  if (shopTraining) {
    const rows = [['Title', 'Content'], ...shopTraining.map((t) => [t.title, stripHtmlPlain(t.content_html)])]
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = [{ wch: 30 }, { wch: 80 }]
    sheet['!margins'] = margins
    XLSX.utils.book_append_sheet(wb, sheet, 'Shop Training')
  }

  XLSX.writeFile(wb, `orange-tea-menu-export-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
