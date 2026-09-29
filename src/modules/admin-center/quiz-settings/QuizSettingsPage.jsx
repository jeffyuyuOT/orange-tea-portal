import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// Jeff, 2026-09: "原本的quiz bank setting從quiz banks拿出來留在admin
// centre" — moved here from being a tab inside Quiz Bank (which itself moved
// into the new Training Centre section) to its own standalone page, a
// sibling of Formula Database/File Repository/etc. under Admin Center.
// Nothing about how it works changed — it's the same per-store settings
// screen (quiz_settings/formal_quiz_settings/quiz_excluded_ingredients, all
// keyed by currentStoreId from useAuth()) it always was; only the page
// chrome around it (this h1, and its own top-level route) is new. Like
// every other Admin Center page, AppShell hides the header StoreSwitcher
// here and shows "All Stores" instead — currentStoreId still holds whatever
// store was last switched to elsewhere in the app (see AuthContext.jsx;
// admin/developer default to their first accessible store), so switch
// stores from any non-Admin-Center page first if you need to edit a
// different store's quiz settings — exactly how this screen already worked
// before the move, just under a different tab.
//
// One merged Setting screen for both Quick Quiz and Formal Quiz, replacing
// the old "Quick Quiz / Formal Quiz" sub-tab toggle (FormalQuizSettingsTab.jsx
// is no longer used by anything, left in place as dead code rather than
// deleted). Jeff asked for this because two settings — the Top 10
// fill-in-the-blank weight and the excluded-ingredients list — actually
// apply to BOTH quiz types' auto-generated formula questions, but used to
// live only inside one quiz type's own tab, making them easy to miss and
// (until this change) not even actually wired up to affect the other quiz
// type at all (see QuickQuizModal.jsx / FormalQuizModal.jsx).
//
// Layout, per Jeff's spec: each quiz type's OWN setting stays in its own
// colored block near the top; settings genuinely shared between the two
// quiz types get their own blocks below that; "Formula fill-in-the-blank
// questions" — the block needing the most vertical room (the excluded-
// ingredients checklist) — goes last, so it doesn't push everything else
// down the page.
export default function QuizSettingsPage() {
  const { currentStoreId } = useAuth()

  // Quick Quiz's own settings (quiz_settings table).
  const [quickQuestionCount, setQuickQuestionCount] = useState(10)
  const [quickRatio, setQuickRatio] = useState({ 1: 50, 2: 30, 3: 20 })
  const [formulaRatio, setFormulaRatio] = useState(0) // Quick Quiz's own formula-question %

  // Formal Quiz's own settings (formal_quiz_settings table), plus the quiz
  // reminder cadence — stored in quiz_settings for historical reasons, but
  // grouped here visually because the reminder is about Formal Quiz.
  const [formalQuestionCount, setFormalQuestionCount] = useState(30)
  const [reminderMonths, setReminderMonths] = useState(3)

  // Quiz Bank block — importance mix feeding each quiz type's pull from the
  // curated question bank. Kept as two independent ratios (Quick Quiz and
  // Formal Quiz differ enough in size/purpose that forcing one shared mix
  // isn't right), but grouped together here since both belong to "picking
  // from the Quiz Bank" — future Quiz-Bank-related settings join them here.
  const [formalRatio, setFormalRatio] = useState({ 1: 50, 2: 30, 3: 20 })

  // Formula fill-in-the-blank block — genuinely shared mechanics (Top 10
  // weight, excluded ingredients) plus each quiz type's own mix %.
  const [fillBlankRatio, setFillBlankRatio] = useState(20) // Formal Quiz's own formula-question %
  const [top10Weight, setTop10Weight] = useState(3) // shared — see quizSelection.js

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!currentStoreId) return
    Promise.all([
      supabase.from('quiz_settings').select('*').eq('store_id', currentStoreId).maybeSingle(),
      supabase.from('formal_quiz_settings').select('*').eq('store_id', currentStoreId).maybeSingle(),
    ]).then(([{ data: quick }, { data: formal }]) => {
      if (quick) {
        setQuickQuestionCount(quick.question_count)
        setQuickRatio(quick.importance_ratio)
        setFormulaRatio(quick.formula_question_ratio ?? 0)
        setReminderMonths(quick.reminder_period_months ?? 3)
      }
      if (formal) {
        setFormalQuestionCount(formal.question_count)
        setFormalRatio(formal.importance_ratio)
        setFillBlankRatio(formal.fill_in_blank_ratio)
        setTop10Weight(formal.top10_fill_blank_weight ?? 3)
      }
    })
  }, [currentStoreId])

  async function save() {
    setSaving(true)
    const [{ error: quickError }, { error: formalError }] = await Promise.all([
      supabase.from('quiz_settings').upsert(
        {
          store_id: currentStoreId,
          question_count: quickQuestionCount,
          importance_ratio: quickRatio,
          formula_question_ratio: formulaRatio,
          reminder_period_months: reminderMonths,
        },
        { onConflict: 'store_id' }
      ),
      supabase.from('formal_quiz_settings').upsert(
        {
          store_id: currentStoreId,
          question_count: formalQuestionCount,
          importance_ratio: formalRatio,
          fill_in_blank_ratio: fillBlankRatio,
          top10_fill_blank_weight: top10Weight,
        },
        { onConflict: 'store_id' }
      ),
    ])
    setSaving(false)
    if (quickError) alert(quickError.message)
    else if (formalError) alert(formalError.message)
  }

  const quickTotal = Number(quickRatio[1]) + Number(quickRatio[2]) + Number(quickRatio[3])
  const formalTotal = Number(formalRatio[1]) + Number(formalRatio[2]) + Number(formalRatio[3])

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Quiz Bank Setting</h1>
      <p className="mb-4 text-sm text-gray-500">Settings for this store's Quick Quiz and Formal Quiz, in My Dashboard &gt; Study Log.</p>

      <div className="max-w-2xl space-y-4">
        {/* Quick Quiz — its own setting only. */}
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-orange-700">🧠 Quick Quiz</h3>
          <label className="block max-w-xs">
            <span className="mb-1 block text-xs font-medium text-gray-500">Questions per Quick Quiz</span>
            <input
              type="number"
              className="input"
              value={quickQuestionCount}
              onChange={(e) => setQuickQuestionCount(Number(e.target.value))}
            />
          </label>
        </section>

        {/* Formal Quiz — its own settings, including the reminder cadence
            (stored in quiz_settings, but this is the setting that decides
            when a staff member is nudged to take the quiz again — Jeff's
            call that it reads as a Formal Quiz setting). */}
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-blue-700">📝 Formal Quiz</h3>
          <div className="flex flex-wrap gap-4">
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">Questions per Formal Quiz</span>
              <input
                type="number"
                className="input"
                value={formalQuestionCount}
                onChange={(e) => setFormalQuestionCount(Number(e.target.value))}
              />
            </label>
            <label className="block max-w-xs">
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
            </label>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            If a staff member has no quiz attempt within this window, a reminder to take the quiz appears on the
            Bulletin Board — visible to that staff member, this store's manager, and admin.
          </p>
        </section>

        {/* Quiz Bank — settings that feed picking curated questions FROM the
            Quiz Bank (Training Centre), used by both quiz types. Any future
            Quiz Bank-related setting belongs in this block too. */}
        <section className="rounded-xl border border-purple-200 bg-purple-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-purple-700">📚 Quiz Bank</h3>
          <div className="flex flex-wrap gap-6">
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-500">Importance mix — Quick Quiz (% of questions)</span>
              {[1, 2, 3].map((level) => (
                <div key={level} className="mb-1 flex items-center gap-2">
                  <span className="w-28 text-sm text-gray-600">Importance {level}</span>
                  <input
                    type="number"
                    className="input w-24"
                    value={quickRatio[level]}
                    onChange={(e) => setQuickRatio((prev) => ({ ...prev, [level]: Number(e.target.value) }))}
                  />
                  <span className="text-sm text-gray-400">%</span>
                </div>
              ))}
              {quickTotal !== 100 && <p className="text-xs text-amber-600">Currently totals {quickTotal}%, not 100%.</p>}
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-500">Importance mix — Formal Quiz (% of questions)</span>
              {[1, 2, 3].map((level) => (
                <div key={level} className="mb-1 flex items-center gap-2">
                  <span className="w-28 text-sm text-gray-600">Importance {level}</span>
                  <input
                    type="number"
                    className="input w-24"
                    value={formalRatio[level]}
                    onChange={(e) => setFormalRatio((prev) => ({ ...prev, [level]: Number(e.target.value) }))}
                  />
                  <span className="text-sm text-gray-400">%</span>
                </div>
              ))}
              {formalTotal !== 100 && <p className="text-xs text-amber-600">Currently totals {formalTotal}%, not 100%.</p>}
            </div>
          </div>
        </section>

        {/* Formula fill-in-the-blank questions — genuinely shared mechanics
            (Top 10 weight, excluded ingredients) apply identically to BOTH
            quiz types' auto-generated formula questions; each quiz type
            keeps its own % of how much of the quiz is made of these. Placed
            last — the excluded-ingredients checklist below needs the most
            vertical room, so keeping it at the bottom avoids pushing every
            other setting down the page. */}
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-amber-700">🧪 Formula fill-in-the-blank questions</h3>
          <div className="mb-4 flex flex-wrap gap-4">
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">% of Quick Quiz</span>
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
            </label>
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">% of Formal Quiz</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input"
                  value={fillBlankRatio}
                  onChange={(e) => setFillBlankRatio(Number(e.target.value))}
                />
                <span className="text-sm text-gray-400">%</span>
              </div>
            </label>
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">Top 10 weight in fill-in-the-blank questions</span>
              <input
                type="number"
                min="1"
                step="0.5"
                className="input"
                value={top10Weight}
                onChange={(e) => setTop10Weight(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="mb-4 text-xs text-gray-400">
            Both top "% of quiz" settings control how much of that quiz type is auto-generated "fill in the
            ingredient quantity" questions from Formula Database recipes, rather than ordinary questions pulled from
            the Quiz Bank above. The Top 10 weight — how many times more likely a fill-in-the-blank question about a
            ⭐ Top 10 drink is to be picked, versus any other memorized item (1 = no boost, 3 = default) — and the
            excluded-ingredients list below both apply the same way to Quick Quiz and Formal Quiz. Quick Quiz's
            version of these questions is always multiple choice. Formal Quiz's is a mix: a ⭐ Top 10 drink's question
            stays typed (most rigorous, for the drinks staff most need to know cold); every other drink's question is
            shown as multiple choice instead, but with deliberately hard-to-guess wrong answers (the closest real
            quantities on record, not random ones). This isn't a setting to tune — it's fixed behavior — and only
            applies to these auto-generated questions, not to a fill-in-the-blank question an admin wrote by hand in
            the Quiz Bank, which always stays typed.
          </p>

          <ExcludedIngredientsSection />
        </section>

        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

// Ingredients an admin has opted out of the auto-generated formula
// questions (e.g. water, ice — quantity isn't meaningful to quiz on).
// Shared by Quick Quiz and Formal Quiz. Toggling persists immediately, same
// as the Study Log "Memorized" checkbox, rather than being buffered behind
// the Save button above — there's nothing else on this list to batch it with.
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
