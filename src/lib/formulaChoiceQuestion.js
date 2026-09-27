// Shared "turn a recorded formula quantity into a 4-option multiple-choice
// question" logic — originally lived only inside QuickQuizModal.jsx, moved
// here (same reasoning as quizSelection.js's weightedSample) so Formal
// Quiz's auto-generated ingredient-quantity questions can be presented as
// multiple choice too, when Quiz Bank > Setting's "% shown as multiple
// choice" is turned up (see migration 0050), without a second copy of this
// logic drifting out of sync.

const CHOICE_KEYS = ['A', 'B', 'C', 'D']

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// "30g" -> { value: 30, suffix: "g" }; "2 pumps" -> { value: 2, suffix: " pumps" }.
// Anything that doesn't start with a number (e.g. "a pinch") is unparseable.
function parseQuantity(text) {
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec((text ?? '').trim())
  if (!m) return null
  return { value: parseFloat(m[1]), suffix: m[2] }
}

// Falls back to synthesized wrong answers (scaled versions of the real
// quantity) when there aren't enough *other* real quantities on record for
// this ingredient to use as distractors.
function synthesizeDistractors(quantityText, count, exclude) {
  const parsed = parseQuantity(quantityText)
  if (!parsed || !(parsed.value > 0)) return []
  const { value, suffix } = parsed
  const isInt = Number.isInteger(value)
  const round = (n) => (isInt ? Math.max(1, Math.round(n)) : Math.max(0.1, Math.round(n * 10) / 10))
  const seen = new Set(exclude)
  const out = []
  for (const mult of [0.5, 1.5, 2, 0.75, 1.25]) {
    if (out.length >= count) break
    const text = `${round(value * mult)}${suffix}`
    if (!seen.has(text)) {
      seen.add(text)
      out.push(text)
    }
  }
  return out
}

// Builds { question, choices, correct_choice } for a "how much X goes in Y"
// question out of the row's own correct `quantityText` plus up to 3 wrong
// answers: other real quantities recorded anywhere for the same ingredient
// first (still plausible-looking, harder to rule out on sight than an
// obviously-synthesized number), and only synthesized (scaled) ones when
// there isn't enough real variety on record. Returns null when neither
// source produced any distractor at all (no real alternative on record and
// quantityText wasn't a parseable number to scale) — the caller should keep
// the question as typed fill-in-the-blank in that case.
export function buildQuantityChoiceQuestion({ questionText, quantityText, realPool }) {
  const distractors = shuffle((realPool ?? []).filter((v) => v !== quantityText)).slice(0, 3)
  if (distractors.length < 3) {
    distractors.push(...synthesizeDistractors(quantityText, 3 - distractors.length, [quantityText, ...distractors]))
  }
  if (!distractors.length) return null

  const choices = shuffle([quantityText, ...distractors]).map((text, i) => ({ key: CHOICE_KEYS[i], text }))
  const correct_choice = choices.find((c) => c.text === quantityText).key
  return { question: questionText, choices, correct_choice }
}
