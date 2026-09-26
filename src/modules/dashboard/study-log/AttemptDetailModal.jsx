import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'

// Full option list for a 'choice' or 'multi' question — every A/B/C/D with
// its actual text (not just the letter), so the review reads like the quiz
// itself instead of a bare "Selected: A · Correct: B". Each row is tagged
// with what the person picked vs. what was actually correct.
function ChoiceOptionsList({ choices, selectedKeys, correctKeys }) {
  if (!choices || !choices.length) return null
  return (
    <ul className="mt-1.5 space-y-1">
      {choices.map((c) => {
        const isSelected = selectedKeys.includes(c.key)
        const isCorrect = correctKeys.includes(c.key)
        return (
          <li
            key={c.key}
            className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-xs ${
              isCorrect ? 'bg-green-100 text-green-800' : isSelected ? 'bg-red-100 text-red-700' : 'bg-white text-gray-600'
            }`}
          >
            <span className="font-semibold">{c.key}.</span>
            <span className="flex-1">{c.text}</span>
            {isCorrect && <span className="shrink-0 font-medium">✓{isSelected ? ' your answer' : ''}</span>}
            {isSelected && !isCorrect && <span className="shrink-0 font-medium">✕ your answer</span>}
          </li>
        )
      })}
    </ul>
  )
}

// One quiz attempt's full breakdown — every question asked, what the
// person picked vs. the correct answer, wrong ones highlighted. Shared by
// "My Dashboard > Study Log" (own history) and "Shop Management > Learning
// Tracker" (a manager looking at a staff member's history).
//
// Renders whichever of the three question types (see migration 0043) the
// row actually is: 'choice' (default, covers both curated single-choice and
// the auto-generated "formula" questions from Quick Quiz — those carry no
// quiz_questions row, so they fall back to their own generated_* snapshot),
// 'multi', and 'fill_blank' (its own text snapshot, whether it came from the
// Quiz Bank or was auto-generated from a recipe — see migration 0033/0043).
// `quizTypeLabel` lets a caller show "Formal Quiz on ..." / "Quick Quiz on
// ..." instead of the generic "Quiz on ..." title.
export default function AttemptDetailModal({ attempt, onClose, quizTypeLabel }) {
  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setLoaded(false)
    supabase
      .from('quiz_attempt_answers')
      .select('*, quiz_questions(question, correct_choice, correct_choices, choices, image_path)')
      .eq('attempt_id', attempt.id)
      .then(({ data }) => {
        setRows(data ?? [])
        setLoaded(true)
      })
  }, [attempt.id])

  return (
    <Modal open onClose={onClose} wide title={`${quizTypeLabel ?? 'Quiz'} on ${new Date(attempt.taken_at).toLocaleString()}`}>
      <p className="mb-3 text-sm text-gray-500">
        Score: {attempt.correct_count} out of {attempt.total_questions}
      </p>
      {/* This should only ever be empty if saving the per-question detail
          failed at submit time (see the error check now added to both
          QuickQuizModal.jsx and FormalQuizModal.jsx's submit()) — the score
          above still comes from quiz_attempts, which is a separate insert,
          so it can show up even when this detail never got saved. Telling
          them plainly beats a silently blank modal that looks broken. */}
      {loaded && !rows.length && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          No question detail was saved for this attempt.
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((r) => {
          const qType = r.question_type ?? 'choice'
          const image = r.quiz_questions?.image_path
          return (
            <li
              key={r.id}
              className={`rounded-lg border px-3 py-2 text-sm ${r.is_correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              {qType === 'fill_blank' ? (
                <>
                  <p className="font-medium text-gray-800">{r.question_text}</p>
                  {image && (
                    <img
                      src={supabase.storage.from('documents').getPublicUrl(image).data.publicUrl}
                      alt=""
                      className="my-1 max-h-32 rounded-lg border border-gray-200 object-contain"
                    />
                  )}
                  <p className="text-xs text-gray-500">
                    Selected: {r.answer_text || '—'} · Correct: {r.correct_answer_text}
                    {!r.is_correct && <span className="ml-1.5 font-medium text-red-500">✕ wrong</span>}
                  </p>
                </>
              ) : qType === 'multi' ? (
                <>
                  <p className="font-medium text-gray-800">{r.quiz_questions?.question}</p>
                  {image && (
                    <img
                      src={supabase.storage.from('documents').getPublicUrl(image).data.publicUrl}
                      alt=""
                      className="my-1 max-h-32 rounded-lg border border-gray-200 object-contain"
                    />
                  )}
                  <ChoiceOptionsList
                    choices={r.quiz_questions?.choices}
                    selectedKeys={r.selected_choices ?? []}
                    correctKeys={r.quiz_questions?.correct_choices ?? []}
                  />
                </>
              ) : (
                <>
                  <p className="font-medium text-gray-800">
                    {r.quiz_questions?.question ?? r.generated_question}
                    {r.is_generated && <span className="ml-1.5 text-xs font-normal text-brand-400">(formula)</span>}
                  </p>
                  {image && (
                    <img
                      src={supabase.storage.from('documents').getPublicUrl(image).data.publicUrl}
                      alt=""
                      className="my-1 max-h-32 rounded-lg border border-gray-200 object-contain"
                    />
                  )}
                  <ChoiceOptionsList
                    choices={r.quiz_questions?.choices ?? r.generated_choices}
                    selectedKeys={r.selected_choice ? [r.selected_choice] : []}
                    correctKeys={
                      r.quiz_questions?.correct_choice ?? r.generated_correct_choice
                        ? [r.quiz_questions?.correct_choice ?? r.generated_correct_choice]
                        : []
                    }
                  />
                </>
              )}
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
