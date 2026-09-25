import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
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
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([]) // { label, memorized, total }

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    Promise.all([
      supabase.from('profiles').select('is_senior').eq('id', profileId).single(),
      supabase.from('formula_items').select('id, group_key, category_id, top_10').eq('is_active', true),
      supabase.from('formula_categories').select('id, name').eq('group_key', 'drink').order('sort_order').order('id'),
      supabase.from('study_progress').select('formula_item_id').eq('profile_id', profileId).eq('memorized', true),
    ]).then(([{ data: profileRow }, { data: items }, { data: categories }, { data: progress }]) => {
      // Senior staff count every active item as memorized automatically —
      // same rule StudyLogList's `senior` prop and the Progress Chart use.
      const isSenior = !!profileRow?.is_senior
      const memorizedIds = new Set((progress ?? []).map((p) => p.formula_item_id))
      const isMemorized = (item) => isSenior || memorizedIds.has(item.id)

      const drinkItems = (items ?? []).filter((i) => i.group_key === 'drink')
      const top10Items = drinkItems.filter((i) => i.top_10)
      const summary = []
      if (top10Items.length) {
        summary.push({ label: '⭐ Top 10', memorized: top10Items.filter(isMemorized).length, total: top10Items.length })
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
  }, [profileId])

  // Overall total skips the "Top 10" line — those items are also already
  // counted under their real drink sub-category, so adding it in again
  // would double-count them.
  const overall = useMemo(() => {
    const real = rows.filter((r) => r.label !== '⭐ Top 10')
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
