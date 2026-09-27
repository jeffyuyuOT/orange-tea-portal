import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import StudyLogList from '../../dashboard/study-log/StudyLogList'
import ProgressChartModal from '../../dashboard/study-log/ProgressChartModal'
import StudySummaryModal from '../../dashboard/study-log/StudySummaryModal'
import AttemptDetailModal from '../../dashboard/study-log/AttemptDetailModal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Badge from '../../../components/ui/Badge'
import { rosterDisplayName } from '../../../lib/excelRoster'

const QUIZ_TYPE_LABEL = { quick: 'Quick Quiz', formal: 'Formal Quiz' }

export default function StaffStudyDetail({ staff, onBack }) {
  const { profile } = useAuth()
  const [tab, setTab] = useState('progress')
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [openAttempt, setOpenAttempt] = useState(null)
  const [showProgressChart, setShowProgressChart] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  // Explicit, persisted flag (profiles.qualified — migration 0049) rather
  // than derived fresh from attempts every render, precisely so a
  // manager/admin can CANCEL it (cancelQualified below) without that
  // cancellation being immediately undone by past attempts that still sit
  // there with passed=true.
  const [qualified, setQualified] = useState(!!staff.qualified)

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

  async function togglePass(attempt, checked) {
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

    // Ticking Pass on a Formal Quiz attempt is what grants Qualified in the
    // first place (same rule this used to be derived from before migration
    // 0049) — only grant, never revoke, from here: unchecking one attempt's
    // Pass (e.g. fixing a mis-click) shouldn't silently cancel Qualified —
    // that's a deliberate, confirmed action of its own (cancelQualified).
    if (attempt.quiz_type === 'formal' && checked && !qualified) {
      setQualified(true)
      await supabase
        .from('profiles')
        .update({ qualified: true, qualified_at: new Date().toISOString(), qualified_by: profile.id })
        .eq('id', staff.id)
    }
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
        {qualified && (
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
        )}
      </h1>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
          {[
            { key: 'progress', label: 'Learning & Progress' },
            { key: 'history', label: 'Quiz History' },
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
        {/* Same Progress chart / Study summary buttons as "My Dashboard >
            Study Log" (see StudyLogPage.jsx) — this is a manager/admin
            looking at one specific staff member's own data instead of their
            own, so both modals here take `staff.id`, not the logged-in
            profile's id. */}
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1">
          <button
            onClick={() => setShowProgressChart(true)}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-white hover:shadow-sm"
          >
            📈 Progress chart
          </button>
          <button
            onClick={() => setShowSummary(true)}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-white hover:shadow-sm"
          >
            📊 Study summary
          </button>
        </div>
      </div>

      {tab === 'progress' ? (
        <StudyLogList profileId={staff.id} allowBulkSelect />
      ) : loading ? (
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

      {openAttempt && (
        <AttemptDetailModal
          attempt={openAttempt}
          onClose={() => setOpenAttempt(null)}
          quizTypeLabel={QUIZ_TYPE_LABEL[openAttempt.quiz_type] ?? 'Quick Quiz'}
        />
      )}
      {showProgressChart && <ProgressChartModal profileId={staff.id} onClose={() => setShowProgressChart(false)} />}
      {showSummary && <StudySummaryModal profileId={staff.id} onClose={() => setShowSummary(false)} />}
    </div>
  )
}
