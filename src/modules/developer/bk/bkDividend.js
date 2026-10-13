// Pure maths for the 分紅 tab (no React, no Supabase), so the numbers can be
// tested on their own.
//
// Vocabulary
//   income   入金: U帳 入金 (Jeff B / Mao保 / 其他) + 入金 typed on the 分紅 tab (其他)
//   cost     cost typed on the 分紅 tab
//   payout   分紅 paid to a party (bank / cash)
//   vault    income − cost − payouts, counted from the last 分紅完全結算 of the store
//
// A payout ticked 分紅結算 is a 分紅完全結算 when the vault is exactly zero right
// after it. Everything before the last 完全結算 is left out of the vault (and of
// the 金庫概況 party figures); the 分紅記錄 tab counts everything since the start.
import { round2, toNum } from './bkUtils'

const EPS = 0.005

export const BUCKETS = [
  ['jeff_bank', 'Jeff B'],
  ['mao_safe', 'Mao保'],
  ['other', '其他'],
]
export const BUCKET_LABELS = Object.fromEntries(BUCKETS)
export const METHOD_LABELS = { bank: 'Bank', cash: 'Cash' }

const sortKey = (a, b) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.created < b.created ? -1 : a.created > b.created ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0

// Rows from the database -> one flat, time-ordered list of events.
//   ruju    bk_cash_entries rows of kind 'ruju'   (U帳 入金)
//   manual  bk_dividend_entries rows
//   payouts bk_payouts rows
export function buildEvents({ ruju = [], manual = [], payouts = [] }) {
  const events = []
  for (const e of ruju) {
    events.push({
      key: `u-${e.id}`,
      source: 'ucash',
      id: e.id,
      store: e.store_id,
      date: e.entry_date,
      created: e.created_at ?? '',
      type: 'income',
      bucket: e.ruju_target ?? 'other',
      amount: toNum(e.amount) ?? 0,
      note: e.note ?? null,
    })
  }
  for (const e of manual) {
    const cost = e.kind === 'cost'
    events.push({
      key: `m-${e.id}`,
      source: 'manual',
      id: e.id,
      store: e.store_id,
      date: e.entry_date,
      created: e.created_at ?? '',
      type: cost ? 'cost' : 'income',
      bucket: cost ? 'cost' : 'other',
      amount: toNum(e.amount) ?? 0,
      note: e.note ?? null,
    })
  }
  for (const p of payouts) {
    events.push({
      key: `p-${p.id}`,
      source: 'payout',
      id: p.id,
      store: p.store_id,
      date: p.entry_date,
      created: p.created_at ?? '',
      type: 'payout',
      partyId: p.party_id,
      method: p.method,
      settle: !!p.is_settlement,
      amount: toNum(p.amount) ?? 0,
      note: p.note ?? null,
    })
  }
  return events.sort(sortKey)
}

const signed = (ev) => (ev.type === 'income' ? ev.amount : -ev.amount)

// Totals of a list of events (one store's window, or everything).
export function summarize(events) {
  const incomeBy = { jeff_bank: 0, mao_safe: 0, other: 0 }
  let cost = 0
  let paid = 0
  let bankPaid = 0
  let cashPaid = 0
  const paidByParty = {}
  for (const ev of events) {
    if (ev.type === 'income') incomeBy[ev.bucket] = round2((incomeBy[ev.bucket] ?? 0) + ev.amount)
    else if (ev.type === 'cost') cost = round2(cost + ev.amount)
    else {
      paid = round2(paid + ev.amount)
      if (ev.method === 'cash') cashPaid = round2(cashPaid + ev.amount)
      else bankPaid = round2(bankPaid + ev.amount)
      paidByParty[ev.partyId] = round2((paidByParty[ev.partyId] ?? 0) + ev.amount)
    }
  }
  const income = round2(incomeBy.jeff_bank + incomeBy.mao_safe + incomeBy.other)
  // What is left in each vault pot: a bank payout comes out of Jeff B, a cash
  // payout out of Mao保. 其他 is untouched; cost is not taken from any pot.
  const assets = {
    jeff_bank: round2(incomeBy.jeff_bank - bankPaid),
    mao_safe: round2(incomeBy.mao_safe - cashPaid),
    other: incomeBy.other,
  }
  return { incomeBy, assets, income, cost, paid, bankPaid, cashPaid, paidByParty, pool: round2(income - cost), vault: round2(income - cost - paid) }
}

// One store's events (time-ordered) -> where the current window starts.
//   fullKeys     keys of the payouts that were a 分紅完全結算
//   windowEvents events after the last 完全結算 (all of them when there is none)
export function computeLedger(events) {
  let running = 0
  let windowStart = 0
  const fullKeys = new Set()
  events.forEach((ev, i) => {
    running = round2(running + signed(ev))
    if (ev.type === 'payout' && ev.settle && Math.abs(running) < EPS) {
      fullKeys.add(ev.key)
      windowStart = i + 1
      running = 0
    }
  })
  const lastFull = [...events].reverse().find((ev) => fullKeys.has(ev.key)) ?? null
  return { events, fullKeys, windowEvents: events.slice(windowStart), lastFullDate: lastFull?.date ?? null }
}

// 加權 -> a party's figures from a pool.
//   total     = pool × weight%
//   paid      what was paid out to the party
//   claimable = total − paid          (cost is only taken off once, in the pool)
export function partyRows(parties, pool, paidByParty) {
  return parties.map((p) => {
    const total = round2((pool * Number(p.weight)) / 100)
    const paid = round2(paidByParty[p.id] ?? 0)
    return { party: p, total, paid, claimable: round2(total - paid) }
  })
}

// Everything the 分紅 tab shows for ONE store.
export function storeReport(storeId, raw, parties) {
  const mine = (rows) => rows.filter((r) => r.store_id === storeId)
  const events = buildEvents({ ruju: mine(raw.ruju), manual: mine(raw.manual), payouts: mine(raw.payouts) })
  const ledger = computeLedger(events)
  const all = summarize(events)
  const win = summarize(ledger.windowEvents)
  return {
    storeId,
    parties,
    events,
    fullKeys: ledger.fullKeys,
    windowEvents: ledger.windowEvents,
    lastFullDate: ledger.lastFullDate,
    window: win,
    allTime: all,
    windowParties: partyRows(parties, win.pool, win.paidByParty),
    allTimeParties: partyRows(parties, all.pool, all.paidByParty),
  }
}

const nameKey = (name) => String(name).trim().toLowerCase()

// Same-name parties of different stores are one block ("全部分店").
export function mergePartyRows(rowLists) {
  const map = new Map()
  for (const rows of rowLists) {
    for (const r of rows) {
      const key = nameKey(r.party.name)
      const cur = map.get(key) ?? { key, name: r.party.name, partyIds: [], stores: [], total: 0, paid: 0, claimable: 0 }
      cur.partyIds.push(r.party.id)
      cur.stores.push(r.party.store_id)
      cur.total = round2(cur.total + r.total)
      cur.paid = round2(cur.paid + r.paid)
      cur.claimable = round2(cur.claimable + r.claimable)
      map.set(key, cur)
    }
  }
  return [...map.values()]
}

// Reports of the stores in view -> one combined picture.
export function combineReports(reports) {
  const windowEvents = reports.flatMap((r) => r.windowEvents).sort(sortKey)
  const events = reports.flatMap((r) => r.events).sort(sortKey)
  const fullKeys = new Set(reports.flatMap((r) => [...r.fullKeys]))
  const sumOf = (pick) => round2(reports.reduce((a, r) => a + pick(r), 0))
  return {
    reports,
    events,
    windowEvents,
    fullKeys,
    window: {
      incomeBy: {
        jeff_bank: sumOf((r) => r.window.incomeBy.jeff_bank),
        mao_safe: sumOf((r) => r.window.incomeBy.mao_safe),
        other: sumOf((r) => r.window.incomeBy.other),
      },
      assets: {
        jeff_bank: sumOf((r) => r.window.assets.jeff_bank),
        mao_safe: sumOf((r) => r.window.assets.mao_safe),
        other: sumOf((r) => r.window.assets.other),
      },
      income: sumOf((r) => r.window.income),
      cost: sumOf((r) => r.window.cost),
      paid: sumOf((r) => r.window.paid),
      vault: sumOf((r) => r.window.vault),
    },
    windowParties: mergePartyRows(reports.map((r) => r.windowParties)),
    allTimeParties: mergePartyRows(reports.map((r) => r.allTimeParties)),
  }
}

// 分紅結算 label of a payout: 分紅完全結算 / 分紅結算 / ''.
export function payoutLabel(ev, fullKeys) {
  if (fullKeys.has(ev.key)) return '分紅完全結算'
  return ev.settle ? '分紅結算' : ''
}

// 設定: the weights of one store's parties must add up to 100%.
//   draft = [{ name, weight (string or number) }]   (no parties at all is fine)
// Returns an error message or ''.
export function partySettingsProblem(draft) {
  if (draft.length === 0) return ''
  const seen = new Set()
  for (const p of draft) {
    const name = String(p.name ?? '').trim()
    if (!name) return '每個 party 都需要名稱。'
    if (seen.has(nameKey(name))) return `party 名稱重複：${name}`
    seen.add(nameKey(name))
    const w = toNum(p.weight)
    if (w === null || w < 0 || w > 100) return `「${name}」的加權數要在 0 到 100 之間。`
  }
  const total = draft.reduce((a, p) => a + toNum(p.weight), 0)
  if (Math.abs(total - 100) > 0.0005) return `所有 party 的加權數加起來是 ${round2(total)}%，必須剛好是 100%。`
  return ''
}

// Which vault pot is a party's own (matched on the party name).
const OWN_ASSET = { jeff: 'jeff_bank', mao: 'mao_safe' }
const OTHER_SOURCES = { jeff: 'Mao保 和 其他', mao: 'Jeff B 和 其他' }

// 分紅結算 (a reference calculation, it changes no vault or 分紅 figure):
// per party, 可領取分紅 − 擁有金庫資產. Positive = still has to be taken from
// other pots (note says which); only Jeff and Mao have a note, other parties
// (e.g. C&J) have no own pot and no note.
//   partyRows  merged rows (mergePartyRows) with { key, name, claimable }
//   assets     the vault pots { jeff_bank, mao_safe, other }
export function settlementRows(partyRows, assets) {
  return partyRows.map((p) => {
    const potKey = OWN_ASSET[p.key]
    const hasPot = !!potKey
    const asset = hasPot ? assets[potKey] : 0
    const result = round2(p.claimable - asset)
    return {
      key: p.key,
      name: p.name,
      claimable: p.claimable,
      assetLabel: hasPot ? BUCKET_LABELS[potKey] : '',
      asset: hasPot ? asset : null,
      result,
      from: hasPot && result > EPS ? OTHER_SOURCES[p.key] : '',
    }
  })
}
