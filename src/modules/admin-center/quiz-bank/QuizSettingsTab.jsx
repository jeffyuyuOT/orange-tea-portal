import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// Jeff, 2026-09: "quiz bank setting就改回原本名字setting，也一樣放在這個分頁
// 下" — folded back in as the "Setting" tab of the reinstated Admin Quiz
// Bank page (AdminQuizBankPage.jsx), replacing the brief standalone-page
// detour (this file used to be QuizSettingsPage.jsx, its own top-level
// route/permission key). Renamed from QuizSettingsPage → QuizSettingsTab to
// match: no more own <h1>/route, it just renders as tab content now.
//
// Jeff, 2026-09-30: this went through two false starts before landing here
// — worth recording why, so a future "let's make it per-store again" idea
// remembers what didn't work. First: "quiz setting不是在admin通用每個店嗎?
// 為什麼會出現分店面的情形" — this page WAS per-store (one quiz_settings/
// formal_quiz_settings row per store_id) but Brisbane One/Underwood had
// simply never been saved from here, silently sitting on the code's
// hardcoded defaults while the other three stores had real tuned numbers —
// and there was no way to even fix that, since AppShell.jsx hides the
// header's Store Switcher on every Admin Center route (correct for the rest
// of Admin Center, which really is global) with no substitute here. So a
// self-contained store picker + an "All Store" bulk-apply option were added
// directly to this tab. Then: "我覺得還是要做到全店面通用，因為有時候如果要
// 套用某一設定到所有店就會變成頁面的所有設定都套用，因為也沒有指定哪些設定
// 套用的功能。所以很難做到每家店管理自己的頁面，而且現在又在admin下，基本
// 都是所有分店統一設定" — Jeff's own conclusion: since there was never a way
// to apply just SOME settings to just SOME stores (every save is the whole
// form, to whichever store(s) are targeted), "per-store" never bought
// anything real — every edit ended up getting reapplied to every store
// anyway. Combined with this page already sitting inside Admin Center,
// which is otherwise entirely global, the honest fix is to stop pretending
// this is per-store at all.
//
// So (migration 0079_quiz_settings_global.sql): quiz_settings and
// formal_quiz_settings are now true singletons — store_id dropped
// entirely, replaced by a `singleton boolean primary key default true
// check (singleton)` column that makes a second row physically impossible
// to insert. One set of numbers, shared by every store, no store picker
// here at all. Starting values carried over Brookside/Sunnybank's numbers
// (Jeff's call — the two that already agreed with each other) rather than
// Toowong's slightly different mix, so Toowong's Importance mix (was
// 50/40/10) and Formal Quiz fill-in-blank ratio (was 80%) moved to match
// the rest as of that migration.
//
// Jeff, 2026-09 (earlier, same request as the Admin Quiz Bank
// reinstatement): "quiz bank Importance mix將quick quiz跟formal quiz合併成
// 一個就好...兩種quiz共用一個邏輯即可" — the two previously-separate
// Importance Mix ratios (one for Quick Quiz, one for Formal Quiz) are now
// ONE shared setting, relabelled "Importance mix — (% of questions)". No
// schema change beyond the singleton conversion above: still written to
// both quiz_settings.importance_ratio and formal_quiz_settings.
// importance_ratio (same value, kept in sync here) so QuickQuizModal.jsx/
// FormalQuizModal.jsx — which each already read their own table's
// importance_ratio column — don't need to change how they read it, only
// this page needed to change how it's edited/saved.
//
// Jeff, 2026-09-30 (later the same day): "截圖裡就是合併的，昨天做的，現在繼
// 續爭也沒有，要不就把它們兩合併好嗎" — the "% of Quick Quiz" / "% of Formal
// Quiz" formula fill-in-the-blank ratios (until now genuinely two separate
// values — see the removed `formulaRatio` state and the code comment that
// used to sit here) are now merged into one shared value too, same pattern
// as Importance mix above: one input, written identically to both
// quiz_settings.formula_question_ratio and
// formal_quiz_settings.fill_in_blank_ratio on save. No schema change —
// still two columns under the hood, just kept in sync from here — so
// QuickQuizModal.jsx/FormalQuizModal.jsx don't need to change how they read
// their own column.
export default function QuizSettingsTab() {
  // Quick Quiz's own settings (quiz_settings table).
  const [quickQuestionCount, setQuickQuestionCount] = useState(10)

  // Formal Quiz's own settings (formal_quiz_settings table), plus the quiz
  // reminder cadence — stored in quiz_settings for historical reasons, but
  // grouped here visually because the reminder is about Formal Quiz.
  const [formalQuestionCount, setFormalQuestionCount] = useState(30)
  const [reminderMonths, setReminderMonths] = useState(3)

  // Jeff, 2026-10-02 (Training Journey spec, point 10): Master Exam's own
  // settings (master_quiz_settings table, migration 0091 — a true
  // singleton, same shape as formal_quiz_settings). error_tolerance is how
  // many NON-must-know questions can be missed and still pass — a missed
  // must-know-linked question always fails regardless (see
  // MasterExamModal.jsx/ExpertExamModal.jsx/examBuilders.js).
  // reminder_period_months is the title-defense cadence — deliberately
  // separate from Formal Quiz's reminderMonths above, since Expert/Master
  // titleholders defend on their own schedule, not the Advanced one
  // (recordExpertExamResult/recordMasterExamResult in trainingJourney.js).
  // Jeff, 2026-10-03 (Expert/Master split, point 3): "出題是從phase 1-6
  // 勾選的item出題，邏輯設定都跟master exam一樣" — Expert reuses this exact
  // same settings row rather than getting its own, so the state/field names
  // below stay "master" (no schema change) while the labels rendered below
  // read "Expert/Master" throughout.
  const [masterQuestionCount, setMasterQuestionCount] = useState(30)
  const [masterErrorTolerance, setMasterErrorTolerance] = useState(0)
  const [masterReminderMonths, setMasterReminderMonths] = useState(3)

  // Quiz Bank block — one shared Importance Mix feeding BOTH quiz types'
  // pull from the curated question bank (Admin + Branch together).
  const [importanceRatio, setImportanceRatio] = useState({ 1: 50, 2: 30, 3: 20 })

  // Formula fill-in-the-blank block — genuinely shared mechanics (Top 10
  // weight, excluded ingredients, and now the mix % itself too — see the
  // 2026-09-30 comment above) apply identically to both quiz types.
  const [fillBlankRatio, setFillBlankRatio] = useState(20) // shared — % of quiz that's fill-in-the-blank
  const [top10Weight, setTop10Weight] = useState(3) // shared — see quizSelection.js
  const [showLogicDetails, setShowLogicDetails] = useState(false)

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('quiz_settings').select('*').maybeSingle(),
      supabase.from('formal_quiz_settings').select('*').maybeSingle(),
      supabase.from('master_quiz_settings').select('*').maybeSingle(),
    ]).then(([{ data: quick }, { data: formal }, { data: master }]) => {
      if (quick) {
        setQuickQuestionCount(quick.question_count)
        setReminderMonths(quick.reminder_period_months ?? 3)
      }
      if (formal) {
        setFormalQuestionCount(formal.question_count)
        setTop10Weight(formal.top10_fill_blank_weight ?? 3)
      }
      if (master) {
        setMasterQuestionCount(master.question_count ?? 30)
        setMasterErrorTolerance(master.error_tolerance ?? 0)
        setMasterReminderMonths(master.reminder_period_months ?? 3)
      }
      // Either table's importance_ratio is the same shared value once this
      // has been saved at least once from this merged UI — prefer
      // quiz_settings' copy, fall back to formal_quiz_settings', then the
      // default.
      const ratio = quick?.importance_ratio ?? formal?.importance_ratio
      if (ratio) setImportanceRatio(ratio)
      // Same precedence for the fill-in-the-blank mix % now that it's
      // merged too — prefer quiz_settings.formula_question_ratio, fall back
      // to formal_quiz_settings.fill_in_blank_ratio, then the default. Once
      // this has been saved once from here both columns hold the same
      // number anyway.
      const blankRatio = quick?.formula_question_ratio ?? formal?.fill_in_blank_ratio
      if (blankRatio != null) setFillBlankRatio(blankRatio)
    })
  }, [])

  async function save() {
    setSaving(true)
    const [{ error: quickError }, { error: formalError }, { error: masterError }] = await Promise.all([
      supabase.from('quiz_settings').update({
        question_count: quickQuestionCount,
        importance_ratio: importanceRatio,
        formula_question_ratio: fillBlankRatio,
        reminder_period_months: reminderMonths,
      }).eq('singleton', true),
      supabase.from('formal_quiz_settings').update({
        question_count: formalQuestionCount,
        importance_ratio: importanceRatio,
        fill_in_blank_ratio: fillBlankRatio,
        top10_fill_blank_weight: top10Weight,
      }).eq('singleton', true),
      supabase.from('master_quiz_settings').update({
        question_count: masterQuestionCount,
        error_tolerance: masterErrorTolerance,
        reminder_period_months: masterReminderMonths,
      }).eq('singleton', true),
    ])
    setSaving(false)
    if (quickError) alert(quickError.message)
    else if (formalError) alert(formalError.message)
    else if (masterError) alert(masterError.message)
  }

  const importanceTotal = Number(importanceRatio[1]) + Number(importanceRatio[2]) + Number(importanceRatio[3])

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        Settings for every store's Quick Quiz and Formal Quiz, in My Dashboard &gt; Study Log.
      </p>

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

        {/* Expert/Master Exam — Training Journey spec point 10, relabeled
            2026-10-03 for the Expert/Master split (point 3): "Master exam
            的敘述都改成Expert/Master exam" — Expert and Master share this
            exact same settings row (question count / error tolerance /
            defense cadence, still against master_quiz_settings — no new
            settings row, since Expert's exam logic is a direct clone of
            Master's per Jeff's spec), so the labels read "Expert/Master"
            throughout rather than duplicating the section. Its own section,
            separate from Formal Quiz's above, including its own reminder
            cadence (the Expert/Master title-defense clock, distinct from
            Advanced's). */}
        <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-indigo-700">🎓 Expert/Master Quiz</h3>
          <div className="flex flex-wrap gap-4">
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">Questions per Expert/Master Exam</span>
              <input
                type="number"
                className="input"
                value={masterQuestionCount}
                onChange={(e) => setMasterQuestionCount(Number(e.target.value))}
              />
            </label>
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">Error tolerance (non-must-know misses allowed)</span>
              <input
                type="number"
                min={0}
                className="input"
                value={masterErrorTolerance}
                onChange={(e) => setMasterErrorTolerance(Number(e.target.value))}
              />
            </label>
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">Title defense cadence</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Every</span>
                <input
                  type="number"
                  min={1}
                  className="input w-20"
                  value={masterReminderMonths}
                  onChange={(e) => setMasterReminderMonths(Number(e.target.value))}
                />
                <span className="text-sm text-gray-400">months</span>
              </div>
            </label>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Any missed question linked to a Must-Know item always fails the Expert or Master Exam, regardless of
            the error tolerance above — tolerance only covers non-must-know misses. An Expert or Master titleholder's
            recurring title defense runs on this cadence, separate from Formal Quiz's Advanced defense cadence above.
          </p>
        </section>

        {/* Quiz Bank — one shared Importance Mix feeding picking curated
            questions FROM the Quiz Bank (Admin + Branch together), used by
            both quiz types identically. Any future Quiz Bank-related
            setting belongs in this block too. */}
        <section className="rounded-xl border border-purple-200 bg-purple-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-purple-700">📚 Quiz Bank</h3>
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-500">Importance mix — (% of questions)</span>
            {[1, 2, 3].map((level) => (
              <div key={level} className="mb-1 flex items-center gap-2">
                <span className="w-28 text-sm text-gray-600">Importance {level}</span>
                <input
                  type="number"
                  className="input w-24"
                  value={importanceRatio[level]}
                  onChange={(e) => setImportanceRatio((prev) => ({ ...prev, [level]: Number(e.target.value) }))}
                />
                <span className="text-sm text-gray-400">%</span>
              </div>
            ))}
            {importanceTotal !== 100 && <p className="text-xs text-amber-600">Currently totals {importanceTotal}%, not 100%.</p>}
          </div>
        </section>

        {/* Formula fill-in-the-blank questions — genuinely shared mechanics
            (Top 10 weight, excluded ingredients, and now the mix % itself)
            apply identically to both quiz types' auto-generated formula
            questions. Placed last — the excluded-ingredients checklist
            below needs the most vertical room, so keeping it at the bottom
            avoids pushing every other setting down the page. */}
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-amber-700">🧪 Formula fill-in-the-blank questions</h3>
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">% of quiz questions</span>
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
            {/* Jeff, 2026-09: "下面那一大段說明改成一個按鍵...按了在跳出說明就
                好，要不然一大段很占版面" — the explanatory paragraph that used
                to sit here permanently now only shows in a popup, on demand. */}
            <Button variant="secondary" onClick={() => setShowLogicDetails(true)} className="!text-xs">
              Quiz Logic & Weighting Details
            </Button>
          </div>

          <ExcludedIngredientsSection />
        </section>

        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {showLogicDetails && (
        <Modal open onClose={() => setShowLogicDetails(false)} title="Quiz Logic & Weighting Details">
          <p className="text-sm text-gray-600">
            The "% of quiz questions" setting above controls how much of both Quick Quiz and Formal Quiz is
            auto-generated "fill in the ingredient quantity" questions from Formula Database recipes, rather than
            ordinary questions pulled from the Quiz Bank (Admin + Branch, weighted by the Importance mix above). The
            Top 10 weight — how many times
            more likely a fill-in-the-blank question about a ⭐ Top 10 drink is to be picked, versus any other
            memorized item (1 = no boost, 3 = default) — and the excluded-ingredients list below both apply the same
            way to Quick Quiz and Formal Quiz. Quick Quiz's version of these questions is always multiple choice.
            Formal Quiz's is a mix: a ⭐ Top 10 drink's question stays typed (most rigorous, for the drinks staff most
            need to know cold); every other drink's question is shown as multiple choice instead, but with
            deliberately hard-to-guess wrong answers (the closest real quantities on record, not random ones). This
            isn't a setting to tune — it's fixed behavior — and only applies to these auto-generated questions, not
            to a fill-in-the-blank question an admin wrote by hand in the Quiz Bank, which always stays typed.
          </p>
        </Modal>
      )}
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
