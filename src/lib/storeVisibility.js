// Shared helper: an item (formula_items or quiz_questions) with NO rows in
// its "*_stores" join table is visible to every store (this matches the
// Admin UI default of "all stores checked"). An item WITH rows is only
// visible to the stores listed.
export function filterVisibleForStore(items, restrictionRows, idField, currentStoreId) {
  if (!currentStoreId) return items
  const restrictedIds = new Set(restrictionRows.map((r) => r[idField]))
  const allowedPairs = new Set(restrictionRows.map((r) => `${r[idField]}:${r.store_id}`))
  return items.filter((item) => {
    if (!restrictedIds.has(item.id)) return true
    return allowedPairs.has(`${item.id}:${currentStoreId}`)
  })
}

// A different concept from filterVisibleForStore above (that's which STORE
// an ITEM is visible to; this is whether a PERSON counts as an active
// participant — selectable/schedulable — at one of the store(s) they
// belong to). Jeff, 2026-09: User Management's "Join store activity"
// checkbox (profiles.join_store_activity, migration 0064) — someone's
// primary/home store always counts as active regardless of the flag; it
// only gates their ADDITIONAL ("also belong to") stores. Unchecked there,
// they can still switch into and view that store's data (current_store_ids()
// is untouched), they just won't appear in that store's staff lists (Manage
// Roster, Roster Staff Order, Learning Tracker, Staff Information, Staff
// Time Logs) or be able to post their own Bulletin messages there (see
// migration 0064's active_store_ids(), used by the staff-post RLS policy).
// `profile` needs `primary_store_id` and `join_store_activity` selected.
export function isActiveStoreMember(profile, storeId) {
  if (!profile) return false
  if (profile.primary_store_id === storeId) return true
  return profile.join_store_activity !== false
}
