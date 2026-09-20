import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

export default function QuizSettingsTab() {
  const { currentStoreId } = useAuth()
  const [questionCount, setQuestionCount] = useState(10)
  const [ratio, setRatio] = useState({ 1: 50, 2: 30, 3: 20 })
  const [formulaRatio, setFormulaRatio] = useState(0)
  const [reminderMonths, setReminderMonths] = useState(3)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!currentStoreId) return
    supabase
      .from('quiz_settings')
      .select('*')
      .eq('store_id', currentStoreId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setQuestionCount(data.question_count)
          setRatio(data.importance_ratio)
          setFormulaRatio(data.formula_question_ratio ?? 0)
          setReminderMonths(data.reminder_period_months ?? 3)
        }
      })
  }, [currentStoreId])

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('quiz_settings').upsert(
      {
        store_id: currentStoreId,
        question_count: questionCount,
        importance_ratio: ratio,
        formula_question_ratio: formulaRatio,
        reminder_period_months: reminderMonths,
      },
      { onConflict: 'store_id' }
    )
    setSaving(false)
    if (error) alert(error.message)
  }

  const total = Number(ratio[1]) + Number(ratio[2]) + Number(ratio[3])

  return (
    <div className="max-w-md space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Questions per Quick Quiz</span>
        <input type="number" className="input" value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))} />
      </label>

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-500">Importance mix (% of questions)</span>
        {[1, 2, 3].map((level) => (
          <div key={level} className="mb-1 flex items-center gap-2">
            <span className="w-32 text-sm text-gray-600">Importance {level}</span>
            <input
              type="number"
              className="input"
              value={ratio[level]}
              onChange={(e) => setRatio((prev) => ({ ...prev, [level]: Number(e.target.value) }))}
            />
            <span className="text-sm text-gray-400">%</span>
          </div>
        ))}
        {total !== 100 && <p className="text-xs text-amber-600">Percentages currently total {total}%, not 100%.</p>}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">
          Formula fill-in-the-blank questions (% of Quick Quiz)
        </span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            className="input"
            value={formulaRatio}
            onChange={(e) => setFormulaRatio(Number(e.target.value))}
          />
          <span className="text-sm text-gray-400">%</span>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Auto-generated from recorded ingredient quantities on memorized items (e.g. "How much syrup goes in
          Fruit Tea?") — mixed in alongside Quiz Bank questions above. The rest of each quiz still comes from the
          Quiz Bank, split by the importance mix above.
        </p>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Quiz reminder cadence</span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Every</span>
          <input
            type="number"
            min={1}
            className="input w-20"
            value={reminderMonths}
            onChange={(e) => setReminderMonths(Number(e.target.value))}
          />
          <span className="text-sm text-gray-400">months</span>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          If a staff member has no quiz attempt within this window, a reminder to take the quiz appears on the
          Bulletin Board — visible to that staff member, this store's manager, and admin.
        </p>
      </label>

      <Button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>

      <ExcludedIngredientsSection />
    </div>
  )
}

// Ingredients an admin has opted out of the auto-generated formula
// questions (e.g. water, ice — quantity isn't meaningful to quiz on).
// Toggling persists immediately, same as the Study Log "Memorized"
// checkbox, rather than being buffered behind the Save button above —
// there's nothing else on this list to batch it with.
function ExcludedIngredientsSection() {
  const [ingredients, setIngredients] = useState([])
  const [excludedIds, setExcludedIds] = useState(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('ingredient_master').select('id, name').order('name'),
      supabase.from('quiz_excluded_ingredients').select('ingredient_id'),
    ]).then(([{ data: ingredientRows }, { data: excludedRows }]) => {
      setIngredients(ingredientRows ?? [])
      setExcludedIds(new Set((excludedRows ?? []).map((r) => r.ingredient_id)))
      setLoading(false)
    })
  }, [])

  async function toggle(id, exclude) {
    setExcludedIds((prev) => {
      const next = new Set(prev)
      if (exclude) next.add(id)
      else next.delete(id)
      return next
    })
    const { error } = exclude
      ? await supabase.from('quiz_excluded_ingredients').insert({ ingredient_id: id })
      : await supabase.from('quiz_excluded_ingredients').delete().eq('ingredient_id', id)
    if (error) {
      alert(error.message)
      setExcludedIds((prev) => {
        const next = new Set(prev)
        if (exclude) next.delete(id)
        else next.add(id)
        return next
      })
    }
  }

  const visible = useMemo(
    () => ingredients.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase())),
    [ingredients, search]
  )

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-gray-500">Ingredients excluded from formula questions</span>
      <p className="mb-2 text-xs text-gray-400">
        Every ingredient with a recorded quantity is eligible by default. Uncheck one here if its quantity isn't
        meaningful to quiz staff on (e.g. water, ice).
      </p>
      <input
        className="input mb-2"
        placeholder="Search ingredients…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !visible.length ? (
        <EmptyState label="No ingredients match." />
      ) : (
        <div className="max-h-64 divide-y divide-brand-100 overflow-y-auto rounded-xl border border-brand-100 bg-white">
          {visible.map((ing) => (
            <label key={ing.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={!excludedIds.has(ing.id)}
                onChange={(e) => toggle(ing.id, !e.target.checked)}
              />
              {ing.name}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
