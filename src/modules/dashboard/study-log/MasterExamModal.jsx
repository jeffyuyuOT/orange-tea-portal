import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { buildMasterExamQuestionSet } from '../../../lib/examBuilders'
import { gradeQuestion } from '../../../lib/quizGrading'
import { recordMasterExamResult } from '../../../lib/trainingJourney'

// The real Master Exam — reachable once phase 6 is 100% memorized (first
// attempt) or whenever a Master-titled profile wants to re-earn Master after
// losing it (voluntary retry, isDefense=false) or once title_defense_due_at
// has passed while still holding Master (isDefense=true). Self-graded in
// both cases, using master_quiz_settings.error_tolerance: any missed
// must-know-linked question fails outright regardless of tolerance; a
// failed DEFENSE (not a voluntary retry) immediately drops Master back to
// Advanced — no 3-strike grace like Formal Exam's defense.
export default function MasterExamModal({ isDefense = false, onClose, onResult }) {
  const { profile, currentStoreId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState([])
  const [reason, setReason] = useState(null)
  const [errorTolerance, setErrorTolerance] = useState(0)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    buildMasterExamQuestionSet(currentStoreId, { isDefense }).then((res) => {
      setQuestions(res.questions)
      setReason(res.reason)
      setErrorTolerance(res.errorTolerance ?? 0)
      setLoading(false)
    })
  }, [currentStoreId, isDefense])

  async function submit() {
    setSubmitting(true)
    let correct = 0
    let wrongMustKnow = 0
    let wrongOther = 0
    const answerRows = questions.map((q) => {
      const { isCorrect, row } = gradeQuestion(q, answers)
      if (isCorrect) correct += 1
      else if (q.isMustKnow) wrongMustKnow += 1
      else wrongOther += 1
      return row
    })
    const total = questions.length
    const passed = wrongMustKnow === 0 && wrongOther <= errorTolerance

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .insert({
        profile_id: profile.id,
        store_id: currentStoreId,
        quiz_type: 'master',
        total_questions: total,
        correct_count: correct,
        passed,
        passed_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (attempt) {
      const { error } = await supabase.from('quiz_attempt_answers').insert(answerRows.map((r) => ({ ...r, attempt_id: attempt.id })))
      if (error) console.error('Failed to save quiz answer detail:', error)
    }
    const outcome = await recordMasterExamResult(profile.id, passed, { wasDefense: isDefense })
    setResult({ correct, total, passed, lostMaster: outcome.lostMaster })
    setSubmitting(false)
  }

  function finish() {
    onResult?.({ passed: result?.passed, lostMaster: result?.lostMaster })
    onClose()
  }

  return (
    <Modal open onClose={onClose} wide title={isDefense ? 'Master Exam — Title Defense' : 'Master Exam'}>
      {loading ? (
        <LoadingSpinner />
      ) : result ? (
        <div className="py-6 text-center">
          <p className="text-3xl font-bold text-brand-600">
            {result.correct} out of {result.total}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {result.passed
              ? '🏆 Passed — you hold the Master title.'
              : result.lostMaster
                ? "That defense didn't pass — you've lost the Master title and are back to Advanced. You can retake the Master Exam any time to earn it back."
                : 'Not quite — every must-know question needs to be correct. Review and try again when ready.'}
          </p>
          <Button className="mt-4" onClick={finish}>
            Done
          </Button>
        </div>
      ) : !questions.length ? (
        <EmptyState label={reason === 'no_questions' ? 'No quiz questions available yet.' : 'Nothing to quiz on yet.'} />
      ) : (
        <div className="space-y-5">
          {questions.map((q, idx) => {
            const qType = q.type ?? 'choice'
            const key = q.localId ?? q.id
            return (
              <div key={key}>
                <p className="mb-2 whitespace-pre-wrap text-sm font-medium text-gray-800">
                  {idx + 1}. {q.question}
                </p>
                {q.image_path && (
                  <img
                    src={supabase.storage.from('documents').getPublicUrl(q.image_path).data.publicUrl}
                    alt=""
                    className="mb-2 max-h-48 rounded-lg border border-gray-200 object-contain"
                  />
                )}
                {qType === 'fill_blank' ? (
                  <input
                    type="text"
                    className="input"
                    placeholder="Type your answer…"
                    value={answers[key] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                ) : (
                  <div className="space-y-1.5">
                    {(q.choices ?? []).map((c) => {
                      const checked = qType === 'multi' ? (answers[key] ?? []).includes(c.key) : answers[key] === c.key
                      return (
                        <label
                          key={c.key}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                            checked ? 'border-brand-400 bg-brand-50' : 'border-gray-200'
                          }`}
                        >
                          <input
                            type={qType === 'multi' ? 'checkbox' : 'radio'}
                            name={qType === 'multi' ? undefined : key}
                            checked={checked}
                            onChange={(e) =>
                              setAnswers((prev) => {
                                if (qType !== 'multi') return { ...prev, [key]: c.key }
                                const current = prev[key] ?? []
                                return { ...prev, [key]: e.target.checked ? [...current, c.key] : current.filter((k) => k !== c.key) }
                              })
                            }
                          />
                          {c.text}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting ? 'Submitting…' : 'Submit Exam'}
          </Button>
        </div>
      )}
    </Modal>
  )
}
