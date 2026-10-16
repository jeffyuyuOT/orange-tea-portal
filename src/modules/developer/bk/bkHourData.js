// Supabase access for BK 小時統計 (migration 0120): bk_hour_settings (hours shown
// per store) and bk_hour_sales (dollars per store / day / hour). RLS-locked to
// is_developer(). Functions throw an Error on failure.
import { supabase } from '../../../lib/supabaseClient'
import { monthStart, nextMonthStart } from './bkUtils'

function unwrap({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

// PostgREST returns at most 1000 rows per request: read in pages.
async function fetchAll(makeQuery) {
  const pageSize = 1000
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const page = unwrap(await makeQuery().range(from, from + pageSize - 1)) ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

const COLUMNS = 'store_id, day, hour, pos_sales, pos_count, self_sales, self_count, combined_sales'

export async function loadHourSettings() {
  return unwrap(await supabase.from('bk_hour_settings').select('store_id, start_hour, end_hour')) ?? []
}

export async function saveHourSetting(storeId, start, end) {
  unwrap(
    await supabase
      .from('bk_hour_settings')
      .upsert({ store_id: storeId, start_hour: start, end_hour: end, updated_at: new Date().toISOString() }, { onConflict: 'store_id' })
  )
}

// Any date range (inclusive) for several stores.
export async function loadHourSalesRange(storeIds, from, to) {
  if (storeIds.length === 0) return []
  return fetchAll(() =>
    supabase
      .from('bk_hour_sales')
      .select(COLUMNS)
      .in('store_id', storeIds)
      .gte('day', from)
      .lte('day', to)
      .order('store_id')
      .order('day')
      .order('hour')
  )
}

export async function loadHourSalesMonth(storeIds, year, month) {
  const next = nextMonthStart(year, month)
  const last = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, 0))
  const to = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`
  return loadHourSalesRange(storeIds, monthStart(year, month), to)
}

const SOURCE_COLUMNS = { pos: ['pos_sales', 'pos_count'], self: ['self_sales', 'self_count'] }

// Write ONE source (POS or self-order) of one store's one day. Only that source's
// columns are touched: hours the file doesn't have are cleared for that source,
// and a row left with nothing in it is removed. `hours` = [{ hour, sales, count }].
export async function saveHourDay(storeId, day, source, hours) {
  const [salesCol, countCol] = SOURCE_COLUMNS[source]
  const now = new Date().toISOString()
  unwrap(
    await supabase
      .from('bk_hour_sales')
      .upsert(
        hours.map((h) => ({ store_id: storeId, day, hour: h.hour, [salesCol]: h.sales, [countCol]: h.count ?? null, updated_at: now })),
        { onConflict: 'store_id,day,hour' }
      )
  )
  const keep = hours.map((h) => h.hour)
  unwrap(
    await supabase
      .from('bk_hour_sales')
      .update({ [salesCol]: null, [countCol]: null, updated_at: now })
      .eq('store_id', storeId)
      .eq('day', day)
      .not('hour', 'in', `(${keep.join(',')})`)
  )
  unwrap(
    await supabase
      .from('bk_hour_sales')
      .delete()
      .eq('store_id', storeId)
      .eq('day', day)
      .is('pos_sales', null)
      .is('pos_count', null)
      .is('self_sales', null)
      .is('self_count', null)
      .is('combined_sales', null)
  )
}

// 系統設置 › 匯入 › 小時統計: already-summed figures for one store. `days` =
// { [date]: { [hour]: dollars } }. For each date in the file the old imported
// figures are replaced (hours the file leaves blank are cleared); POS / self-order
// figures are never touched. Done in chunks of days so a year is a handful of requests.
export async function saveCombinedHours(storeId, days) {
  const dates = Object.keys(days).sort()
  const now = new Date().toISOString()
  for (let i = 0; i < dates.length; i += 100) {
    const chunk = dates.slice(i, i + 100)
    unwrap(
      await supabase
        .from('bk_hour_sales')
        .update({ combined_sales: null, updated_at: now })
        .eq('store_id', storeId)
        .in('day', chunk)
        .not('combined_sales', 'is', null)
    )
    const rows = chunk.flatMap((day) => Object.entries(days[day]).map(([hour, v]) => ({ store_id: storeId, day, hour: Number(hour), combined_sales: v, updated_at: now })))
    for (let j = 0; j < rows.length; j += 1000) {
      unwrap(await supabase.from('bk_hour_sales').upsert(rows.slice(j, j + 1000), { onConflict: 'store_id,day,hour' }))
    }
    unwrap(
      await supabase
        .from('bk_hour_sales')
        .delete()
        .eq('store_id', storeId)
        .in('day', chunk)
        .is('pos_sales', null)
        .is('pos_count', null)
        .is('self_sales', null)
        .is('self_count', null)
        .is('combined_sales', null)
    )
  }
}
