import { supabase } from './supabaseClient'
import { filterVisibleForStore } from './storeVisibility'

// Shared by AuthContext (the Sidebar's red "Update" badge next to Formula)
// and FormulaPage (the actual "Update" tab listing) — see migration 0053.
//
// An item only ever counts as "new or updated" if it was created/edited
// AFTER this feature went live (formula_items.updated_at >= tracked_since —
// tracked_since is set once per row and never changes again, see the
// migration's comments). Existing formulas never retroactively show up as
// new, even for a brand-new staff account that has never opened them.
//
// Among those eligible items, one is "unseen" for a given person when they
// have no formula_item_views row for it at all, or their saved
// seen_updated_at is older than the item's current updated_at (i.e. it
// changed again since they last looked).
export async function getUnseenFormulaItems(profileId, currentStoreId) {
  if (!profileId) return []
  // Jeff, 2026-10-07 (migration 0093): a Hide from Formula item doesn't
  // appear on the Formula page at all, so it shouldn't trigger the Update
  // tab or the Sidebar's red Update badge either, even if it was just
  // edited.
  const { data: itemRows } = await supabase
    .from('formula_items')
    .select('*')
    .eq('is_active', true)
    .eq('hide_from_formula', false)
  const eligible = (itemRows ?? []).filter((i) => i.updated_at >= i.tracked_since)
  if (!eligible.length) return []

  const eligibleIds = eligible.map((i) => i.id)
  const { data: viewRows } = await supabase
    .from('formula_item_views')
    .select('formula_item_id, seen_updated_at')
    .eq('profile_id', profileId)
    .in('formula_item_id', eligibleIds)
  const seenMap = new Map((viewRows ?? []).map((v) => [v.formula_item_id, v.seen_updated_at]))
  const unseen = eligible.filter((i) => !seenMap.has(i.id) || seenMap.get(i.id) < i.updated_at)
  if (!unseen.length) return []

  const unseenIds = unseen.map((i) => i.id)
  const { data: restrictionRows } = await supabase.from('formula_item_stores').select('*').in('formula_item_id', unseenIds)
  return filterVisibleForStore(unseen, restrictionRows ?? [], 'formula_item_id', currentStoreId)
}

// Called once a person actually opens an item's detail — see
// FormulaItemDetail.jsx. Records "I've seen this item as of its CURRENT
// updated_at", so a later edit reliably makes it show as unseen again.
export async function markFormulaItemSeen(profileId, item) {
  if (!profileId || !item?.id) return
  await supabase
    .from('formula_item_views')
    .upsert({ profile_id: profileId, formula_item_id: item.id, seen_updated_at: item.updated_at }, { onConflict: 'profile_id,formula_item_id' })
}
