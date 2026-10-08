import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { buildLevelUpExamQuestionSet } from '../../../lib/examBuilders'
import { gradeQuestion } from '../../../lib/quizGrading'
import { startAdvancedDefenseClock } from '../../../lib/trainingJourney'

// A Phase 1-3 Level-Up Exam — self-graded. Drawn from must-know items across
// every phase up to and including `phaseNumber`. On pass, bumps
// profiles.training_journey_phase and tells the parent (TrainingJourneyPage)
// to show the "🎉 Congratulations, Level-Up Unlocked!" celebration.
//
// Jeff originally: "要全部都答對才能通過這個phase" — every question had to be
// correct, no tolerance. Jeff, 2026-10-08: "各個phase level up exam題數設置
// 後面也新增容錯率題數設置" — each phase now has its own error-tolerance
// count (`training_journey_phases.level_up_error_tolerance`, migration
// 0099, admin-configurable in PhaseSettingTab.jsx), passed in as
// `errorTolerance` and defaulting to 0 (the original all-correct behavior)
// when unset.
//
// Jeff, 2026-10-07 (8-point phase-merge request, point 8): `recoversQualified`
// is true only when a previously-qualified, now-disqualified profile is
// retaking Phase 3's Level-Up Exam to recover from a lost Advanced title —
// per Jeff, that recovery path is Level-Up-Exam-only, never a new Formal
// Exam review. On pass in that case, this also restores `qualified: true`
// and restarts the Advanced title-defense clock, without touching Formal
// Exam at all.
//
// Jeff, 2026-10-08: briefly removed for Phase 3 entirely (recovery routed
// through Formal Exam instead), then reverted the same day once we confirmed
// this — not a first-time promotion — was what Phase 3's setting was always
// for. See PhaseSettingTab.jsx's comment for the full back-and-forth.
export default function LevelUpExamModal({ phaseNumber, phaseLabel, errorTolerance = 0, recoversQualified, onClose, onPassed }) {
  const { profile, currentStoreId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState([])
  const [reason, setReason] = useState(null)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    buildLevelUpExamQuestionSet(currentStoreId, phaseNumber).then((res) => {
      setQuestions(res.questions)
      setReason(res.reason)
      setLoading(false)
    })
  }, [currentStoreId, phaseNumber])

  async function submit() {
    setSubmitting(true)
    let correct = 0
    const answerRows = questions.map((q) => {
      const { isCorrect, row } = gradeQuestion(q, answers)
      if (isCorrect) correct += 1
      return row
    })
    const total = questions.length
    const passed = total - correct <= errorTolerance

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .insert({
        profile_id: profile.id,
        store_id: currentStoreId,
        quiz_type: 'level_up',
        phase_number: phaseNumber,
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
    if (passed) {
      await supabase
        .from('profiles')
        .update({ training_journey_phase: phaseNumber, ...(recoversQualified ? { qualified: true, qualified_at: new Date().toISOString() } : {}) })
        .eq('id', profile.id)
      if (recoversQualified) await startAdvancedDefenseClock(profile.id)
    }
    setResult({ correct, total, passed })
    setSubmitting(false)
  }

  function finish() {
    if (result?.passed) onPassed()
    else onClose()
  }

  return (
    <Modal open onClose={onClose} wide title={`Level-Up Exam — Phase ${phaseNumber}: ${phaseLabel}`}>
      {loading ? (
        <LoadingSpinner />
      ) : result ? (
        <div className="py-6 text-center">
          <p className="text-3xl font-bold text-brand-600">
            {result.correct} out of {result.total}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {result.passed
              ? 'You leveled up!'
              : errorTolerance > 0
                ? `Up to ${errorTolerance} wrong answer${errorTolerance === 1 ? '' : 's'} is OK, but you missed more than that this time — give it another go once you review.`
                : 'Every question needs to be correct to level up — give it another go once you review.'}
          </p>
          <Button className="mt-4" onClick={finish}>
            {result.passed ? 'Continue' : 'Close'}
          </Button>
        </div>
      ) : !questions.length ? (
        <EmptyState label={reason === 'no_questions' ? 'No Level-Up Exam questions set up yet for this phase.' : 'Nothing to quiz on yet.'} />
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
