import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { filterVisibleForStore } from '../../../lib/storeVisibility'
import StudyLogList from './StudyLogList'
import QuickQuizModal from './QuickQuizModal'
import FormalQuizModal from './FormalQuizModal'
import ProgressChartModal from './ProgressChartModal'
import StudySummaryModal from './StudySummaryModal'
import QuizHistoryList from './QuizHistoryList'
import Button from '../../../components/ui/Button'

// Second-level picker inside the "Performance" tab — Progress chart / Study
// summary open as the same modal popups they always have (ProgressChartModal
// / StudySummaryModal are shared with Shop Management > Learning Tracker's
// StaffStudyDetail.jsx, which also opens them as popups, so this keeps both
// call sites consistent instead of forking a second, inline-only version).
// Quiz History has no modal of its own — QuizHistoryList is already a plain
// list that opens AttemptDetailModal itself on row click — so it renders
// directly in the tab body and is the default view.
const PERFORMANCE_VIEWS = [
  { key: 'history', label: '🧾 Quiz History' },
  { key: 'chart', label: '📈 Progress chart' },
  { key: 'summary', label: '📊 Study summary' },
]

export default function StudyLogPage() {
  const { profile, currentStoreId } = useAuth()
  const qualified = !!profile?.qualified
  const [tab, setTab] = useState('log') // 'log' | 'performance'
  const [performanceView, setPerformanceView] = useState('history')
  const [showQuiz, setShowQuiz] = useState(false)
  const [showFormalQuiz, setShowFormalQuiz] = useState(false)
  // The memorized % as of the last check (below), stamped onto whichever
  // Quick Quiz gets opened next — voluntary or forced — as
  // quiz_attempts.progress_snapshot, so the forced-quiz check always knows
  // which 10% band was last cleared, whether the person quizzed on their
  // own or was made to.
  const [progressPercent, setProgressPercent] = useState(null)
  const [forcedQuiz, setForcedQuiz] = useState(false)

  // Jeff's spec: every 10% of study progress a (non-Qualified) staff member
  // crosses, without having quizzed — voluntarily or otherwise — since the
  // last one, forces a Quick Quiz before they can keep going. Re-run on
  // mount and every time Study Log's own checkboxes report a change
  // (StudyLogList's onProgressChange). Qualified staff (profiles.qualified)
  // are exempt entirely, same as the auto-memorize-everything rule.
  const checkForcedQuiz = useCallback(async () => {
    if (qualified || !profile?.id) {
      setProgressPercent(null)
      return
    }
    const [{ data: itemRows }, { data: storeRows }, { data: progressRows }, { data: attemptRows }] = await Promise.all([
      supabase.from('formula_items').select('id').eq('is_active', true),
      supabase.from('formula_item_stores').select('*'),
      supabase.from('study_progress').select('formula_item_id').eq('profile_id', profile.id).eq('memorized', true),
      supabase
        .from('quiz_attempts')
        .select('progress_snapshot')
        .eq('profile_id', profile.id)
        .eq('quiz_type', 'quick')
        .not('progress_snapshot', 'is', null)
        .order('progress_snapshot', { ascending: false })
        .limit(1),
    ])
    const visibleItems = filterVisibleForStore(itemRows ?? [], storeRows ?? [], 'formula_item_id', currentStoreId)
    const total = visibleItems.length
    const memorizedIds = new Set((progressRows ?? []).map((p) => p.formula_item_id))
    const memorizedCount = visibleItems.filter((i) => memorizedIds.has(i.id)).length
    const percent = total ? Math.floor((memorizedCount / total) * 100) : 0
    setProgressPercent(percent)

    const lastCleared = attemptRows?.[0]?.progress_snapshot ?? 0
    const band = Math.floor(percent / 10)
    const lastBand = Math.floor(lastCleared / 10)
    if (band > lastBand && band >= 1) setForcedQuiz(true)
  }, [qualified, profile?.id, currentStoreId])

  useEffect(() => {
    checkForcedQuiz()
  }, [checkForcedQuiz])

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
        {[
          { key: 'log', label: 'Study Log' },
          { key: 'performance', label: 'Performance' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'log' ? (
        <StudyLogList
          profileId={profile?.id}
          qualified={qualified}
          onProgressChange={checkForcedQuiz}
          headerActions={
            <div className="flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 p-1">
              <Button className="!px-3 !py-1.5 text-xs" onClick={() => setShowQuiz(true)}>
                🧠 Quick Quiz
              </Button>
              <Button className="!px-3 !py-1.5 text-xs" variant="secondary" onClick={() => setShowFormalQuiz(true)}>
                📝 Formal Quiz
              </Button>
            </div>
          }
        />
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
          <QuizHistoryList profileId={profile?.id} />
        </div>
      )}

      {(showQuiz || forcedQuiz) && (
        <QuickQuizModal
          forced={forcedQuiz}
          progressPercent={progressPercent}
          onClose={() => setShowQuiz(false)}
          onCompleted={() => {
            setShowQuiz(false)
            setForcedQuiz(false)
            checkForcedQuiz()
          }}
        />
      )}
      {showFormalQuiz && <FormalQuizModal onClose={() => setShowFormalQuiz(false)} />}
      {performanceView === 'chart' && tab === 'performance' && (
        <ProgressChartModal profileId={profile?.id} onClose={() => setPerformanceView('history')} />
      )}
      {performanceView === 'summary' && tab === 'performance' && (
        <StudySummaryModal profileId={profile?.id} onClose={() => setPerformanceView('history')} />
      )}
    </div>
  )
}
