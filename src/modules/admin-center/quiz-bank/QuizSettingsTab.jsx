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
// Jeff, 2026-10-07 (8-point phase-merge request, point 4): "Formal quiz
// Quiz reminder cadence從formal exam設定區塊移除。因為Title defense exam才有
// Quiz reminder cadence" — the generic Bulletin quiz-reminder cadence
// (quiz_settings.reminder_period_months) moves from the Formal Quiz section
// into Quick Quiz's, since it's a Quick-Quiz-nudge setting, not a title-
// defense one. "Title defense cadence從Expert/Master Quiz區塊獨立出來到其下
// 面另一個區塊Title defense exam裡" — Title Defense Exam becomes its own
// section (new title_defense_settings table, migration 0096), with its own
// question count AND cadence, shared by BOTH Advanced and Master
// titleholders — Expert/Master Quiz is relabeled plain "Master Quiz"
// (the merged Expert tier no longer exists) and loses its own
// reminder_period_months field (column dropped by the same migration).
//
// Jeff, 2026-10-07 (later): "Admin Quiz Bank 的quick quiz區塊將Quiz reminder
// cadence移除" — that move-into-Quick-Quiz above turned out to be a dead
// end; the field (and its reminderMonths state/save-write) is removed from
// this page entirely now, not relocated again. The underlying
// quiz_settings.reminder_period_months column is untouched and still drives
// BulletinPage.jsx's quiz-reminder card — it simply isn't admin-editable
// from here anymore, staying at whatever it was last saved as (or its
// column default).
//
// Same message, second half: "Title defense exam改成Title defense quiz" —
// every "Title Defense Exam" label on this page (and the exam modals' own
// titles) is "Title Defense Quiz" from here on, and "title defense exam增加
// Error tolerance (non-must-know misses allowed)選項" adds its own
// error_tolerance column (migration 0097) to title_defense_settings — used
// by BOTH a Formal (Advanced) and Master title-defense attempt instead of
// each exam's own voluntary-attempt tolerance, same "non-must-know misses
// allowed" meaning Master Quiz's own field already has.
export default function QuizSettingsTab() {
  // Quick Quiz's own setting (quiz_settings table).
  const [quickQuestionCount, setQuickQuestionCount] = useState(10)

  // Formal Quiz's own settings (formal_quiz_settings table).
  const [formalQuestionCount, setFormalQuestionCount] = useState(30)

  // Master Exam's own settings (master_quiz_settings table) — question
  // count and error tolerance only now; its own title-defense cadence field
  // moved into the shared Title Defense Quiz section below.
  // error_tolerance is how many NON-must-know questions can be missed and
  // still pass — a missed must-know-linked question always fails
  // regardless (see MasterExamModal.jsx/examBuilders.js).
  const [masterQuestionCount, setMasterQuestionCount] = useState(30)
  const [masterErrorTolerance, setMasterErrorTolerance] = useState(0)

  // Title Defense Quiz — shared by BOTH Advanced and Master titleholders
  // (title_defense_settings table, migration 0096/0097), with its own
  // question count, cadence, AND (2026-10-07) error tolerance — same
  // "non-must-know misses allowed" meaning as Master Quiz's own field above,
  // just independent of it.
  const [titleDefenseQuestionCount, setTitleDefenseQuestionCount] = useState(20)
  const [titleDefenseMonths, setTitleDefenseMonths] = useState(3)
  const [titleDefenseErrorTolerance, setTitleDefenseErrorTolerance] = useState(0)

  // Quiz Bank block — one shared Importance Mix feeding BOTH quiz types'
  // pull from the curated question bank (Admin + Branch together).
  const [importanceRatio, setImportanceRatio] = useState({ 1: 50, 2: 30, 3: 20 })

  // Formula fill-in-the-blank block — genuinely shared mechanics (Top 10
  // weight, excluded ingredients, and now the mix % itself too — see the
  // 2026-09-30 comment above) apply identically to every exam type
  // (point 6: Quick/Formal/Level-Up/Master/Title Defense all share this one
  // global ratio/weight, each bounded by its own item-pool scope).
  const [fillBlankRatio, setFillBlankRatio] = useState(20) // shared — % of quiz that's fill-in-the-blank
  const [top10Weight, setTop10Weight] = useState(3) // shared — see quizSelection.js
  const [showLogicDetails, setShowLogicDetails] = useState(false)

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('quiz_settings').select('*').maybeSingle(),
      supabase.from('formal_quiz_settings').select('*').maybeSingle(),
      supabase.from('master_quiz_settings').select('*').maybeSingle(),
      supabase.from('title_defense_settings').select('*').maybeSingle(),
    ]).then(([{ data: quick }, { data: formal }, { data: master }, { data: titleDefense }]) => {
      if (quick) {
        setQuickQuestionCount(quick.question_count)
      }
      if (formal) {
        setFormalQuestionCount(formal.question_count)
        setTop10Weight(formal.top10_fill_blank_weight ?? 3)
      }
      if (master) {
        setMasterQuestionCount(master.question_count ?? 30)
        setMasterErrorTolerance(master.error_tolerance ?? 0)
      }
      if (titleDefense) {
        setTitleDefenseQuestionCount(titleDefense.question_count ?? 20)
        setTitleDefenseMonths(titleDefense.reminder_period_months ?? 3)
        setTitleDefenseErrorTolerance(titleDefense.error_tolerance ?? 0)
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
    const [{ error: quickError }, { error: formalError }, { error: masterError }, { error: titleDefenseError }] = await Promise.all([
      supabase.from('quiz_settings').update({
        question_count: quickQuestionCount,
        importance_ratio: importanceRatio,
        formula_question_ratio: fillBlankRatio,
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
      }).eq('singleton', true),
      supabase.from('title_defense_settings').update({
        question_count: titleDefenseQuestionCount,
        reminder_period_months: titleDefenseMonths,
        error_tolerance: titleDefenseErrorTolerance,
      }).eq('singleton', true),
    ])
    setSaving(false)
    if (quickError) alert(quickError.message)
    else if (formalError) alert(formalError.message)
    else if (masterError) alert(masterError.message)
    else if (titleDefenseError) alert(titleDefenseError.message)
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

        {/* Formal Quiz — its own setting only now (point 4: the reminder
            cadence that used to live here moved to Quick Quiz above). */}
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-blue-700">📝 Formal Quiz</h3>
          <label className="block max-w-xs">
            <span className="mb-1 block text-xs font-medium text-gray-500">Questions per Formal Quiz</span>
            <input
              type="number"
              className="input"
              value={formalQuestionCount}
              onChange={(e) => setFormalQuestionCount(Number(e.target.value))}
            />
          </label>
        </section>

        {/* Master Exam — Jeff, 2026-10-07 (8-point phase-merge request,
            point 1, 4): relabeled plain "Master Quiz" (the merged Expert
            tier no longer exists as its own title), and its own title-
            defense cadence field moved out into the shared Title Defense
            Exam section below. */}
        <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-indigo-700">🎓 Master Quiz</h3>
          <div className="flex flex-wrap gap-4">
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">Questions per Master Exam</span>
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
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Any missed question linked to a Must-Know item always fails the Master Exam, regardless of the error
            tolerance above — tolerance only covers non-must-know misses. This question count/tolerance governs a
            voluntary Master Exam attempt; a Master title-defense attempt uses the Title Defense Quiz settings below
            instead.
          </p>
        </section>

        {/* Title Defense Quiz — Jeff, 2026-10-07 (8-point phase-merge
            request, point 4): shared cadence + question count for BOTH
            Advanced and Master titleholders' recurring defense (new
            title_defense_settings table, migration 0096), independent of
            the voluntary Formal/Master Exam content settings above.
            2026-10-07 (later): renamed from "Title Defense Exam", and
            gained its own error-tolerance field (migration 0097) — same
            "non-must-know misses allowed" meaning as Master Quiz's field
            above, now shared by an Advanced (Formal) defense too, which
            used to need a flat 100%. */}
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-rose-700">🛡️ Title Defense Quiz</h3>
          <div className="flex flex-wrap gap-4">
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">Questions per title defense quiz</span>
              <input
                type="number"
                className="input"
                value={titleDefenseQuestionCount}
                onChange={(e) => setTitleDefenseQuestionCount(Number(e.target.value))}
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
                  value={titleDefenseMonths}
                  onChange={(e) => setTitleDefenseMonths(Number(e.target.value))}
                />
                <span className="text-sm text-gray-400">months</span>
              </div>
            </label>
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-gray-500">Error tolerance (non-must-know misses allowed)</span>
              <input
                type="number"
                min={0}
                className="input"
                value={titleDefenseErrorTolerance}
                onChange={(e) => setTitleDefenseErrorTolerance(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Applies to both Advanced and Master titleholders' recurring title-defense re-sit — separate from the
            Formal/Master Exam content settings above, which only govern a voluntary attempt. Any missed
            must-know-linked question always fails the defense regardless of the tolerance above; tolerance only
            covers non-must-know misses. A failed defense instantly loses that title (Advanced → Practitioner,
            recoverable only via the Phase 3 Level-Up Exam; Master → Advanced, recoverable by retaking the Master
            Exam).
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
            The "% of quiz questions" setting above controls how much of all quizzes is auto-generated "fill in the
            ingredient quantity" questions from Formula Database recipes, rather than ordinary questions pulled from
            the Quiz Bank (Admin + Branch, weighted by the Importance mix above). The Top 10 weight — how many times
            more likely a fill-in-the-blank question about a ⭐ Top 10 drink is to be picked, versus any other
            memorized item (1 = no boost, 3 = default) — and the excluded-ingredients list below both apply the same
            way to all quizzes. All quizzes' version (except Formal Quiz) of these questions is always multiple
            choice. Formal Quiz's is a mix: a ⭐ Top 10 drink's question stays typed (most rigorous, for the drinks
            staff most need to know cold); every other drink's question is shown as multiple choice instead, but
            with deliberately hard-to-guess wrong answers (the closest real quantities on record, not random ones).
            This isn't a setting to tune — it's fixed behavior — and only applies to these auto-generated questions,
            not to a fill-in-the-blank question an admin wrote by hand in the Quiz Bank, which always stays typed.
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
