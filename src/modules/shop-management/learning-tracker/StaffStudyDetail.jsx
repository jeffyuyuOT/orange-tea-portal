import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import StudyLogList from '../../dashboard/study-log/StudyLogList'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Modal from '../../../components/ui/Modal'
import { rosterDisplayName } from '../../../lib/excelRoster'

export default function StaffStudyDetail({ staff, onBack }) {
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [openAttempt, setOpenAttempt] = useState(null)

  useEffect(() => {
    supabase
      .from('quiz_attempts')
      .select('*')
      .eq('profile_id', staff.id)
      .order('taken_at', { ascending: false })
      .then(({ data }) => {
        setAttempts(data ?? [])
        setLoading(false)
      })
  }, [staff.id])

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm font-medium text-brand-600 hover:underline">
        ← All staff
      </button>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">{rosterDisplayName(staff)}</h1>

      <h2 className="mb-2 text-sm font-semibold text-brand-700">Study Log</h2>
      <StudyLogList profileId={staff.id} allowBulkSelect />

      <h2 className="mb-2 mt-6 text-sm font-semibold text-brand-700">Quick Quiz History</h2>
      {loading ? (
        <LoadingSpinner />
      ) : !attempts.length ? (
        <EmptyState label="No quiz attempts yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {attempts.map((a) => (
            <button
              key={a.id}
              onClick={() => setOpenAttempt(a)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-brand-50"
            >
              <span className="text-sm text-gray-700">{new Date(a.taken_at).toLocaleString()}</span>
              <span className="text-sm font-medium text-brand-600">
                {a.correct_count} / {a.total_questions}
              </span>
            </button>
          ))}
        </div>
      )}

      {openAttempt && <AttemptDetailModal attempt={openAttempt} onClose={() => setOpenAttempt(null)} />}
    </div>
  )
}

function AttemptDetailModal({ attempt, onClose }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    supabase
      .from('quiz_attempt_answers')
      .select('*, quiz_questions(question, correct_choice, choices)')
      .eq('attempt_id', attempt.id)
      .then(({ data }) => setRows(data ?? []))
  }, [attempt.id])

  return (
    <Modal open onClose={onClose} wide title={`Quiz on ${new Date(attempt.taken_at).toLocaleString()}`}>
      <p className="mb-3 text-sm text-gray-500">
        Score: {attempt.correct_count} / {attempt.total_questions}
      </p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={`rounded-lg border px-3 py-2 text-sm ${r.is_correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <p className="font-medium text-gray-800">{r.quiz_questions?.question}</p>
            <p className="text-xs text-gray-500">
              Selected: {r.selected_choice ?? '—'} · Correct: {r.quiz_questions?.correct_choice}
            </p>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
