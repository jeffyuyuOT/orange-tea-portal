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
  const { data } = await supabase.from('app_sidebar_order').select('*').eq('id', true).maybeSingle()
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
