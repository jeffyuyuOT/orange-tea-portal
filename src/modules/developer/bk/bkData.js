// Supabase access for the BK page. Every table here is RLS-locked to
// is_developer() (migration 0101), so these calls only ever return data for a
// developer account. Functions throw an Error on failure; screens catch and
// show the message.
import { supabase } from '../../../lib/supabaseClient'
import { monthStart, nextMonthStart, toNum, isEmptySfDay, isEmptyCashDay, sfDayHasData } from './bkUtils'

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

// `orderedIds` is the new order of ALL stores; sort_order is rewritten 0..n-1.
// The SF and U帳 store tabs (and 資料維護) follow this order.
export async function saveStoreOrder(orderedIds) {
  const now = new Date().toISOString()
  const results = await Promise.all(
    orderedIds.map((id, i) => supabase.from('bk_stores').update({ sort_order: i, updated_at: now }).eq('id', id))
  )
  for (const r of results) if (r.error) throw new Error(r.error.message)
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
  const [sfMonths, cashDays, entries, parties, dividendEntries, payouts] = await Promise.all([
    count('bk_sf_months'),
    count('bk_cash_days'),
    count('bk_cash_entries'),
    count('bk_parties'),
    count('bk_dividend_entries'),
    count('bk_payouts'),
  ])
  return { sfMonths, cashDays, entries, parties, dividendEntries, payouts }
}

// ON DELETE CASCADE removes the store's payment types, Sales-figure months and
// days, U帳 days, 收支 entries and opening balance with it.
export async function deleteStore(id) {
  unwrap(await supabase.from('bk_stores').delete().eq('id', id))
}

// A store with no Sales-figure columns yet gets the defaults (Cash, Total
// Eftpos, Uber Eat, Doordash, Fantuan, Payo, Panda, Pos total + two Eftpos subs).
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
    is_locked: !!form.is_locked,
    can_copy: !!form.can_copy,
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

// Deleting a main also deletes its subs (ON DELETE CASCADE). Numbers already
// typed into SF days stay in bk_sf_days.amounts but no column shows them any more.
// A locked type must be unlocked first — checked here as well as in the UI.
export async function deletePaymentType(id) {
  const row = unwrap(await supabase.from('bk_payment_types').select('is_locked').eq('id', id).single())
  if (row.is_locked) throw new Error('這個 payment type 已鎖定，請先取消鎖定才能刪除。')
  unwrap(await supabase.from('bk_payment_types').delete().eq('id', id))
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
    ? unwrap(await supabase.from('bk_sf_days').select('day, o_ca, o_post, total, amounts').eq('sf_month_id', sfMonth.id)) ?? []
    : []
  return { sfMonth, days }
}

// For the submit check: how many days of the month hold data, per store
// ({ [storeId]: n }). Stores with no saved data are simply absent (= 0).
export async function loadSfDataDayCounts(year, month) {
  const rows =
    unwrap(
      await supabase
        .from('bk_sf_days')
        .select('day, o_ca, o_post, amounts, bk_sf_months!inner(store_id, year, month)')
        .eq('bk_sf_months.year', year)
        .eq('bk_sf_months.month', month)
    ) ?? []
  const counts = {}
  for (const r of rows) {
    if (!sfDayHasData({ o_ca: r.o_ca, o_post: r.o_post, amounts: r.amounts })) continue
    const id = r.bk_sf_months.store_id
    counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
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

// `days` is { [date]: { o_ca, o_post, total, amounts } } with form values (strings);
// `total` is the COMPUTED Total (Pos total + Self order kiosk), filled in by the sheet.
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
    upserts.push({
      sf_month_id: sfMonth.id,
      day: date,
      o_ca: toNum(day.o_ca),
      o_post: toNum(day.o_post),
      total: toNum(day.total),
      amounts,
    })
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

// A plain entry just deletes its own row. A 分店transfer leg (transfer_group_id
// set) deletes BOTH legs — and their bk_store_debts rows with them — via the
// server function, so a transfer is never left half there.
export async function deleteEntry(entry) {
  const id = entry?.id ?? entry
  if (entry?.transfer_group_id) {
    unwrap(await supabase.rpc('bk_delete_store_transfer', { p_entry_id: id }))
  } else {
    unwrap(await supabase.from('bk_cash_entries').delete().eq('id', id))
  }
}

// 分店transfer: moves Ucost money from one BK store to another in one go —
// FROM leg positive (UCOH ↓), TO leg negative (UCOH ↑), both kind 'ucost'.
// mode 'loan_repay' also writes the FROM store's 借貸 / TO store's 償還 row to
// 積欠 > 分店之間. See migration 0109 for the actual inserts (done server-side
// so the transfer can't end up half-written).
export async function saveStoreTransfer({ fromStoreId, toStoreId, mode, date, amount, note }) {
  unwrap(
    await supabase.rpc('bk_create_store_transfer', {
      p_from_store: fromStoreId,
      p_to_store: toStoreId,
      p_mode: mode,
      p_date: date,
      p_amount: toNum(amount),
      p_note: note?.trim() || null,
    })
  )
}

// 積欠 > 分店之間: every store's own running 借貸/償還 totals (each store's own
// side only — never netted against its peer). storeId null = all stores.
export async function loadStoreDebts(storeId) {
  let q = supabase.from('bk_store_debts').select('*')
  if (storeId) q = q.eq('store_id', storeId)
  return unwrap(await q.order('entry_date', { ascending: false }).order('created_at', { ascending: false })) ?? []
}

export async function deleteStoreDebt(id) {
  unwrap(await supabase.from('bk_store_debts').delete().eq('id', id))
}

// ---------------------------------------------------------------------------
// 積欠 > Jeff — 薪水 / 預付 / 預拿
// ---------------------------------------------------------------------------

// Jeff, 2026-10-21 (point 2): now per-store (migration 0130_bk_owed_jeff_per_store.sql
// — store_id, every existing row backfilled to Sunnybank since that's what
// they all were already in practice). `storeId` is required: every caller
// already has one selected via StoreTabs, same as every other per-store BK
// tab.
export async function loadJeffOwedEntries(storeId) {
  return (
    unwrap(
      await supabase
        .from('bk_owed_jeff_entries')
        .select('*')
        .eq('store_id', storeId)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
    ) ?? []
  )
}

// Jeff, 2026-10-21 (point 2 follow-up): "積欠jeff的匯入template不用註明分店
// 嗎" — the Excel import now accepts any store per row (Store/分店 column,
// bkImport.js's parseJeffOwedRows), not just Sunnybank, so its dedupe check
// needs every store's existing rows to compare against — unlike
// loadJeffOwedEntries(storeId) above, which the UI tab uses and is
// deliberately scoped to one store at a time.
export async function loadAllJeffOwedEntries() {
  return unwrap(await supabase.from('bk_owed_jeff_entries').select('*')) ?? []
}

export async function saveJeffOwedEntry(form) {
  const payload = {
    kind: form.kind,
    entry_date: form.entry_date,
    description: form.description?.trim() || null,
    amount: toNum(form.amount),
    note: form.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  // store_id is fixed at creation — an existing row's store never changes
  // on edit (same reason `kind`'s <select> is disabled while editing).
  if (form.id) unwrap(await supabase.from('bk_owed_jeff_entries').update(payload).eq('id', form.id))
  else unwrap(await supabase.from('bk_owed_jeff_entries').insert({ ...payload, store_id: form.storeId }))
}

export async function deleteJeffOwedEntry(id) {
  unwrap(await supabase.from('bk_owed_jeff_entries').delete().eq('id', id))
}

// 薪水 is also read LIVE from the payroll app's own completed calc sheets
// (migration 0110's bk_jeff_payroll_salary()) and merged with the manual rows
// above at display time — never copied into bk_owed_jeff_entries, so it can
// never go stale against payroll.
export async function loadJeffPayrollSalary() {
  return unwrap(await supabase.rpc('bk_jeff_payroll_salary')) ?? []
}

// Point 5/系統設置: Excel-import backfill for 積欠 > Jeff. `rows` are already
// deduped by the caller (bkImport.markJeffOwedDuplicates).
// Jeff, 2026-10-21 (point 2): every row needs a store now (migration
// 0130_bk_owed_jeff_per_store.sql).
// Jeff, 2026-10-21 (point 2 follow-up): "積欠jeff的匯入template不用註明分店
// 嗎" — each row now carries its OWN storeId (bkImport.parseJeffOwedRows
// resolves it per row from the file's Store/分店 column, defaulting to
// Sunnybank when that column/cell is blank — same forgiving pattern as
// parseLedgerRows), rather than one storeId shared by the whole file.
export async function bulkImportJeffOwedRows(rows) {
  if (!rows.length) return
  unwrap(
    await supabase.from('bk_owed_jeff_entries').insert(
      rows.map((r) => ({
        kind: r.kind,
        entry_date: r.date,
        description: r.description || null,
        amount: toNum(r.amount),
        note: r.note || null,
        store_id: r.storeId,
      }))
    )
  )
}

// ---------------------------------------------------------------------------
// 積欠 > Emma — Sunnybank 入金 bonus (10%)
// ---------------------------------------------------------------------------

// Every Sunnybank 入金 with a positive amount — a negative 入金 (point 1's
// vault withdrawal) isn't money coming in, so it's not bonus-eligible.
export async function loadEmmaCandidateEntries(sunnybankStoreId) {
  const rows =
    unwrap(
      await supabase
        .from('bk_cash_entries')
        .select('id, entry_date, amount, ruju_target, note')
        .eq('store_id', sunnybankStoreId)
        .eq('kind', 'ruju')
        .order('entry_date', { ascending: false })
    ) ?? []
  return rows.filter((r) => Number(r.amount) > 0)
}

export async function loadEmmaClaims() {
  return (
    unwrap(
      await supabase.from('bk_owed_emma_claims').select('*').order('submitted_at', { ascending: false }).order('created_at', { ascending: false })
    ) ?? []
  )
}

// `rows` = [{ entry_id, entry_date, amount, note }] for the checked 入金 rows;
// `totalAmount` (10% of their sum) is computed by the caller so the UI and
// the stored snapshot always agree on exactly what was submitted.
export async function saveEmmaClaim({ submittedAt, totalAmount, rows }) {
  unwrap(
    await supabase.from('bk_owed_emma_claims').insert({
      submitted_at: submittedAt,
      total_amount: toNum(totalAmount),
      rows,
    })
  )
}

// Point 5/系統設置: Excel-import backfill for 積欠 > Emma. A backfilled claim
// has no specific 入金 rows to point at (it's historical) — there's no `note`
// column on bk_owed_emma_claims itself, so the imported note is kept as a
// single synthetic detail row (entry_id null) rather than dropped; it still
// shows up correctly in 歷史紀錄's detail view. `importRows` are already
// deduped by the caller (bkImport.markEmmaClaimDuplicates).
export async function bulkImportEmmaClaimRows(importRows) {
  if (!importRows.length) return
  unwrap(
    await supabase.from('bk_owed_emma_claims').insert(
      importRows.map((r) => ({
        submitted_at: r.date,
        total_amount: toNum(r.amount),
        rows: [{ entry_id: null, entry_date: r.date, amount: toNum(r.amount), note: r.note || '（匯入的歷史紀錄）' }],
      }))
    )
  )
}

export async function deleteEmmaClaim(id) {
  unwrap(await supabase.from('bk_owed_emma_claims').delete().eq('id', id))
}

// Entries for the 新增編輯收支 list and the 個別資料 history. storeId null = all.
// Point 5: Excel-import backfill for 收支. `rows` are already deduped by the
// caller (bkImport.markLedgerDuplicates) — plain kinds are inserted directly,
// 分店transfer rows go through the same RPC the UI uses so both legs +
// bk_store_debts stay consistent.
export async function bulkImportLedgerRows(rows) {
  const plain = rows.filter((r) => r.kind !== 'transfer')
  const transfers = rows.filter((r) => r.kind === 'transfer')
  if (plain.length) {
    unwrap(
      await supabase.from('bk_cash_entries').insert(
        plain.map((r) => ({
          store_id: r.storeId,
          entry_date: r.date,
          kind: r.kind,
          description: r.description || null,
          amount: toNum(r.amount),
          note: r.note || null,
          ruju_target: r.kind === 'ruju' ? r.rujuTarget : null,
        }))
      )
    )
  }
  for (const r of transfers) {
    await saveStoreTransfer({ fromStoreId: r.fromStoreId, toStoreId: r.toStoreId, mode: r.mode, date: r.date, amount: r.amount, note: r.note })
  }
}

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
