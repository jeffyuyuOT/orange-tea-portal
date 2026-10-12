// Supabase access for the BK page. Every table here is RLS-locked to
// is_developer() (migration 0101), so these calls only ever return data for a
// developer account. Functions throw an Error on failure; screens catch and
// show the message.
import { supabase } from '../../../lib/supabaseClient'
import { monthStart, nextMonthStart, toNum, isEmptySfDay, isEmptyCashDay } from './bkUtils'

function unwrap({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

// ---------------------------------------------------------------------------
// BK's own store list (bk_stores, migration 0102) — NOT the portal's `stores`
// table. Only stores that exist here appear anywhere in the BK page, and
// deleting one removes only that store's BK data.
// ---------------------------------------------------------------------------

export async function loadStores() {
  return (
    unwrap(await supabase.from('bk_stores').select('id, name, sort_order').order('sort_order').order('name')) ?? []
  )
}

export async function addStore(name, existing) {
  const sortOrder = existing.length ? Math.max(...existing.map((s) => s.sort_order ?? 0)) + 1 : 0
  return unwrap(await supabase.from('bk_stores').insert({ name: name.trim(), sort_order: sortOrder }).select().single())
}

export async function renameStore(id, name) {
  unwrap(await supabase.from('bk_stores').update({ name: name.trim(), updated_at: new Date().toISOString() }).eq('id', id))
}

// How much BK data would go with a store — shown in the delete confirmation.
export async function storeDataCounts(id) {
  const count = async (table) => {
    const { count: n, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('store_id', id)
    if (error) throw new Error(error.message)
    return n ?? 0
  }
  const [sfMonths, cashDays, entries] = await Promise.all([count('bk_sf_months'), count('bk_cash_days'), count('bk_cash_entries')])
  return { sfMonths, cashDays, entries }
}

// ON DELETE CASCADE removes the store's payment types, Sales-figure months and
// days, U帳 days, 收支 entries and opening balance with it.
export async function deleteStore(id) {
  unwrap(await supabase.from('bk_stores').delete().eq('id', id))
}

// A store with no Sales-figure columns yet gets the defaults (Cash, Total
// Eftpos, Uber Eat, Doordash, Fantuan, Payo, Panda + two Eftpos subs).
export async function loadPaymentTypes(storeId) {
  const read = async () =>
    unwrap(await supabase.from('bk_payment_types').select('*').eq('store_id', storeId).order('sort_order')) ?? []
  let rows = await read()
  if (rows.length === 0) {
    unwrap(await supabase.rpc('bk_seed_payment_types', { p_store: storeId }))
    rows = await read()
  }
  return rows
}

export async function savePaymentType(storeId, form) {
  const payload = {
    name: form.name.trim(),
    kind: form.kind,
    parent_id: form.kind === 'sub' ? form.parent_id : null,
    updated_at: new Date().toISOString(),
  }
  if (form.id) {
    unwrap(await supabase.from('bk_payment_types').update({ ...payload, is_active: form.is_active }).eq('id', form.id))
  } else {
    unwrap(
      await supabase
        .from('bk_payment_types')
        .insert({ ...payload, store_id: storeId, sort_order: form.sort_order ?? 0, is_active: true })
    )
  }
}

// `orderedIds` is the new left-to-right order of one group (the mains, or the
// subs of one main); sort_order is rewritten 0..n-1 within it.
export async function savePaymentTypeOrder(orderedIds) {
  const now = new Date().toISOString()
  const results = await Promise.all(
    orderedIds.map((id, i) => supabase.from('bk_payment_types').update({ sort_order: i, updated_at: now }).eq('id', id))
  )
  for (const r of results) if (r.error) throw new Error(r.error.message)
}

// ---------------------------------------------------------------------------
// Sales figure
// ---------------------------------------------------------------------------

export async function loadSfMonth(storeId, year, month) {
  const sfMonth = unwrap(
    await supabase.from('bk_sf_months').select('*').eq('store_id', storeId).eq('year', year).eq('month', month).maybeSingle()
  )
  const days = sfMonth
    ? unwrap(await supabase.from('bk_sf_days').select('day, o_ca, total, amounts').eq('sf_month_id', sfMonth.id)) ?? []
    : []
  return { sfMonth, days }
}

// D (未入庫) per day for a month — the Sales-figure sheet needs it for Cash.
export async function loadCashDays(storeId, year, month) {
  return (
    unwrap(
      await supabase
        .from('bk_cash_days')
        .select('day, actual_ca, d_amount, d_stocked')
        .eq('store_id', storeId)
        .gte('day', monthStart(year, month))
        .lt('day', nextMonthStart(year, month))
    ) ?? []
  )
}

// `days` is { [date]: { o_ca, total, amounts } } with form values (strings).
// Empty days are removed so the table doesn't fill up with blank rows.
// `submit` true -> status 'submitted'; false -> back to 'draft' (saving a
// submitted month un-submits it, per the spec).
export async function saveSfMonth({ storeId, year, month, existing, days, submit }) {
  const now = new Date().toISOString()
  const status = submit ? 'submitted' : 'draft'
  const patch = { status, submitted_at: submit ? now : null, updated_at: now }
  let sfMonth = existing
  if (existing) {
    sfMonth = unwrap(await supabase.from('bk_sf_months').update(patch).eq('id', existing.id).select().single())
  } else {
    sfMonth = unwrap(
      await supabase.from('bk_sf_months').insert({ store_id: storeId, year, month, ...patch }).select().single()
    )
  }
  const upserts = []
  const removals = []
  for (const [date, day] of Object.entries(days)) {
    if (isEmptySfDay(day)) {
      removals.push(date)
      continue
    }
    const amounts = {}
    for (const [id, v] of Object.entries(day.amounts ?? {})) {
      const n = toNum(v)
      if (n !== null) amounts[id] = n
    }
    upserts.push({ sf_month_id: sfMonth.id, day: date, o_ca: toNum(day.o_ca), total: toNum(day.total), amounts })
  }
  if (upserts.length) unwrap(await supabase.from('bk_sf_days').upsert(upserts, { onConflict: 'sf_month_id,day' }))
  if (removals.length) unwrap(await supabase.from('bk_sf_days').delete().eq('sf_month_id', sfMonth.id).in('day', removals))
  return sfMonth
}

export async function listSfMonths(storeId) {
  return (
    unwrap(
      await supabase
        .from('bk_sf_months')
        .select('*')
        .eq('store_id', storeId)
        .order('year', { ascending: false })
        .order('month', { ascending: false })
    ) ?? []
  )
}

// ---------------------------------------------------------------------------
// U帳
// ---------------------------------------------------------------------------

const asNumber = (v) => toNum(v) ?? 0

export async function loadOpeningBalance(storeId) {
  return unwrap(await supabase.from('bk_opening_balances').select('*').eq('store_id', storeId).maybeSingle())
}

export async function saveOpeningBalance(storeId, { startMonth, coh, ucoh }) {
  unwrap(
    await supabase.from('bk_opening_balances').upsert(
      {
        store_id: storeId,
        start_month: startMonth,
        coh: asNumber(coh),
        ucoh: asNumber(ucoh),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_id' }
    )
  )
}

// Everything the 分店現金 sheet needs for one store+month.
export async function loadCashMonth(storeId, year, month) {
  const from = monthStart(year, month)
  const to = nextMonthStart(year, month)
  const [bal, sf, cash, entries] = await Promise.all([
    supabase.rpc('bk_month_open_balances', { p_store: storeId, p_month: from }),
    supabase
      .from('bk_sf_days')
      .select('day, o_ca, bk_sf_months!inner(store_id)')
      .eq('bk_sf_months.store_id', storeId)
      .gte('day', from)
      .lt('day', to),
    supabase.from('bk_cash_days').select('day, actual_ca, d_amount, d_stocked').eq('store_id', storeId).gte('day', from).lt('day', to),
    supabase
      .from('bk_cash_entries')
      .select('*')
      .eq('store_id', storeId)
      .gte('entry_date', from)
      .lt('entry_date', to)
      .order('entry_date')
      .order('created_at'),
  ])
  const balRow = unwrap(bal)?.[0] ?? { coh: 0, ucoh: 0 }
  return {
    open: { coh: asNumber(balRow.coh), ucoh: asNumber(balRow.ucoh) },
    sfDays: unwrap(sf) ?? [],
    cashDays: unwrap(cash) ?? [],
    entries: unwrap(entries) ?? [],
  }
}

// `rows` is { [date]: { actual_ca, d_amount, d_stocked } } (form values).
export async function saveCashDays(storeId, rows) {
  const now = new Date().toISOString()
  const upserts = []
  const removals = []
  for (const [date, row] of Object.entries(rows)) {
    if (isEmptyCashDay(row)) {
      removals.push(date)
      continue
    }
    upserts.push({
      store_id: storeId,
      day: date,
      actual_ca: toNum(row.actual_ca),
      d_amount: toNum(row.d_amount),
      d_stocked: !!row.d_stocked,
      updated_at: now,
    })
  }
  if (upserts.length) unwrap(await supabase.from('bk_cash_days').upsert(upserts, { onConflict: 'store_id,day' }))
  if (removals.length) unwrap(await supabase.from('bk_cash_days').delete().eq('store_id', storeId).in('day', removals))
}

export async function saveEntry(storeId, form) {
  const payload = {
    entry_date: form.entry_date,
    kind: form.kind,
    description: form.description?.trim() || null,
    amount: toNum(form.amount),
    note: form.note?.trim() || null,
    ruju_target: form.kind === 'ruju' ? form.ruju_target : null,
    updated_at: new Date().toISOString(),
  }
  if (form.id) unwrap(await supabase.from('bk_cash_entries').update(payload).eq('id', form.id))
  else unwrap(await supabase.from('bk_cash_entries').insert({ ...payload, store_id: storeId }))
}

export async function deleteEntry(id) {
  unwrap(await supabase.from('bk_cash_entries').delete().eq('id', id))
}

// Entries for the 新增編輯收支 list and the 個別資料 history. storeId null = all.
export async function listEntries({ storeId, from, to, kinds }) {
  let q = supabase.from('bk_cash_entries').select('*').gte('entry_date', from).lte('entry_date', to)
  if (storeId) q = q.eq('store_id', storeId)
  if (kinds?.length) q = q.in('kind', kinds)
  return unwrap(await q.order('entry_date', { ascending: false }).order('created_at', { ascending: false })) ?? []
}

// 個別資料: D 欄 / +/− 欄 rows come from the daily table (O.CA joined in for +/−).
export async function listCashDayRows({ storeId, from, to }) {
  let q = supabase.from('bk_cash_days').select('store_id, day, actual_ca, d_amount, d_stocked').gte('day', from).lte('day', to)
  if (storeId) q = q.eq('store_id', storeId)
  const cashDays = unwrap(await q.order('day', { ascending: false })) ?? []
  let sq = supabase.from('bk_sf_days').select('day, o_ca, bk_sf_months!inner(store_id)').gte('day', from).lte('day', to)
  if (storeId) sq = sq.eq('bk_sf_months.store_id', storeId)
  const sfDays = unwrap(await sq) ?? []
  return { cashDays, sfDays }
}

// 歷史紀錄 > 分店現金: every month that has any U帳 data for the store, with its
// D total (all D, as the spec's "D 欄 total").
export async function listCashMonths(storeId) {
  const [days, entries] = await Promise.all([
    supabase.from('bk_cash_days').select('day, d_amount').eq('store_id', storeId),
    supabase.from('bk_cash_entries').select('entry_date').eq('store_id', storeId),
  ])
  const byMonth = new Map()
  const touch = (dateStr) => {
    const key = dateStr.slice(0, 7)
    if (!byMonth.has(key)) byMonth.set(key, { key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)), dTotal: 0 })
    return byMonth.get(key)
  }
  for (const d of unwrap(days) ?? []) touch(d.day).dTotal += toNum(d.d_amount) ?? 0
  for (const e of unwrap(entries) ?? []) touch(e.entry_date)
  return [...byMonth.values()].sort((a, b) => (a.key < b.key ? 1 : -1))
}
