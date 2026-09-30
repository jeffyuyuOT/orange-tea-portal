import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'

// Same top-level groups as StudyLogList.jsx's GROUPS — "Drink" is the only
// one with its own sub-categories (formula_categories), so it's broken down
// further below; the other three are shown as one line each.
const GROUP_LABEL = { tea: 'Tea', toppings: 'Toppings', others: 'Others' }

// "xx out of xx memorized" per category, for whichever profile is passed
// in — same underlying data as Study Log's checklist and progress %, just
// broken down by category instead of shown as one flat list.
export default function StudySummaryModal({ profileId, onClose }) {
  const { currentStoreId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([]) // { label, memorized, total }

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    Promise.all([
      supabase.from('profiles').select('qualified').eq('id', profileId).single(),
      supabase.from('formula_items').select('id, group_key, category_id, top_10, is_must_know').eq('is_active', true),
      supabase.from('formula_categories').select('id, name').eq('group_key', 'drink').order('sort_order').order('id'),
      supabase.from('study_progress').select('formula_item_id').eq('profile_id', profileId).eq('memorized', true),
      // Jeff, 2026-09-30 (same-day revision to item 7): "study summary也多出
      // Must-Know Items的統計" — same must-know Shop Training data
      // (migration 0082) Study Log's new tab and Progress Chart's new
      // breakdown both use, merged with must-know drinks into one "⭐
      // Must-Know Items" row below.
      currentStoreId
        ? supabase.from('shop_training_items').select('id, is_must_know').eq('store_id', currentStoreId)
        : Promise.resolve({ data: [] }),
      supabase.from('shop_training_progress').select('shop_training_item_id').eq('profile_id', profileId).eq('memorized', true),
    ]).then(([{ data: profileRow }, { data: items }, { data: categories }, { data: progress }, { data: trainingItems }, { data: trainingProgress }]) => {
      // Qualified staff count every active item as memorized automatically —
      // same rule StudyLogList's `qualified` prop and the Progress Chart use.
      // Note: this only ever auto-completed FORMULA items (see
      // StaffStudyDetail.jsx's markAllCurrentItemsMemorized), never Shop
      // Training, so it's applied to the drink side of the Must-Know row
      // below but not the Shop Training side.
      const isQualified = !!profileRow?.qualified
      const memorizedIds = new Set((progress ?? []).map((p) => p.formula_item_id))
      const isMemorized = (item) => isQualified || memorizedIds.has(item.id)
      const trainingMemorizedIds = new Set((trainingProgress ?? []).map((p) => p.shop_training_item_id))

      const drinkItems = (items ?? []).filter((i) => i.group_key === 'drink')
      const top10Items = drinkItems.filter((i) => i.top_10)
      const mustKnowFormulaItems = drinkItems.filter((i) => i.is_must_know)
      const mustKnowTrainingItems = (trainingItems ?? []).filter((i) => i.is_must_know)
      const mustKnowTotal = mustKnowFormulaItems.length + mustKnowTrainingItems.length
      const mustKnowMemorized =
        mustKnowFormulaItems.filter(isMemorized).length +
        mustKnowTrainingItems.filter((i) => trainingMemorizedIds.has(i.id)).length
      const summary = []
      if (top10Items.length) {
        summary.push({ label: '⭐ Top 10', memorized: top10Items.filter(isMemorized).length, total: top10Items.length })
      }
      if (mustKnowTotal) {
        summary.push({ label: '⭐ Must Know Item', memorized: mustKnowMemorized, total: mustKnowTotal })
      }
      ;(categories ?? []).forEach((c) => {
        const catItems = drinkItems.filter((i) => i.category_id === c.id)
        if (catItems.length) {
          summary.push({ label: c.name, memorized: catItems.filter(isMemorized).length, total: catItems.length })
        }
      })
      ;['tea', 'toppings', 'others'].forEach((key) => {
        const groupItems = (items ?? []).filter((i) => i.group_key === key)
        if (groupItems.length) {
          summary.push({ label: GROUP_LABEL[key], memorized: groupItems.filter(isMemorized).length, total: groupItems.length })
        }
      })
      setRows(summary)
      setLoading(false)
    })
  }, [profileId, currentStoreId])

  // Overall total skips the "Top 10" and "Must-Know Items" lines — those
  // items are also already counted under their real drink sub-category (or,
  // for Shop Training, aren't part of `overall` at all — Shop Training has
  // never had its own breakdown in this summary), so adding either back in
  // would double-count them.
  const overall = useMemo(() => {
    const real = rows.filter((r) => r.label !== '⭐ Top 10' && r.label !== '⭐ Must Know Item')
    return { memorized: real.reduce((s, r) => s + r.memorized, 0), total: real.reduce((s, r) => s + r.total, 0) }
  }, [rows])

  return (
    <Modal open onClose={onClose} title="📊 Study Summary">
      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-2">
          <div className="mb-1 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">
            Overall: {overall.memorized} out of {overall.total} memorized
          </div>
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between rounded-lg border border-brand-100 px-3 py-2 text-sm">
              <span className="text-gray-700">{r.label}</span>
              <span className="font-medium text-brand-600">
                {r.memorized} out of {r.total}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
