// Supabase access for the 分紅 tab (tables from migration 0107; U帳 入金 is read
// straight from bk_cash_entries). Everything is RLS-locked to is_developer().
import { supabase } from '../../../lib/supabaseClient'
import { toNum } from './bkUtils'

function unwrap({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

// PostgREST caps a response (1000 rows by default), so read in pages.
async function fetchAll(build) {
  const PAGE = 1000
  const out = []
  for (let from = 0; ; from += PAGE) {
    const rows = unwrap(await build().range(from, from + PAGE - 1)) ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

// All 分紅 data of every store; the tab filters by store in memory.
export async function loadDividendData() {
  const [ruju, manual, payouts, parties, settlements] = await Promise.all([
    fetchAll(() =>
      supabase.from('bk_cash_entries').select('id, store_id, entry_date, amount, note, ruju_target, created_at').eq('kind', 'ruju').order('id')
    ),
    fetchAll(() => supabase.from('bk_dividend_entries').select('*').order('id')),
    fetchAll(() => supabase.from('bk_payouts').select('*').order('id')),
    fetchAll(() => supabase.from('bk_parties').select('*').order('sort_order').order('name').order('id')),
    fetchAll(() => supabase.from('bk_settlements').select('*').order('id')),
  ])
  return { ruju, manual, payouts, parties, settlements }
}

// 入金 / cost typed on the 分紅 tab.
export async function saveDividendEntry(storeId, form) {
  const payload = {
    entry_date: form.entry_date,
    kind: form.kind,
    amount: toNum(form.amount),
    note: form.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  if (form.id) unwrap(await supabase.from('bk_dividend_entries').update(payload).eq('id', form.id))
  else unwrap(await supabase.from('bk_dividend_entries').insert({ ...payload, store_id: storeId }))
}

export async function deleteDividendEntry(id) {
  unwrap(await supabase.from('bk_dividend_entries').delete().eq('id', id))
}

// A payout (分紅記錄).
export async function savePayout(storeId, form) {
  const payload = {
    party_id: form.party_id,
    entry_date: form.entry_date,
    amount: toNum(form.amount),
    method: form.method,
    is_settlement: !!form.is_settlement,
    note: form.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  if (form.id) unwrap(await supabase.from('bk_payouts').update(payload).eq('id', form.id))
  else unwrap(await supabase.from('bk_payouts').insert({ ...payload, store_id: storeId }))
}

export async function deletePayout(id) {
  unwrap(await supabase.from('bk_payouts').delete().eq('id', id))
}

// Point 5: Excel-import backfill for 分紅. `rows` are already deduped by the
// caller (bkImport.markDividendDuplicates) — income/cost rows go to
// bk_dividend_entries, payout rows to bk_payouts.
export async function bulkImportDividendRows(rows) {
  const entryRows = rows.filter((r) => r.kind !== 'payout')
  const payoutRows = rows.filter((r) => r.kind === 'payout')
  if (entryRows.length) {
    unwrap(
      await supabase.from('bk_dividend_entries').insert(
        entryRows.map((r) => ({ store_id: r.storeId, entry_date: r.date, kind: r.kind, amount: toNum(r.amount), note: r.note || null }))
      )
    )
  }
  if (payoutRows.length) {
    unwrap(
      await supabase.from('bk_payouts').insert(
        payoutRows.map((r) => ({
          store_id: r.storeId,
          party_id: r.partyId,
          entry_date: r.date,
          amount: toNum(r.amount),
          method: r.method,
          is_settlement: false,
          note: r.note || null,
        }))
      )
    )
  }
}

// 設定: save one store's parties. `draft` rows: { id?, name, weight }. Parties
// missing from the draft are deleted — but only if they have no payouts.
export async function savePartiesForStore(storeId, draft, existing) {
  const keep = new Set(draft.filter((d) => d.id).map((d) => d.id))
  const removed = existing.filter((p) => !keep.has(p.id))
  if (removed.length) {
    const used = unwrap(await supabase.from('bk_payouts').select('party_id').in('party_id', removed.map((p) => p.id))) ?? []
    if (used.length) {
      const names = removed.filter((p) => used.some((u) => u.party_id === p.id)).map((p) => p.name)
      throw new Error(`「${names.join('、')}」已有分紅記錄，不能刪除。請先到分紅記錄刪除那些紀錄。`)
    }
    unwrap(await supabase.from('bk_parties').delete().in('id', removed.map((p) => p.id)))
  }
  const now = new Date().toISOString()
  for (let i = 0; i < draft.length; i++) {
    const d = draft[i]
    const payload = { name: d.name.trim(), weight: toNum(d.weight), sort_order: i, updated_at: now }
    if (d.id) unwrap(await supabase.from('bk_parties').update(payload).eq('id', d.id))
  }
  const fresh = draft.filter((d) => !d.id)
  if (fresh.length) {
    unwrap(
      await supabase.from('bk_parties').insert(
        fresh.map((d) => ({
          store_id: storeId,
          name: d.name.trim(),
          weight: toNum(d.weight),
          sort_order: draft.indexOf(d),
        }))
      )
    )
  }
}

// 分紅結算 snapshots (reference only; they change no figures). storeId null = 全部分店.
export async function saveSettlement({ storeId, date, status, rows }) {
  unwrap(await supabase.from('bk_settlements').insert({ store_id: storeId, settle_date: date, status, rows }))
}

export async function submitSettlement(id) {
  unwrap(await supabase.from('bk_settlements').update({ status: 'submitted', updated_at: new Date().toISOString() }).eq('id', id))
}

export async function deleteSettlement(id) {
  unwrap(await supabase.from('bk_settlements').delete().eq('id', id))
}
