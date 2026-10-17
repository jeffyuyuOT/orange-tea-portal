// Brisbane / Queensland public holidays 2017–2026, copied from the Queensland
// Government's yearly "Queensland public holiday dates" pages
// (https://www.qld.gov.au/recreation/travel/holidays/public). Used by the 營業
// pages (🎉 on the date, Event list in 歷史紀錄) for years before the payroll
// app's own list starts. A date the payroll app also lists keeps the payroll
// name (see loadPublicHolidays in bkSalesData.js).
//
// Names match the payroll list's wording so the same holiday lines up across
// years in 歷史紀錄 › 營業 › Event. Part-day Christmas Eve (6pm–midnight) is
// included from 2019; substitute / additional days carry their own names.
const EKKA = 'Royal Queensland Show (Ekka) - Brisbane'
const NY = "New Year's Day"
const AU = 'Australia Day'
const GF = 'Good Friday'
const DGF = 'Day after Good Friday'
const ES = 'Easter Sunday'
const EM = 'Easter Monday'
const ANZ = 'Anzac Day'
const LAB = 'Labour Day'
const QB = "King's Birthday" // "Queen's Birthday" until 2022 — one name so the years line up
const CE = 'Christmas Eve (6pm–midnight)'
const CD = 'Christmas Day'
const BD = 'Boxing Day'

const RAW = {
  2017: [['01-01', NY], ['01-02', `${NY} (additional day)`], ['01-26', AU], ['04-14', GF], ['04-15', DGF], ['04-16', ES], ['04-17', EM], ['04-25', ANZ], ['05-01', LAB], ['08-16', EKKA], ['10-02', QB], ['12-25', CD], ['12-26', BD]],
  2018: [['01-01', NY], ['01-26', AU], ['03-30', GF], ['03-31', DGF], ['04-01', ES], ['04-02', EM], ['04-25', ANZ], ['05-07', LAB], ['08-15', EKKA], ['10-01', QB], ['12-25', CD], ['12-26', BD]],
  2019: [['01-01', NY], ['01-28', AU], ['04-19', GF], ['04-20', DGF], ['04-21', ES], ['04-22', EM], ['04-25', ANZ], ['05-06', LAB], ['08-14', EKKA], ['10-07', QB], ['12-24', CE], ['12-25', CD], ['12-26', BD]],
  2020: [['01-01', NY], ['01-27', AU], ['04-10', GF], ['04-11', DGF], ['04-12', ES], ['04-13', EM], ['04-25', ANZ], ['05-04', LAB], ['08-14', EKKA], ['10-05', QB], ['12-24', CE], ['12-25', CD], ['12-26', BD], ['12-28', `${BD} (substitute)`]],
  2021: [['01-01', NY], ['01-26', AU], ['04-02', GF], ['04-03', DGF], ['04-04', ES], ['04-05', EM], ['04-26', `${ANZ} (substitute)`], ['05-03', LAB], ['10-04', QB], ['10-29', "People's long weekend"], ['12-24', CE], ['12-25', CD], ['12-26', BD], ['12-27', `${CD} (substitute)`], ['12-28', `${BD} (substitute)`]],
  2022: [['01-01', NY], ['01-03', `${NY} (additional day)`], ['01-26', AU], ['04-15', GF], ['04-16', DGF], ['04-17', ES], ['04-18', EM], ['04-25', ANZ], ['05-02', LAB], ['08-10', EKKA], ['09-22', 'National Day of Mourning for Her Majesty The Queen'], ['10-03', QB], ['12-24', CE], ['12-25', CD], ['12-26', BD], ['12-27', `${CD} (additional day)`]],
  2023: [['01-01', NY], ['01-02', `${NY} (substitute)`], ['01-26', AU], ['04-07', GF], ['04-08', DGF], ['04-09', ES], ['04-10', EM], ['04-25', ANZ], ['05-01', LAB], ['08-16', EKKA], ['10-02', QB], ['12-24', CE], ['12-25', CD], ['12-26', BD]],
  2024: [['01-01', NY], ['01-26', AU], ['03-29', GF], ['03-30', DGF], ['03-31', ES], ['04-01', EM], ['04-25', ANZ], ['05-06', LAB], ['08-14', EKKA], ['10-07', QB], ['12-24', CE], ['12-25', CD], ['12-26', BD]],
  2025: [['01-01', NY], ['01-27', AU], ['04-18', GF], ['04-19', DGF], ['04-20', ES], ['04-21', EM], ['04-25', ANZ], ['05-05', LAB], ['08-13', EKKA], ['10-06', QB], ['12-24', CE], ['12-25', CD], ['12-26', BD]],
  2026: [['01-01', NY], ['01-26', AU], ['04-03', GF], ['04-04', DGF], ['04-05', ES], ['04-06', EM], ['04-25', ANZ], ['05-04', LAB], ['08-12', EKKA], ['10-05', QB], ['12-24', CE], ['12-25', CD], ['12-26', BD], ['12-28', `${BD} (substitute)`]],
}

// { 'YYYY-MM-DD': name }
export const STATIC_PUBLIC_HOLIDAYS = Object.fromEntries(
  Object.entries(RAW).flatMap(([year, list]) => list.map(([md, name]) => [`${year}-${md}`, name]))
)
