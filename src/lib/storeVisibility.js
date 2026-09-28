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
// checkbox (profiles.join_store_activity, migration 0064).
//
// ⚠️ Originally (0064/0065) a person's PRIMARY store always counted as
// active regardless of this flag — it only gated their ADDITIONAL ("also
// belong to") stores. Jeff, 2026-09 (same day), gave a concrete
// counter-example (Janet: her primary Store needs to stay Underwood — she
// needs it as her actual home store, not just an "also belong to" one —
// but she should still NOT be schedulable/leave-eligible there): "她主要
// 的所屬店還是要選underwood，但join store activity就不會勾選，所以她也不
// 會在排班相關選項出現". So as of migration 0067_store_activity_applies_to_primary_too.sql,
// the flag applies uniformly to EVERY store a person belongs to — primary
// included — not just the "also belong to" ones. Default stays TRUE, so
// this is a no-op for anyone who's never touched the checkbox.
//
// Unchecked at a store (primary or "also belong to"): they can still
// switch into and view that store's data (current_store_ids() is
// untouched), they just won't appear in that store's staff lists (Manage
// Roster, Roster Staff Order, Learning Tracker, Staff Information, Staff
// Time Logs) or be able to apply for leave there (see active_store_ids(),
// used by the leave_requests insert RLS policy).
// Bulletin Board participation used to be a SEPARATE checkbox
// (join_bulletin_activity, migrations 0065/0066) with its own
// isBulletinActive() here — Jeff, 2026-09, removed it again the same day:
// admin/manager already bypassed it entirely (is_admin()/
// is_manager_or_admin() always won regardless), so it only ever actually
// restricted a 'staff' account, which he decided was rare enough not to
// need its own toggle — "如果要讓staff不能po文的情形也很少，直接inactive
// 就好". See migration 0068_remove_bulletin_activity_checkbox.sql, which
// drops the column/function and reverts announcements' RLS back to plain
// current_store_ids(). Bulletin post/receive is no longer gated by
// anything beyond ordinary store membership + role.
// `profile` needs `join_store_activity` selected (primary_store_id no
// longer changes the answer, but is harmless to still select).
export function isActiveStoreMember(profile, storeId) {
  if (!profile || !storeId) return false
  return profile.join_store_activity !== false
}
