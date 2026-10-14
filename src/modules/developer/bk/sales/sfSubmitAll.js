// Unified Sales-figure submit: one 提交 submits EVERY store's month. The store
// on screen is saved from what is on screen; the other stores are read from
// what is saved (their typing was kept as a draft when you left them) and run
// through the same checks and the same Total maths as SfSheet.
import {
  buildColumns,
  computeSfDay,
  countSfDataDays,
  dMapFromRows,
  inactiveIdsWithData,
  monthDates,
  numToInput,
  sfDaysFromRows,
} from '../bkUtils'
import { loadCashDays, loadPaymentTypes, loadSfMonth, saveSfMonth } from '../bkData'
import { loadSalesMonth } from '../bkSalesData'
import { selfOMapFromRows } from '../bkSalesUtils'

const emptyDay = () => ({ o_ca: '', o_post: '', total: '', amounts: {} })

// One store's saved month plus its calculated rows.
//   salesStores: the 營業 store list (a store linked there falls back to its Self O for the kiosk).
export async function loadStoreMonthForSubmit(store, salesStores, year, month) {
  const bizStoreId = salesStores?.find((s) => s.sf_store_id === store.id)?.id ?? null
  const [types, sf, cash, biz] = await Promise.all([
    loadPaymentTypes(store.id),
    loadSfMonth(store.id, year, month),
    loadCashDays(store.id, year, month),
    bizStoreId ? loadSalesMonth(bizStoreId, year, month) : Promise.resolve([]),
  ])
  const days = sfDaysFromRows(sf.days)
  const columns = buildColumns(types, inactiveIdsWithData(types, days))
  const dMap = dMapFromRows(cash)
  const selfOMap = selfOMapFromRows(biz)
  const dates = monthDates(year, month)
  const rows = dates.map((date) =>
    computeSfDay(columns, days[date] ?? emptyDay(), dMap[date] ?? null, bizStoreId ? (selfOMap[date] ?? null) : undefined)
  )
  return { store, sfMonth: sf.sfMonth, days, columns, dates, rows, dataDays: countSfDataDays(days) }
}

// Mark a loaded store month as submitted (Total re-calculated like SfSheet does).
export async function submitStoreMonth(m, year, month) {
  const daysToSave = Object.fromEntries(
    m.dates.map((date, i) => [date, { ...(m.days[date] ?? emptyDay()), total: numToInput(m.rows[i].total) }])
  )
  return saveSfMonth({ storeId: m.store.id, year, month, existing: m.sfMonth, days: daysToSave, submit: true })
}
