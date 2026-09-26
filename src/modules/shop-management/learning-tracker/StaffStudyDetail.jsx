import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import StudyLogList from '../../dashboard/study-log/StudyLogList'
import ProgressChartModal from '../../dashboard/study-log/ProgressChartModal'
import StudySummaryModal from '../../dashboard/study-log/StudySummaryModal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Modal from '../../../components/ui/Modal'
import Badge from '../../../components/ui/Badge'
import { rosterDisplayName } from '../../../lib/excelRoster'

const QUIZ_TYPE_LABEL = { quick: 'Quick Quiz', formal: 'Formal Quiz' }

// Multi-choice review just shows the answer keys picked (e.g. "A, C"), same
// as single-choice review shows the one key — no need to look up choice text.
function formatChoiceKeys(keys) {
  return keys && keys.length ? keys.join(', ') : '—'
}

export default function StaffStudyDetail({ staff, onBack }) {
  const { profile } = useAuth()
  const [tab, setTab] = useState('progress')
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [openAttempt, setOpenAttempt] = useState(null)
  const [showProgressChart, setShowProgressChart] = useState(false)
  const [showSummary, setShowSummary] = useState(false)

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

  // Qualified = at least one Formal Quiz attempt a manager/admin has ticked
  // as a pass — same rule the Learning Tracker list badge uses.
  const qualified = attempts.some((a) => a.quiz_type === 'formal' && a.passed)

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
  }

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm font-medium text-brand-600 hover:underline">
        ← All staff
      </button>
      <h1 className="mb-4 flex items-center gap-2 text-xl font-semibold text-gray-900">
        {rosterDisplayName(staff)}
        {qualified && <Badge color="green">Qualified</Badge>}
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
              {/* Passing a Formal Quiz isn't automatic from the score — a
                  manager/admin reviews the attempt (Quiz History › click
                  in to see every answer) and ticks this themselves. */}
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

      {openAttempt && <AttemptDetailModal attempt={openAttempt} onClose={() => setOpenAttempt(null)} />}
      {showProgressChart && <ProgressChartModal profileId={staff.id} onClose={() => setShowProgressChart(false)} />}
      {showSummary && <StudySummaryModal profileId={staff.id} onClose={() => setShowSummary(false)} />}
    </div>
  )
}

function AttemptDetailModal({ attempt, onClose }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    supabase
      .from('quiz_attempt_answers')
      .select('*, quiz_questions(question, correct_choice, correct_choices, choices)')
      .eq('attempt_id', attempt.id)
      .then(({ data }) => setRows(data ?? []))
  }, [attempt.id])

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`${QUIZ_TYPE_LABEL[attempt.quiz_type] ?? 'Quick Quiz'} on ${new Date(attempt.taken_at).toLocaleString()}`}
    >
      <p className="mb-3 text-sm text-gray-500">
        Score: {attempt.correct_count} / {attempt.total_questions}
      </p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={`rounded-lg border px-3 py-2 text-sm ${r.is_correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            {r.question_type === 'fill_blank' ? (
              <>
                <p className="font-medium text-gray-800">{r.question_text}</p>
                <p className="text-xs text-gray-500">
                  Answered: {r.answer_text || '—'} · Correct: {r.correct_answer_text}
                </p>
              </>
            ) : r.question_type === 'multi' ? (
              <>
                <p className="font-medium text-gray-800">{r.quiz_questions?.question}</p>
                <p className="text-xs text-gray-500">
                  Selected: {formatChoiceKeys(r.selected_choices)} · Correct: {formatChoiceKeys(r.quiz_questions?.correct_choices)}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-gray-800">{r.quiz_questions?.question}</p>
                <p className="text-xs text-gray-500">
                  Selected: {r.selected_choice ?? '—'} · Correct: {r.quiz_questions?.correct_choice}
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
