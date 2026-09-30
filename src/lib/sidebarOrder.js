import { supabase } from './supabaseClient'
import { SECTIONS, canAccessPage } from './permissions'

// One shared order for the whole app (not per-role/per-user) — see
// migration 0055. This module is the only place that reconciles the
// admin-edited order against SECTIONS (permissions.js), so a page/section
// added by a later code change that the stored order doesn't know about
// yet still shows up (appended at the end, in SECTIONS' own order) instead
// of silently disappearing from the Sidebar, and a key the stored order
// still remembers but that no longer exists in SECTIONS (e.g. a page that
// got removed) is dropped rather than rendering a blank/broken row.

const DEFAULT_SECTION_ORDER = Object.keys(SECTIONS)
const DEFAULT_PAGE_ORDER = Object.fromEntries(
  Object.entries(SECTIONS).map(([sectionKey, section]) => [sectionKey, Object.keys(section.pages)])
)

// Merges a stored order (possibly stale/incomplete/absent) against the
// current SECTIONS: known keys keep the stored order's sequence, anything
// missing is appended at the end in SECTIONS' own order, anything stale
// (no longer in SECTIONS) is dropped.
function reconcile(storedOrder, defaultOrder) {
  const stored = (storedOrder ?? []).filter((k) => defaultOrder.includes(k))
  const missing = defaultOrder.filter((k) => !stored.includes(k))
  return [...stored, ...missing]
}

export function reconcileSidebarOrder(raw) {
  const sectionOrder = reconcile(raw?.section_order, DEFAULT_SECTION_ORDER)
  const pageOrder = Object.fromEntries(
    Object.entries(SECTIONS).map(([sectionKey, section]) => [
      sectionKey,
      reconcile(raw?.page_order?.[sectionKey], Object.keys(section.pages)),
    ])
  )
  return { sectionOrder, pageOrder }
}

// Safe to use before the real row has loaded (or if it fails to load) —
// just SECTIONS' own literal order, which is exactly what the app rendered
// before this feature existed.
export const DEFAULT_SIDEBAR_ORDER = { sectionOrder: DEFAULT_SECTION_ORDER, pageOrder: DEFAULT_PAGE_ORDER }

export async function fetchSidebarOrder() {
  // Jeff, 2026-10-01: "手機版的左側分頁排序沒有照系統設定" -- this used to
  // ignore `error` entirely, so a Supabase-level failure here (as opposed
  // to a thrown network exception) silently fell through to
  // reconcileSidebarOrder(null), which is indistinguishable from "no
  // custom order has ever been saved" -- producing exactly SECTIONS' own
  // default order with no error, nothing to retry, and nothing to tell
  // AuthContext.jsx's refreshSidebarOrder() anything went wrong. Throwing
  // here instead routes both failure modes (this one, and a genuine thrown
  // network exception) through the same try/catch + retry there.
  const { data, error } = await supabase.from('app_sidebar_order').select('*').eq('id', true).maybeSingle()
  if (error) throw error
  return reconcileSidebarOrder(data)
}

export async function saveSidebarOrder({ sectionOrder, pageOrder }, updatedBy) {
  return supabase
    .from('app_sidebar_order')
    .update({ section_order: sectionOrder, page_order: pageOrder, updated_by: updatedBy ?? null })
    .eq('id', true)
}

// [ [sectionKey, section], ... ] from SECTIONS, in the given order.
export function orderedSectionEntries(order) {
  return (order?.sectionOrder ?? DEFAULT_SECTION_ORDER).map((key) => [key, SECTIONS[key]]).filter(([, section]) => section)
}

// [ [pageKey, label], ... ] for one section, in the given order.
export function orderedPageEntries(sectionKey, order) {
  const section = SECTIONS[sectionKey]
  if (!section) return []
  const pageOrder = order?.pageOrder?.[sectionKey] ?? Object.keys(section.pages)
  return pageOrder.map((key) => [key, section.pages[key]]).filter(([, label]) => label)
}

// Some pages share one Sidebar row even though each still has its own real
// permission key underneath (permissions.js's shop_management.quiz_bank /
// shop_training_database / training_code, grouped visually by
// TrainingCentreLayout.jsx's shared tab bar). Jeff, 2026-09: "shop
// management下只要有training center，不要出現quiz bank跟training code" — one
// row in the Sidebar for the whole group, not three. Keyed by section; each
// entry is a synthetic group (its `key` is NOT a real page/permission key,
// just an id for this row) folding several real page keys into one link.
// `pages` is this group's own fixed canonical order — matches
// TrainingCentreLayout.jsx's TABS — used to pick which member the one link
// lands on and is independent of pageOrder/movePage (see
// logicalPageEntries and SidebarOrderPanel.jsx, which both move/fold the
// group as a single unit rather than the three keys separately).
export const PAGE_GROUPS = {
  shop_management: [
    { key: 'training_centre', label: 'Training Centre', pages: ['quiz_bank', 'shop_training_database', 'training_code'] },
  ],
}

// Like orderedPageEntries, but any pages belonging to a PAGE_GROUPS entry
// for this section fold into one logical row — { type: 'group', key, label,
// pages } — in place of however many individual { type: 'page', key, label }
// rows they'd otherwise be, positioned wherever the first member the stored
// order encounters falls. Sidebar.jsx (desktop + the mobile drawer share one
// component) and SidebarOrderPanel.jsx both render off this instead of
// orderedPageEntries directly, so they can't drift apart on which pages
// fold into which row.
export function logicalPageEntries(sectionKey, order) {
  const groups = PAGE_GROUPS[sectionKey] ?? []
  const memberToGroup = new Map(groups.flatMap((g) => g.pages.map((p) => [p, g])))
  const seen = new Set()
  const result = []
  for (const [pageKey, label] of orderedPageEntries(sectionKey, order)) {
    const group = memberToGroup.get(pageKey)
    if (!group) {
      result.push({ type: 'page', key: pageKey, label })
      continue
    }
    if (seen.has(group.key)) continue // already folded into its row above
    seen.add(group.key)
    result.push({ type: 'group', key: group.key, label: group.label, pages: group.pages })
  }
  return result
}

// The first page (in Sidebar order) this effectivePages set can reach, as
// a route path like "/roster-hub/my-roster" — or null if none at all.
// Shared by RootRedirect (landing on "/", e.g. right after login) and
// RequirePage (landing on ANY page this person doesn't have access to —
// a stale bookmark, a link someone sent them, a page an override used to
// grant that's since been revoked) so both send someone to a page they can
// actually see instead of leaving them stuck on one they can't with no
// obvious next step (Jeff: a first-time user who doesn't happen to click
// a different tab themselves "would think the site is broken").
export function firstAccessiblePagePath(effectivePages, order) {
  for (const [sectionKey] of orderedSectionEntries(order)) {
    for (const [pageKey] of orderedPageEntries(sectionKey, order)) {
      const fullKey = `${sectionKey}.${pageKey}`
      if (canAccessPage(effectivePages, fullKey)) {
        return `/${sectionKey.replace(/_/g, '-')}/${pageKey.replace(/_/g, '-')}`
      }
    }
  }
  return null
}
