import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'

// One quiz attempt's full breakdown — every question asked, what the
// person picked vs. the correct answer, wrong ones highlighted. Shared by
// "My Dashboard > Study Log" (own history) and "Shop Management > Learning
// Tracker" (a manager looking at a staff member's history).
export default function AttemptDetailModal({ attempt, onClose }) {
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
        Score: {attempt.correct_count} out of {attempt.total_questions}
      </p>
      <ul className="space-y-2">
        {rows.map((r) => {
          const questionText = r.quiz_questions?.question ?? r.generated_question
          const correctChoice = r.quiz_questions?.correct_choice ?? r.generated_correct_choice
          return (
            <li
              key={r.id}
              className={`rounded-lg border px-3 py-2 text-sm ${r.is_correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              <p className="font-medium text-gray-800">
                {questionText}
                {r.is_generated && <span className="ml-1.5 text-xs font-normal text-brand-400">(formula)</span>}
              </p>
              <p className="text-xs text-gray-500">
                Selected: {r.selected_choice ?? '—'} · Correct: {correctChoice}
                {!r.is_correct && <span className="ml-1.5 font-medium text-red-500">✕ wrong</span>}
              </p>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
