import { isAnswerAccepted } from './answerMatching'

// Shared by every quiz-taking surface (Take a Quiz's three modes, the real
// Level-Up/Formal/Master Exam modals) — every quiz_attempt_answers row ships
// with this exact full set of keys, with whichever ones don't apply to that
// question type set to null explicitly, instead of omitted. That's not
// cosmetic: the whole answer set goes to Supabase as ONE bulk insert, and
// PostgREST derives its INSERT column list from the union of keys across
// every row in the batch — a row that omits a key some OTHER row in the
// same batch has gets an explicit NULL for it, not the column's database
// default. Keeping every row's shape identical avoids a silent whole-batch
// insert failure however the columns change in the future.
export const BLANK_ANSWER_ROW = {
  question_id: null,
  question_type: 'choice',
  selected_choice: null,
  selected_choices: null,
  question_text: null,
  correct_answer_text: null,
  answer_text: null,
  is_correct: false,
  is_generated: false,
  generated_question: null,
  generated_choices: null,
  generated_correct_choice: null,
}

// Grades one question against the `answers` map (keyed by q.localId ?? q.id)
// and returns both the boolean verdict and the quiz_attempt_answers row to
// insert for it. `q.type` is one of 'choice' | 'multi' | 'fill_blank'.
export function gradeQuestion(q, answers) {
  const qType = q.type ?? 'choice'
  const key = q.localId ?? q.id

  if (qType === 'multi') {
    const selected = answers[key] ?? []
    const correctSet = new Set(q.correct_choices ?? [])
    const selectedSet = new Set(selected)
    const isCorrect = correctSet.size === selectedSet.size && [...correctSet].every((k) => selectedSet.has(k))
    return {
      isCorrect,
      row: { ...BLANK_ANSWER_ROW, question_id: q.id, question_type: 'multi', selected_choices: selected, is_correct: isCorrect },
    }
  }

  if (qType === 'fill_blank') {
    const typed = answers[key] ?? ''
    const correctAnswer = q.correctAnswer ?? q.answer_text
    const isCorrect = isAnswerAccepted(typed, correctAnswer, q.acceptedAnswers ?? q.accepted_answers)
    return {
      isCorrect,
      row: {
        ...BLANK_ANSWER_ROW,
        question_id: q.isGenerated ? null : q.id ?? null,
        question_type: 'fill_blank',
        question_text: q.question,
        correct_answer_text: correctAnswer,
        answer_text: typed,
        is_correct: isCorrect,
      },
    }
  }

  const isCorrect = answers[key] === q.correct_choice
  if (q.isGenerated) {
    return {
      isCorrect,
      row: {
        ...BLANK_ANSWER_ROW,
        question_id: null,
        question_type: 'choice',
        selected_choice: answers[key] ?? null,
        is_correct: isCorrect,
        is_generated: true,
        generated_question: q.question,
        generated_choices: q.choices,
        generated_correct_choice: q.correct_choice,
      },
    }
  }
  return {
    isCorrect,
    row: { ...BLANK_ANSWER_ROW, question_id: q.id, question_type: 'choice', selected_choice: answers[key] ?? null, is_correct: isCorrect },
  }
}
