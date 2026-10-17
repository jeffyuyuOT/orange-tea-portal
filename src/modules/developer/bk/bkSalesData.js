// Supabase access for the BK 營業 tab (migration 0111): its own store list
// (bk_sales_stores) and the daily takings (bk_sales_days). RLS-locked to
// is_developer() like every bk_* table. Functions throw an Error on failure.
import { supabase } from '../../../lib/supabaseClient'
import { monthStart, nextMonthStart, toNum } from './bkUtils'
import { STATIC_PUBLIC_HOLIDAYS } from './bkPublicHolidays'
import { BIZ_INPUTS, isEmptyBizDay } from './bkSalesUtils'

function unwrap({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

// PostgREST returns at most 1000 rows per request; ranges of several stores x
// months can pass that, so read in pages.
async function fetchAll(makeQuery) {
  const pageSize = 1000
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const page = unwrap(await makeQuery().range(from, from + pageSize - 1)) ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

// ---------------------------------------------------------------------------
// 營業's own store list
// ---------------------------------------------------------------------------

export async function loadSalesStores() {
  return (
    unwrap(
      await supabase.from('bk_sales_stores').select('id, name, sort_order, sf_store_id').order('sort_order').order('name')
    ) ?? []
  )
}

export async function addSalesStore({ name, sfStoreId }, existing) {
  const sortOrder = existing.length ? Math.max(...existing.map((s) => s.sort_order ?? 0)) + 1 : 0
  unwrap(
    await supabase.from('bk_sales_stores').insert({ name: name.trim(), sort_order: sortOrder, sf_store_id: sfStoreId || null })
  )
}

export async function updateSalesStore(id, { name, sfStoreId }) {
  unwrap(
    await supabase
      .from('bk_sales_stores')
      .update({ name: name.trim(), sf_store_id: sfStoreId || null, updated_at: new Date().toISOString() })
      .eq('id', id)
  )
}

// `orderedIds` is the new order of ALL 營業 stores; sort_order is rewritten 0..n-1.
export async function saveSalesStoreOrder(orderedIds) {
  const now = new Date().toISOString()
  const results = await Promise.all(
    orderedIds.map((id, i) => supabase.from('bk_sales_stores').update({ sort_order: i, updated_at: now }).eq('id', id))
  )
  for (const r of results) if (r.error) throw new Error(r.error.message)
}

export async function salesStoreDayCount(id) {
  const { count, error } = await supabase.from('bk_sales_days').select('*', { count: 'exact', head: true }).eq('store_id', id)
  if (error) throw new Error(error.message)
  return count ?? 0
}

// ON DELETE CASCADE removes the store's days. SF is untouched, but a store
// that was linked stops getting its kiosk figures from 營業 (SF's own stored
// kiosk amounts, which are kept in the database, show again).
export async function deleteSalesStore(id) {
  unwrap(await supabase.from('bk_sales_stores').delete().eq('id', id))
}

// ---------------------------------------------------------------------------
// Daily figures
// ---------------------------------------------------------------------------

const DAY_COLUMNS = 'day, pos, self_o, cv, p_cups, so_cups'

export async function loadSalesMonth(storeId, year, month) {
  return (
    unwrap(
      await supabase
        .from('bk_sales_days')
        .select(DAY_COLUMNS)
        .eq('store_id', storeId)
        .gte('day', monthStart(year, month))
        .lt('day', nextMonthStart(year, month))
    ) ?? []
  )
}

// Several stores over any date range (inclusive) — for the exports.
export async function loadSalesRange(storeIds, from, to) {
  if (storeIds.length === 0) return []
  return fetchAll(() =>
    supabase
      .from('bk_sales_days')
      .select(`store_id, ${DAY_COLUMNS}`)
      .in('store_id', storeIds)
      .gte('day', from)
      .lte('day', to)
      .order('day')
  )
}

// SF's O.POST for a month — what a linked store shows as POS.
export async function loadSfPostMonth(sfStoreId, year, month) {
  return (
    unwrap(
      await supabase
        .from('bk_sf_days')
        .select('day, o_post, bk_sf_months!inner(store_id)')
        .eq('bk_sf_months.store_id', sfStoreId)
        .gte('day', monthStart(year, month))
        .lt('day', nextMonthStart(year, month))
    ) ?? []
  )
}

// SF's O.POST for several SF stores over a range: rows carry the SF store id
// as `sf_store_id`.
export async function loadSfPostRange(sfStoreIds, from, to) {
  if (sfStoreIds.length === 0) return []
  const rows = await fetchAll(() =>
    supabase
      .from('bk_sf_days')
      .select('day, o_post, bk_sf_months!inner(store_id)')
      .in('bk_sf_months.store_id', sfStoreIds)
      .gte('day', from)
      .lte('day', to)
      .order('day')
  )
  return rows.map((r) => ({ day: r.day, o_post: r.o_post, sf_store_id: r.bk_sf_months.store_id }))
}

// Every stored day of the given stores (all years) — 歷史紀錄 › 營業.
export async function loadSalesAll(storeIds) {
  if (storeIds.length === 0) return []
  return fetchAll(() => supabase.from('bk_sales_days').select(`store_id, ${DAY_COLUMNS}`).in('store_id', storeIds).order('store_id').order('day'))
}

// SF's O.POST for several SF stores over all time (rows carry `sf_store_id`).
export async function loadSfPostAll(sfStoreIds) {
  if (sfStoreIds.length === 0) return []
  const rows = await fetchAll(() =>
    supabase
      .from('bk_sf_days')
      .select('day, o_post, bk_sf_months!inner(store_id)')
      .in('bk_sf_months.store_id', sfStoreIds)
      .order('sf_month_id')
      .order('day')
  )
  return rows.map((r) => ({ day: r.day, o_post: r.o_post, sf_store_id: r.bk_sf_months.store_id }))
}

// ---------------------------------------------------------------------------
// Date notes (migration 0119) and public holidays (read from the payroll app)
// ---------------------------------------------------------------------------

export async function loadSalesNotesMonth(storeId, year, month) {
  return (
    unwrap(
      await supabase
        .from('bk_sales_notes')
        .select('store_id, day, note')
        .eq('store_id', storeId)
        .gte('day', monthStart(year, month))
        .lt('day', nextMonthStart(year, month))
    ) ?? []
  )
}

// Notes of several stores for a date range (the 營業 總覽 shows a 📝 on days where any store has one).
export async function loadSalesNotesRange(storeIds, from, to) {
  if (storeIds.length === 0) return []
  return fetchAll(() =>
    supabase
      .from('bk_sales_notes')
      .select('store_id, day, note')
      .in('store_id', storeIds)
      .gte('day', from)
      .lte('day', to)
      .order('store_id')
      .order('day')
  )
}

export async function loadSalesNotesAll(storeIds) {
  if (storeIds.length === 0) return []
  return fetchAll(() => supabase.from('bk_sales_notes').select('store_id, day, note').in('store_id', storeIds).order('store_id').order('day'))
}

// Empty text removes the note.
export async function saveSalesNote(storeId, day, text) {
  const note = (text ?? '').trim()
  if (!note) {
    unwrap(await supabase.from('bk_sales_notes').delete().eq('store_id', storeId).eq('day', day))
    return
  }
  unwrap(await supabase.from('bk_sales_notes').upsert({ store_id: storeId, day, note, updated_at: new Date().toISOString() }, { onConflict: 'store_id,day' }))
}

// The same note on one day for several stores at once (empty text removes them all).
export async function saveSalesNoteForStores(storeIds, day, text) {
  const note = (text ?? '').trim()
  if (storeIds.length === 0) return
  if (!note) {
    unwrap(await supabase.from('bk_sales_notes').delete().in('store_id', storeIds).eq('day', day))
    return
  }
  const now = new Date().toISOString()
  unwrap(
    await supabase
      .from('bk_sales_notes')
      .upsert(storeIds.map((store_id) => ({ store_id, day, note, updated_at: now })), { onConflict: 'store_id,day' })
  )
}

// { [date]: name } — the payroll app keeps a public-holiday list per payroll
// store (payroll_stores.data.publicHolidays = [{ date, name }]); merged here by
// date (different names for one date are joined).
//
// Jeff, 2026-10-17: the payroll list only goes back so far, so the Queensland
// government's dates for 2017–2026 (bkPublicHolidays.js) are the base; any date
// the payroll app also lists takes the payroll name instead.
export async function loadPublicHolidays() {
  const rows = unwrap(await supabase.from('payroll_stores').select('data')) ?? []
  const map = {}
  const fromPayroll = {}
  for (const r of rows) {
    for (const h of r.data?.publicHolidays ?? []) {
      if (!h?.date) continue
      const name = (h.name ?? '').trim() || 'Public holiday'
      const cur = fromPayroll[h.date]
      if (!cur) fromPayroll[h.date] = name
      else if (!cur.split(' / ').includes(name)) fromPayroll[h.date] = `${cur} / ${name}`
    }
  }
  Object.assign(map, STATIC_PUBLIC_HOLIDAYS, fromPayroll)
  return map
}

// `days` is { [date]: { pos, self_o, cv, p_cups, so_cups } } (form strings).
// A linked store's POS comes from SF, so `pos` is left out of the write (any
// value typed earlier, before it was linked, stays as it was). Days with
// nothing typed are removed so the table doesn't fill up with blank rows.
export async function saveSalesDays(storeId, days, { linked, includePos = false }) {
  // includePos: the history import also stores POS for a linked store on days SF has no figure for.
  const skipPos = linked && !includePos
  const now = new Date().toISOString()
  const upserts = []
  const removals = []
  for (const [date, day] of Object.entries(days)) {
    if (isEmptyBizDay(day, skipPos)) {
      removals.push(date)
      continue
    }
    const row = { store_id: storeId, day: date, updated_at: now }
    for (const { field } of BIZ_INPUTS) {
      if (skipPos && field === 'pos') continue
      row[field] = toNum(day[field])
    }
    upserts.push(row)
  }
  if (upserts.length) unwrap(await supabase.from('bk_sales_days').upsert(upserts, { onConflict: 'store_id,day' }))
  if (removals.length) {
    if (skipPos) {
      // Keep a row that still holds a (hidden) manual POS: only blank the fields shown here.
      const blank = { updated_at: now }
      for (const { field } of BIZ_INPUTS) if (field !== 'pos') blank[field] = null
      unwrap(await supabase.from('bk_sales_days').update(blank).eq('store_id', storeId).in('day', removals))
    } else {
      unwrap(await supabase.from('bk_sales_days').delete().eq('store_id', storeId).in('day', removals))
    }
  }
}

// Save only some of a day's fields — the 手動輸入總頁 writes the four fields it
// shows (P杯數, CV, Self O, SO杯數) and a store page writes POS, each leaving
// the other fields of the row alone.
//   days   { [date]: { pos, self_o, cv, p_cups, so_cups } } (form strings) — only the dates to write
//   fields the bk_sales_days columns to write, e.g. ['pos']
// A date whose `fields` are all blank gets those fields cleared; a row left
// with nothing at all in it is removed.
export async function saveSalesFields(storeId, days, fields) {
  const now = new Date().toISOString()
  const upserts = []
  const blanks = []
  for (const [date, day] of Object.entries(days)) {
    if (fields.every((f) => toNum(day?.[f]) === null)) {
      blanks.push(date)
      continue
    }
    const row = { store_id: storeId, day: date, updated_at: now }
    for (const f of fields) row[f] = toNum(day[f])
    upserts.push(row)
  }
  if (upserts.length) unwrap(await supabase.from('bk_sales_days').upsert(upserts, { onConflict: 'store_id,day' }))
  if (blanks.length) {
    const clear = { updated_at: now }
    for (const f of fields) clear[f] = null
    unwrap(await supabase.from('bk_sales_days').update(clear).eq('store_id', storeId).in('day', blanks))
    let q = supabase.from('bk_sales_days').delete().eq('store_id', storeId).in('day', blanks)
    for (const { field } of BIZ_INPUTS) q = q.is(field, null)
    unwrap(await q)
  }
}

// U帳 其他收入 entries (bk_cash_entries, kind other_income) of the given SF / U帳
// stores between two dates — the 營業 pages mark the days that have some.
export async function loadOtherIncomeRange(sfStoreIds, from, to) {
  if (!sfStoreIds || sfStoreIds.length === 0) return []
  return fetchAll(() =>
    supabase
      .from('bk_cash_entries')
      .select('store_id, entry_date, amount, description, note')
      .in('store_id', sfStoreIds)
      .eq('kind', 'other_income')
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date')
      .order('created_at')
  )
}
