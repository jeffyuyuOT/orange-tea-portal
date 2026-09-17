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
