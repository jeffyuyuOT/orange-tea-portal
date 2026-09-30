import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { filterVisibleForStore } from '../../../lib/storeVisibility'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Modal from '../../../components/ui/Modal'
import RichTextViewer from '../../../components/ui/RichTextViewer'
import FormulaItemDetail from '../../operations-training/formula/FormulaItemDetail'

// Same top-level formula classification used in Operations & Training >
// Formula (FormulaPage.jsx) — kept in sync with GROUPS there. Jeff, 2026-09:
// "study log裡的tab要新增shop training。因為shop training裡也有內容要
// memorized" — Shop Training joins these as a 5th tab, but it's not a
// formula group at all (shop_training_items, not formula_items — store-
// owned since migration 0052, no drink categories/Top 10) so it's handled
// as its own special case throughout this file rather than folded into the
// group-filtering logic the other four share.
// Jeff, 2026-09-30 (same-day revision to item 7): "study log 多出Must-Know
// Items的分類tab，並放在最前面" — a brand-new top-level tab, placed FIRST,
// that merges must-know DRINKS (formula_items.is_must_know) with must-know
// SHOP TRAINING items (shop_training_items.is_must_know, migration 0082)
// into one combined list — unlike Top 10 (a drink-only, within-Drink-group
// filter), this spans two different tables/types at once, so it's handled
// as its own special case in mustKnowFormulaItems/mustKnowTrainingItems
// below, the same way 'shop_training' already gets its own rendering branch.
const GROUPS = [
  { key: 'must_know', label: '⭐ Must Know Item' },
  { key: 'drink', label: 'Drink' },
  { key: 'tea', label: 'Tea' },
  { key: 'toppings', label: 'Toppings' },
  { key: 'others', label: 'Others' },
  { key: 'shop_training', label: 'Shop Training' },
]

// Same synthetic "Top 10" category as the staff Formula page (FormulaPage.jsx)
// — a drink flagged Top 10 (Admin Center > Formula Database) shows up here
// too, gathered together, without leaving its own category. Because both
// views read/write the same `progress` map keyed by formula_item_id, ticking
// "Memorized" while filtered to Top 10 and then switching the dropdown to
// that drink's own category (or vice versa) already shows the same checked
// state — there's only ever one study_progress row per item, so there's
// nothing extra to keep in sync.
const TOP10_CATEGORY_ID = '__top10__'

// Jeff, 2026-09-30 (same-day revision): "下拉選單也要多出Must-Know Items去
// 選，放在top10下面" — a second synthetic option in the SAME Drink-group
// dropdown as Top 10, right below it. Unlike the new top-level 'must_know'
// GROUPS tab above, this one stays drink-only and within the Drink group,
// same shape as Top 10 — it does NOT pull in Shop Training items.
const MUST_KNOW_CATEGORY_ID = '__must_know__'

// Shared between "My Dashboard > Study Log" (own progress) and
// "Shop Management > Learning Tracker" (a manager/admin viewing + bulk
// editing someone else's progress, per the spec's "admin可支援批量選取").
//
// `qualified`: a Qualified staff member (profiles.qualified — migration
// 0049, granted via a passed Formal Quiz or directly by a manager in
// StaffStudyDetail) had every item that was active *at the moment they
// became Qualified* snapshotted as memorized (StaffStudyDetail's
// markAllCurrentItemsMemorized) — real study_progress rows, not a locked
// overlay (Jeff, 2026-09: the old auto-checked-and-disabled behavior meant
// a Qualified person could never un-memorize something they forgot, or
// manually tick a formula added after they qualified). So `qualified` here
// only affects the badge text below — every checkbox always reflects and
// edits its own real study_progress row, qualified or not.
// `onProgressChange`: fired after a toggle persists, so a parent tracking
// overall memorized % (e.g. the forced-quiz-every-10% check in
// StudyLogPage) can re-evaluate immediately.
// `headerActions`: optional content (e.g. StudyLogPage's Quick Quiz/Formal
// Quiz buttons) rendered at the right end of the group-tabs row, so a
// caller isn't stuck putting its own controls below the whole list.
export default function StudyLogList({ profileId, qualified = false, onProgressChange, headerActions }) {
  const { currentStoreId } = useAuth()
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([]) // drink-group sub-categories, for the filter dropdown
  const [progress, setProgress] = useState({}) // formula_item_id -> row
  // Shop Training's own item list + progress map — separate state since it's
  // a different table/shape (shop_training_items, not formula_items), fetched
  // alongside the formula data below rather than lazily on tab switch, same
  // "load everything once, filter client-side" pattern the four formula
  // groups already use.
  const [shopTrainingItems, setShopTrainingItems] = useState([])
  const [shopTrainingProgress, setShopTrainingProgress] = useState({}) // shop_training_item_id -> row
  const [loading, setLoading] = useState(true)
  const [openItem, setOpenItem] = useState(null)
  const [openTrainingItem, setOpenTrainingItem] = useState(null)
  const [openTrainingItemFiles, setOpenTrainingItemFiles] = useState([])
  const [group, setGroup] = useState('drink')
  const [categoryId, setCategoryId] = useState(null) // null = "All categories" within the drink group

  async function load() {
    setLoading(true)
    const [{ data: itemRows }, { data: progressRows }, { data: categoryRows }, { data: storeRows }, { data: trainingRows }, { data: trainingProgressRows }] =
      await Promise.all([
        supabase
          .from('formula_items')
          .select('*, formula_categories(name)')
          .eq('is_active', true)
          .order('group_key')
          .order('sort_order'),
        supabase.from('study_progress').select('*').eq('profile_id', profileId),
        supabase.from('formula_categories').select('*').eq('group_key', 'drink').order('sort_order').order('id'),
        supabase.from('formula_item_stores').select('*'),
        // Same per-store ownership as ShopTrainingPage.jsx (migration 0052) —
        // just this store's own items, sorted the same way.
        currentStoreId
          ? supabase.from('shop_training_items').select('*').eq('store_id', currentStoreId).order('sort_order')
          : Promise.resolve({ data: [] }),
        supabase.from('shop_training_progress').select('*').eq('profile_id', profileId),
      ])
    // An item this store doesn't carry (per Formula Database's own per-item
    // store list) shouldn't show up in this store's Study Log at all — same
    // rule Quick Quiz/Formal Quiz already use when picking which memorized
    // items to quiz on (see storeVisibility.js / point 37).
    const visibleItems = filterVisibleForStore(itemRows ?? [], storeRows ?? [], 'formula_item_id', currentStoreId)
    setItems(visibleItems)
    setCategories(categoryRows ?? [])
    const map = {}
    ;(progressRows ?? []).forEach((p) => (map[p.formula_item_id] = p))
    setProgress(map)
    setShopTrainingItems(trainingRows ?? [])
    const trainingMap = {}
    ;(trainingProgressRows ?? []).forEach((p) => (trainingMap[p.shop_training_item_id] = p))
    setShopTrainingProgress(trainingMap)
    setLoading(false)
  }

  useEffect(() => {
    if (profileId) load()
  }, [profileId, currentStoreId])

  // Fetched per item as it's opened, same lazy pattern ShopTrainingPage.jsx
  // itself uses — most items are never opened in a given visit.
  useEffect(() => {
    if (!openTrainingItem) {
      setOpenTrainingItemFiles([])
      return
    }
    let active = true
    supabase
      .from('shop_training_item_files')
      .select('*')
      .eq('shop_training_item_id', openTrainingItem.id)
      .order('sort_order')
      .then(({ data }) => {
        if (active) setOpenTrainingItemFiles(data ?? [])
      })
    return () => {
      active = false
    }
  }, [openTrainingItem])

  function selectGroup(key) {
    setGroup(key)
    setCategoryId(null)
  }

  const filteredItems = useMemo(() => {
    const filtered = items.filter((i) => {
      if (i.group_key !== group) return false
      if (group !== 'drink' || !categoryId) return true
      if (categoryId === TOP10_CATEGORY_ID) return !!i.top_10
      if (categoryId === MUST_KNOW_CATEGORY_ID) return !!i.is_must_know
      return i.category_id === categoryId
    })
    // Top 10 has its own order (top_10_sort_order, set in Admin Center >
    // Formula Database > Top 10), independent of `sort_order` — match it
    // here too instead of falling back to each item's normal list position.
    if (categoryId === TOP10_CATEGORY_ID) {
      return [...filtered].sort((a, b) => (a.top_10_sort_order ?? 0) - (b.top_10_sort_order ?? 0) || a.id - b.id)
    }
    return filtered
  }, [items, group, categoryId])

  // The new top-level "⭐ Must-Know Items" tab (GROUPS, first entry) — spans
  // every drink group (is_must_know is drink-only, migration 0081's
  // constraint) merged with Shop Training's own must-know items (migration
  // 0082), rendered together below as one combined list.
  const mustKnowFormulaItems = useMemo(() => items.filter((i) => i.is_must_know), [items])
  const mustKnowTrainingItems = useMemo(() => shopTrainingItems.filter((i) => i.is_must_know), [shopTrainingItems])

  async function toggle(itemId, value) {
    setProgress((prev) => ({ ...prev, [itemId]: { ...prev[itemId], memorized: value } }))
    await supabase.from('study_progress').upsert(
      {
        profile_id: profileId,
        formula_item_id: itemId,
        memorized: value,
        memorized_at: value ? new Date().toISOString() : null,
      },
      { onConflict: 'profile_id,formula_item_id' }
    )
    onProgressChange?.()
  }

  // Same shape as toggle() above, against shop_training_progress instead of
  // study_progress (migration 0073) — kept as its own function rather than
  // a shared helper since the two tables' conflict keys/column names differ.
  async function toggleShopTraining(itemId, value) {
    setShopTrainingProgress((prev) => ({ ...prev, [itemId]: { ...prev[itemId], memorized: value } }))
    await supabase.from('shop_training_progress').upsert(
      {
        profile_id: profileId,
        shop_training_item_id: itemId,
        memorized: value,
        memorized_at: value ? new Date().toISOString() : null,
      },
      { onConflict: 'profile_id,shop_training_item_id' }
    )
    onProgressChange?.()
  }

  if (loading) return <LoadingSpinner />
  if (!items.length && !shopTrainingItems.length) return <EmptyState label="No formula items to study yet." />

  const memorizedCount =
    group === 'shop_training'
      ? shopTrainingItems.filter((i) => shopTrainingProgress[i.id]?.memorized).length
      : group === 'must_know'
        ? mustKnowFormulaItems.filter((i) => progress[i.id]?.memorized).length +
          mustKnowTrainingItems.filter((i) => shopTrainingProgress[i.id]?.memorized).length
        : filteredItems.filter((i) => progress[i.id]?.memorized).length

  return (
    <div>
      {/* headerActions (Quick/Formal Quiz, Progress chart/Study summary) gets
          its own row above the Drink/Tea/Toppings/Others tabs, instead of
          sharing one row with them — on a phone-width screen, four tabs plus
          two multi-button color blocks side by side don't fit, and with no
          wrapping the overflow just pushed the quiz/chart buttons off
          screen (looking like they weren't there at all) instead of showing
          them on a second line. Both rows also get their own flex-wrap as a
          second line of defense, so even a very narrow phone wraps onto
          more lines instead of clipping anything. */}
      <div className="mb-3">
        {headerActions && <div className="mb-2 flex flex-wrap items-center gap-2">{headerActions}</div>}
        <div className="flex flex-wrap gap-1 border-b border-brand-100">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              onClick={() => selectGroup(g.key)}
              className={`px-4 py-2 text-sm font-medium ${
                group === g.key ? 'border-b-2 border-brand-500 text-brand-700' : 'text-gray-500 hover:text-brand-600'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {group === 'drink' && (
            <select
              className="input w-auto"
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value || null)}
            >
              <option value="">All categories</option>
              <option value={TOP10_CATEGORY_ID}>⭐ Top 10</option>
              <option value={MUST_KNOW_CATEGORY_ID}>⭐ Must Know Item</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <p className="text-sm text-gray-500">
            {memorizedCount} of{' '}
            {group === 'shop_training'
              ? shopTrainingItems.length
              : group === 'must_know'
                ? mustKnowFormulaItems.length + mustKnowTrainingItems.length
                : filteredItems.length}{' '}
            memorized
          </p>
          {qualified && group !== 'shop_training' && group !== 'must_know' && (
            <span className="text-xs font-medium text-brand-500">Qualified</span>
          )}
        </div>
      </div>

      {group === 'must_know' ? (
        !mustKnowFormulaItems.length && !mustKnowTrainingItems.length ? (
          <EmptyState label="No items marked Must Know Item yet — check it when editing a drink or a Shop Training item." />
        ) : (
          <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
            {mustKnowFormulaItems.map((item) => (
              <div key={`formula-${item.id}`} className="flex items-center justify-between px-4 py-2.5">
                <button onClick={() => setOpenItem(item)} className="flex-1 text-left">
                  {item.formula_categories && (
                    <span className="text-xs text-brand-400">{item.formula_categories.name}</span>
                  )}
                  <div className="font-medium text-gray-800">
                    {item.name_en} {item.name_zh && <span className="font-zh text-brand-600">· {item.name_zh}</span>}
                  </div>
                </button>
                <label className="flex items-center gap-2 text-sm text-gray-500">
                  Memorized
                  <input
                    type="checkbox"
                    checked={!!progress[item.id]?.memorized}
                    onChange={(e) => toggle(item.id, e.target.checked)}
                  />
                </label>
              </div>
            ))}
            {mustKnowTrainingItems.map((item) => (
              <div key={`training-${item.id}`} className="flex items-center justify-between px-4 py-2.5">
                <button onClick={() => setOpenTrainingItem(item)} className="flex-1 text-left">
                  <span className="text-xs text-brand-400">Shop Training</span>
                  <div className="font-medium text-gray-800">{item.title}</div>
                </button>
                <label className="flex items-center gap-2 text-sm text-gray-500">
                  Memorized
                  <input
                    type="checkbox"
                    checked={!!shopTrainingProgress[item.id]?.memorized}
                    onChange={(e) => toggleShopTraining(item.id, e.target.checked)}
                  />
                </label>
              </div>
            ))}
          </div>
        )
      ) : group === 'shop_training' ? (
        !shopTrainingItems.length ? (
          <EmptyState label="No shop training content yet." />
        ) : (
          <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
            {shopTrainingItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
                <button onClick={() => setOpenTrainingItem(item)} className="flex-1 text-left">
                  <div className="font-medium text-gray-800">{item.title}</div>
                </button>
                <label className="flex items-center gap-2 text-sm text-gray-500">
                  Memorized
                  <input
                    type="checkbox"
                    checked={!!shopTrainingProgress[item.id]?.memorized}
                    onChange={(e) => toggleShopTraining(item.id, e.target.checked)}
                  />
                </label>
              </div>
            ))}
          </div>
        )
      ) : !filteredItems.length ? (
        <EmptyState label="No items in this category yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {filteredItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
              <button onClick={() => setOpenItem(item)} className="flex-1 text-left">
                {item.formula_categories && (
                  <span className="text-xs text-brand-400">{item.formula_categories.name}</span>
                )}
                <div className="font-medium text-gray-800">
                  {item.name_en} {item.name_zh && <span className="font-zh text-brand-600">· {item.name_zh}</span>}
                </div>
              </button>
              <label className="flex items-center gap-2 text-sm text-gray-500">
                Memorized
                <input
                  type="checkbox"
                  checked={!!progress[item.id]?.memorized}
                  onChange={(e) => toggle(item.id, e.target.checked)}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      <FormulaItemDetail item={openItem} onClose={() => setOpenItem(null)} />

      {/* Same detail modal shape as ShopTrainingPage.jsx (content + any
          attached files) — reused here rather than imported, since that
          page's version is tied to its own list-loading effect rather than
          taking an item as a prop. */}
      <Modal open={!!openTrainingItem} onClose={() => setOpenTrainingItem(null)} title={openTrainingItem?.title} wide>
        <RichTextViewer html={openTrainingItem?.content_html} />
        {openTrainingItemFiles.length > 0 && (
          <div className="mt-4 border-t border-brand-100 pt-3">
            <div className="mb-1.5 text-xs font-semibold text-gray-500">Attached files</div>
            <div className="space-y-1">
              {openTrainingItemFiles.map((f) => (
                <a
                  key={f.id}
                  href={supabase.storage.from('documents').getPublicUrl(f.file_path).data.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline"
                >
                  📎 {f.display_name}
                </a>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
