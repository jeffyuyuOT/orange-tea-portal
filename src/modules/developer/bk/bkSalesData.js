// Supabase access for the BK 營業 tab (migration 0111): its own store list
// (bk_sales_stores) and the daily takings (bk_sales_days). RLS-locked to
// is_developer() like every bk_* table. Functions throw an Error on failure.
import { supabase } from '../../../lib/supabaseClient'
import { monthStart, nextMonthStart, toNum } from './bkUtils'
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

// `days` is { [date]: { pos, self_o, cv, p_cups, so_cups } } (form strings).
// A linked store's POS comes from SF, so `pos` is left out of the write (any
// value typed earlier, before it was linked, stays as it was). Days with
// nothing typed are removed so the table doesn't fill up with blank rows.
export async function saveSalesDays(storeId, days, { linked }) {
  const now = new Date().toISOString()
  const upserts = []
  const removals = []
  for (const [date, day] of Object.entries(days)) {
    if (isEmptyBizDay(day, linked)) {
      removals.push(date)
      continue
    }
    const row = { store_id: storeId, day: date, updated_at: now }
    for (const { field } of BIZ_INPUTS) {
      if (linked && field === 'pos') continue
      row[field] = toNum(day[field])
    }
    upserts.push(row)
  }
  if (upserts.length) unwrap(await supabase.from('bk_sales_days').upsert(upserts, { onConflict: 'store_id,day' }))
  if (removals.length) {
    if (linked) {
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
