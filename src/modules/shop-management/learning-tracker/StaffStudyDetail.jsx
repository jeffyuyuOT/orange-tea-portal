import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { filterVisibleForStore } from '../../../lib/storeVisibility'
import StudyLogList from '../../dashboard/study-log/StudyLogList'
import ProgressChartModal from '../../dashboard/study-log/ProgressChartModal'
import StudySummaryModal from '../../dashboard/study-log/StudySummaryModal'
import AttemptDetailModal from '../../dashboard/study-log/AttemptDetailModal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Badge from '../../../components/ui/Badge'
import { rosterDisplayName } from '../../../lib/excelRoster'

const QUIZ_TYPE_LABEL = { quick: 'Quick Quiz', formal: 'Formal Quiz' }

// Jeff, 2026-09: "從learning tracker觀看某員工時，一樣將quiz history,
// progress chart跟study summary放在performance的tab (跟從my study log進去
//一樣)" — same second-level picker as StudyLogPage.jsx's own Performance
// tab (My Dashboard > Study Log), so both the self-view and this manager
// view organize the three the same way. Quiz History still renders as its
// own custom list here (not the shared QuizHistoryList) because this view,
// unlike the self-view, has the Pass checkbox/review flow (togglePass
// below) — that's the one piece that can't just delegate to the shared
// component.
const PERFORMANCE_VIEWS = [
  { key: 'history', label: '🧾 Quiz History' },
  { key: 'chart', label: '📈 Progress chart' },
  { key: 'summary', label: '📊 Study summary' },
]

export default function StaffStudyDetail({ staff, onBack }) {
  const { profile, currentStoreId } = useAuth()
  const [tab, setTab] = useState('progress') // 'progress' | 'performance'
  const [performanceView, setPerformanceView] = useState('history') // 'history' | 'chart' | 'summary'
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [openAttempt, setOpenAttempt] = useState(null)
  // Explicit, persisted flag (profiles.qualified — migration 0049) rather
  // than derived fresh from attempts every render, precisely so a
  // manager/admin can CANCEL it (cancelQualified below) without that
  // cancellation being immediately undone by past attempts that still sit
  // there with passed=true.
  const [qualified, setQualified] = useState(!!staff.qualified)
  // Bumped after markAllCurrentItemsMemorized writes a batch of
  // study_progress rows directly (bypassing StudyLogList's own state), so
  // it's used as part of that list's `key` below to force a remount/reload
  // instead of showing stale checkboxes.
  const [progressVersion, setProgressVersion] = useState(0)

  useEffect(() => {
    setQualified(!!staff.qualified)
  }, [staff.id, staff.qualified])

  function load() {
    setLoading(true)
    supabase
      .from('quiz_attempts')
      .select('*')
      .eq('profile_id', staff.id)
      .order('taken_at', { ascending: false })
      .then(({ data }) => {
        setAttempts(data ?? [])
        setLoading(false)
      })
  }
  useEffect(() => {
    load()
  }, [staff.id])

  // Every active formula item currently visible to this staff member's
  // store(s) — same visibility rule Study Log itself and the quiz builders
  // use (storeVisibility.js). Shared by getUnmemorizedItems (the Formal
  // Quiz Pass warning below) and markAllCurrentItemsMemorized (the
  // Qualified snapshot).
  async function visibleFormulaItems() {
    const [{ data: itemRows }, { data: storeRows }] = await Promise.all([
      supabase.from('formula_items').select('id, name_en, name_zh').eq('is_active', true),
      supabase.from('formula_item_stores').select('*'),
    ])
    return filterVisibleForStore(itemRows ?? [], storeRows ?? [], 'formula_item_id', currentStoreId)
  }

  // Jeff, 2026-09-30: "然後formal考試manager在審核的時候也只會check menu
  // item跟shop training並跳出警示說明哪裡還沒memorized。沒有被勾取menu
  // item的飲料等於非必要背記的飲料，但study log的勾選還是保留" (the flag
  // was renamed the same day, before shipping, to "Must-Know Items" and
  // extended to Shop Training too — see below) -- deliberately a SEPARATE
  // function from visibleFormulaItems() above (not just that one filtered)
  // since markAllCurrentItemsMemorized() ("Mark as Qualified") still
  // snapshots every visible item as memorized, must-know or not — only the
  // Formal Quiz Pass warning below narrows to must-know items.
  async function visibleMustKnowItems() {
    const [{ data: itemRows }, { data: storeRows }] = await Promise.all([
      supabase.from('formula_items').select('id, name_en, name_zh').eq('is_active', true).eq('is_must_know', true),
      supabase.from('formula_item_stores').select('*'),
    ])
    return filterVisibleForStore(itemRows ?? [], storeRows ?? [], 'formula_item_id', currentStoreId)
  }

  // Every visible Must-Know formula item + Must-Know Shop Training item this
  // staff member hasn't ticked "Memorized" for in Study Log yet. Used to
  // warn (not block — see togglePass below) a manager reviewing a Formal
  // Quiz Pass. Shop Training items don't carry a name_zh, so they're shaped
  // the same as a formula item (name_en/name_zh) purely so the warning
  // message below can list both kinds with the one .map() it already had.
  //
  // Jeff, 2026-09-30 (same-day revision): "shop training的部分也要有
  // Must-Know Items勾選選項" -- Shop Training items now carry their own
  // is_must_know flag (migration 0082) too, so this check is narrowed the
  // same way the drink side already is: only must-know Shop Training items
  // count as required here (a non-must-know one still keeps its own Study
  // Log "Memorized" self-tracking checkbox, just isn't required for
  // approval), mirroring the drink side exactly.
  async function getUnmemorizedItems() {
    const [mustKnowItems, { data: progressRows }, { data: trainingItems }, { data: trainingProgressRows }] = await Promise.all([
      visibleMustKnowItems(),
      supabase.from('study_progress').select('formula_item_id').eq('profile_id', staff.id).eq('memorized', true),
      currentStoreId
        ? supabase.from('shop_training_items').select('id, title').eq('store_id', currentStoreId).eq('is_must_know', true)
        : Promise.resolve({ data: [] }),
      supabase.from('shop_training_progress').select('shop_training_item_id').eq('profile_id', staff.id).eq('memorized', true),
    ])
    const memorizedIds = new Set((progressRows ?? []).map((p) => p.formula_item_id))
    const unmemorizedMustKnowItems = mustKnowItems.filter((i) => !memorizedIds.has(i.id))
    const memorizedTrainingIds = new Set((trainingProgressRows ?? []).map((p) => p.shop_training_item_id))
    const unmemorizedTraining = (trainingItems ?? [])
      .filter((i) => !memorizedTrainingIds.has(i.id))
      .map((i) => ({ id: i.id, name_en: i.title, name_zh: null }))
    return [...unmemorizedMustKnowItems, ...unmemorizedTraining]
  }

  // Jeff, 2026-09: becoming Qualified via the direct "Mark as Qualified"
  // button snapshots every currently active + visible formula item as
  // memorized right now (real study_progress rows, like the old "Mark all
  // memorized" action used to write) — that button's own confirm() dialog
  // tells the manager this up front. It's a one-time snapshot, not a
  // permanent lock: the staff member can still un-tick individual items
  // afterward in Study Log, and any formula added later still needs its
  // own manual tick, same as anyone else.
  //
  // Jeff, 2026-09 (later): a Formal Quiz Pass used to trigger this too, but
  // that silently overwrote study_progress to make it LOOK consistent with
  // the Pass — if a manager overrode the "hasn't ticked Memorized for every
  // item" warning below, everything that staff member hadn't actually
  // memorized got force-marked memorized anyway. Passing the quiz should
  // grant Qualified without rewriting what Study Log says they've actually
  // learned, so togglePass below no longer calls this — only the explicit
  // "Mark as Qualified" shortcut does.
  async function markAllCurrentItemsMemorized() {
    const visibleItems = await visibleFormulaItems()
    if (!visibleItems.length) return
    const now = new Date().toISOString()
    await supabase.from('study_progress').upsert(
      visibleItems.map((i) => ({ profile_id: staff.id, formula_item_id: i.id, memorized: true, memorized_at: now })),
      { onConflict: 'profile_id,formula_item_id' }
    )
    // StudyLogList loads its own progress on mount, not on qualified/
    // progress changes — force a reload so the checkboxes reflect the
    // batch we just wrote instead of appearing stale.
    setProgressVersion((v) => v + 1)
  }

  async function togglePass(attempt, checked) {
    // Ticking Pass on a Formal Quiz attempt is what grants Qualified in the
    // first place (same rule this used to be derived from before migration
    // 0049) — only grant, never revoke, from here: unchecking one attempt's
    // Pass (e.g. fixing a mis-click) shouldn't silently cancel Qualified —
    // that's a deliberate, confirmed action of its own (cancelQualified).
    // Jeff, 2026-09: this used to hard-block the Pass if any item wasn't
    // memorized yet — now it's a warning a manager can override, since a
    // staff member may know every drink but not yet have learned opening
    // duties (or similar), and a manager may still want to qualify them.
    if (attempt.quiz_type === 'formal' && checked && !qualified) {
      const unmemorized = await getUnmemorizedItems()
      if (
        unmemorized.length &&
        !confirm(
          `${rosterDisplayName(staff)} hasn't ticked "Memorized" for every formula item in Study Log yet.\n\nStill missing:\n${unmemorized
            .map((i) => `• ${i.name_en}${i.name_zh ? ` (${i.name_zh})` : ''}`)
            .join('\n')}\n\nMark this Pass — and grant Qualified — anyway?`
        )
      ) {
        return
      }
    }

    setAttempts((prev) =>
      prev.map((a) =>
        a.id === attempt.id
          ? { ...a, passed: checked, passed_by: checked ? profile.id : null, passed_at: checked ? new Date().toISOString() : null }
          : a
      )
    )
    await supabase
      .from('quiz_attempts')
      .update({ passed: checked, passed_by: checked ? profile.id : null, passed_at: checked ? new Date().toISOString() : null })
      .eq('id', attempt.id)

    if (attempt.quiz_type === 'formal' && checked && !qualified) {
      setQualified(true)
      await supabase
        .from('profiles')
        .update({ qualified: true, qualified_at: new Date().toISOString(), qualified_by: profile.id })
        .eq('id', staff.id)
      // No markAllCurrentItemsMemorized() here — see the comment on that
      // function above. Passing grants Qualified only; overriding the
      // unmemorized-items warning no longer rewrites study_progress, so
      // Study Log keeps showing what this staff member has actually ticked.
    }
  }

  // Direct grant, bypassing the Formal Quiz Pass flow (and its memorize-
  // warning above) entirely — Jeff wanted a way to mark someone Qualified
  // outright, e.g. an experienced hire, without staging a review.
  async function markQualified() {
    if (
      !confirm(
        `Mark ${rosterDisplayName(staff)} as Qualified?\n\nEvery formula item that's currently active will be marked memorized right away. They can still un-tick individual items afterward in Study Log, and any formula added later will still need its own manual tick.`
      )
    ) {
      return
    }
    setQualified(true)
    await supabase
      .from('profiles')
      .update({ qualified: true, qualified_at: new Date().toISOString(), qualified_by: profile.id })
      .eq('id', staff.id)
    await markAllCurrentItemsMemorized()
  }

  async function cancelQualified() {
    if (
      !confirm(
        `Cancel ${rosterDisplayName(staff)}'s Qualified status?\n\nFuture Formal Quiz attempts will need a manager/admin to review and tick Pass again, same as before they were qualified.`
      )
    ) {
      return
    }
    setQualified(false)
    await supabase
      .from('profiles')
      .update({ qualified: false, qualified_at: new Date().toISOString(), qualified_by: profile.id })
      .eq('id', staff.id)
  }

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm font-medium text-brand-600 hover:underline">
        ← All staff
      </button>
      <h1 className="mb-4 flex items-center gap-2 text-xl font-semibold text-gray-900">
        {rosterDisplayName(staff)}
        {qualified ? (
          <>
            <Badge color="green">Qualified</Badge>
            <button
              onClick={cancelQualified}
              className="text-xs font-medium text-red-500 hover:underline"
              title="Cancel Qualified status"
            >
              Cancel Qualified
            </button>
          </>
        ) : (
          <button
            onClick={markQualified}
            className="text-xs font-medium text-brand-600 hover:underline"
            title="Mark as Qualified directly, without a Formal Quiz review"
          >
            Mark as Qualified
          </button>
        )}
      </h1>

      <div className="mb-4 inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
        {[
          { key: 'progress', label: 'Learning & Progress' },
          { key: 'performance', label: 'Performance' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'progress' ? (
        <StudyLogList key={`${staff.id}-${progressVersion}`} profileId={staff.id} qualified={qualified} />
      ) : (
        <div>
          <div className="mb-4 flex w-fit items-center gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1">
            {PERFORMANCE_VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setPerformanceView(v.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  performanceView === v.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {loading ? (
            <LoadingSpinner />
          ) : !attempts.length ? (
            <EmptyState label="No quiz attempts yet." />
          ) : (
            <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
              {attempts.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-2.5">
                  <button onClick={() => setOpenAttempt(a)} className="flex flex-1 items-center gap-2 text-left">
                    <Badge color={a.quiz_type === 'formal' ? 'brand' : 'gray'}>{QUIZ_TYPE_LABEL[a.quiz_type] ?? 'Quick Quiz'}</Badge>
                    <span className="text-sm text-gray-700">{new Date(a.taken_at).toLocaleString()}</span>
                    <span className="text-sm font-medium text-brand-600">
                      {a.correct_count} / {a.total_questions}
                    </span>
                  </button>
                  {/* Passing a Formal Quiz isn't automatic from the SCORE — a
                      manager/admin reviews the attempt (Quiz History › click in
                      to see every answer) and ticks this themselves — UNLESS
                      this staff member is already Qualified, in which case
                      FormalQuizModal.jsx ticks this automatically at submit time
                      and no review is needed (see migration 0049 / the
                      Qualified badge above). */}
                  {a.quiz_type === 'formal' && (
                    <label className="flex shrink-0 items-center gap-1.5 text-sm text-gray-600">
                      <input type="checkbox" checked={!!a.passed} onChange={(e) => togglePass(a, e.target.checked)} />
                      Pass
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {openAttempt && (
        <AttemptDetailModal
          attempt={openAttempt}
          onClose={() => setOpenAttempt(null)}
          quizTypeLabel={QUIZ_TYPE_LABEL[openAttempt.quiz_type] ?? 'Quick Quiz'}
        />
      )}
      {/* Same Progress chart / Study summary modals as "My Dashboard > Study
          Log" (StudyLogPage.jsx) — this is a manager/admin looking at one
          specific staff member's own data instead of their own, so both
          take `staff.id`, not the logged-in profile's id. */}
      {performanceView === 'chart' && tab === 'performance' && (
        <ProgressChartModal profileId={staff.id} onClose={() => setPerformanceView('history')} />
      )}
      {performanceView === 'summary' && tab === 'performance' && (
        <StudySummaryModal profileId={staff.id} onClose={() => setPerformanceView('history')} />
      )}
    </div>
  )
}
