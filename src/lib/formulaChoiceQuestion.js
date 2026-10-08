// Shared "turn a recorded formula quantity into a 4-option multiple-choice
// question" logic — originally lived only inside QuickQuizModal.jsx, moved
// here (same reasoning as quizSelection.js's weightedSample) so more than
// one caller can build the same style of question without a second copy of
// this logic drifting out of sync. Two variants: buildQuantityChoiceQuestion
// (Quick Quiz's original, randomly-picked distractors) and
// buildHardQuantityChoiceQuestion (Formal Quiz's non-⭐-Top-10 formula
// questions — see FormalQuizModal.jsx — picks the wrong answers closest in
// value to the correct one, deliberately harder to rule out on sight).
// buildHardQuantityChoiceQuestion also falls back to the easy variant
// whenever the correct quantity isn't a number at all (e.g. "half cup") —
// see its own comment below.

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
// Anything that doesn't start with a number (e.g. "half cup", "a pinch") is
// unparseable.
function parseQuantity(text) {
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec((text ?? '').trim())
  if (!m) return null
  return { value: parseFloat(m[1]), suffix: m[2] }
}

// Jeff, 2026-10-08: "formula某ingredient裡是文字敘述的就不考(或者是有辦法弄成
// 類似選擇題)，像是fresh milk and herbal jelly的herbal jelly是half cup" — a
// recorded quantity that doesn't even start with a number (not just one in
// an unexpected unit) has no "closest value" to compute at all, so callers
// use this to tell that case apart from an ordinary parseable quantity that
// simply didn't have enough same-unit real alternatives on record.
export function isNumericQuantity(text) {
  return !!parseQuantity(text)
}

// Jeff, 2026-10-08: two recorded quantity_text strings can mean the exact same
// real-world amount while looking different ("1" vs "1.0" — e.g. Winter
// Lemon's Sugar (M) is "1" while Gelato JTMGT's was typed "1.0") because
// formula entry doesn't enforce one canonical format. A plain string compare
// (`v !== quantityText`) doesn't catch that, so a distractor pool could hand
// back an option that is numerically identical to the correct answer — two
// choices a staff member has no real way to tell apart, since they're the
// same quantity. This compares parsed numeric value + unit instead of raw
// text, falling back to exact string equality when either side doesn't parse
// as a number (e.g. "a pinch").
function sameQuantity(a, b) {
  if (a === b) return true
  const pa = parseQuantity(a)
  const pb = parseQuantity(b)
  if (!pa || !pb) return false
  return pa.value === pb.value && pa.suffix.trim() === pb.suffix.trim()
}

// Falls back to synthesized wrong answers (scaled versions of the real
// quantity) when there aren't enough *other* real quantities on record for
// this ingredient to use as distractors. `multipliers` controls how far off
// the synthesized values are — the default wide swings (half/double, etc.)
// for the easier variant below, a tighter set for the harder one.
function synthesizeDistractors(quantityText, count, exclude, multipliers = [0.5, 1.5, 2, 0.75, 1.25]) {
  const parsed = parseQuantity(quantityText)
  if (!parsed || !(parsed.value > 0)) return []
  const { value, suffix } = parsed
  const isInt = Number.isInteger(value)
  const round = (n) => (isInt ? Math.max(1, Math.round(n)) : Math.max(0.1, Math.round(n * 10) / 10))
  const seen = new Set(exclude)
  const out = []
  for (const mult of multipliers) {
    if (out.length >= count) break
    const text = `${round(value * mult)}${suffix}`
    if (!seen.has(text)) {
      seen.add(text)
      out.push(text)
    }
  }
  return out
}

function finish(questionText, quantityText, distractors) {
  if (!distractors.length) return null
  const choices = shuffle([quantityText, ...distractors]).map((text, i) => ({ key: CHOICE_KEYS[i], text }))
  const correct_choice = choices.find((c) => c.text === quantityText).key
  return { question: questionText, choices, correct_choice }
}

// Builds { question, choices, correct_choice } for a "how much X goes in Y"
// question out of the row's own correct `quantityText` plus up to 3 wrong
// answers: other real quantities recorded anywhere for the same ingredient
// first (still plausible-looking, harder to rule out on sight than an
// obviously-synthesized number), picked at random, and only synthesized
// (scaled) ones when there isn't enough real variety on record. Returns null
// when neither source produced any distractor at all (no real alternative on
// record and quantityText wasn't a parseable number to scale) — the caller
// should keep the question as typed fill-in-the-blank in that case.
export function buildQuantityChoiceQuestion({ questionText, quantityText, realPool }) {
  const seen = [quantityText]
  const candidates = shuffle((realPool ?? []).filter((v) => !sameQuantity(v, quantityText)))
  const distractors = []
  for (const v of candidates) {
    if (distractors.length >= 3) break
    if (seen.some((s) => sameQuantity(s, v))) continue // same real quantity already picked under a different string
    seen.push(v)
    distractors.push(v)
  }
  if (distractors.length < 3) {
    distractors.push(...synthesizeDistractors(quantityText, 3 - distractors.length, [quantityText, ...distractors]))
  }
  return finish(questionText, quantityText, distractors)
}

// Same idea, but deliberately harder: instead of picking 3 random real
// quantities as wrong answers, picks the 3 that are numerically CLOSEST to
// the correct one (same unit only — a "2 pumps" quantity is never compared
// against a "30g" one) — much harder to eliminate by "that number looks way
// off" than a random real value might be. Falls back to synthesized values
// scaled by a tighter set of factors (±10-30%, vs. the ±25-100% swings the
// easier variant above uses) for the same reason, when there aren't 3 real
// same-unit alternatives close enough to use. Returns null on the same
// condition as buildQuantityChoiceQuestion.
const HARD_SCALE_FACTORS = [0.8, 1.2, 0.9, 1.1, 0.85, 1.15, 0.7, 1.3]

export function buildHardQuantityChoiceQuestion({ questionText, quantityText, realPool }) {
  const parsedCorrect = parseQuantity(quantityText)
  if (!parsedCorrect) {
    // "Closest value" is meaningless for a free-text quantity like "half
    // cup" — fall back to the easy variant's plain random-real-alternate
    // strategy instead (e.g. other recipes' own recorded Herbal Jelly
    // amounts become the wrong answers). Still returns null, same as
    // below, when there isn't even one other real value on record for this
    // ingredient — the caller drops the question rather than ask it as an
    // unreliable typed free-text answer (no admin-curated accepted-answers
    // list exists for an auto-generated candidate).
    return buildQuantityChoiceQuestion({ questionText, quantityText, realPool })
  }
  const ranked = (realPool ?? [])
    .filter((v) => !sameQuantity(v, quantityText))
    .map((v) => ({ v, parsed: parseQuantity(v) }))
    .filter(({ parsed }) => parsed && parsedCorrect && parsed.suffix === parsedCorrect.suffix)
    .sort((a, b) => Math.abs(a.parsed.value - parsedCorrect.value) - Math.abs(b.parsed.value - parsedCorrect.value))
    .map(({ v }) => v)

  // Two "closest" candidates can still be the same real quantity typed two
  // different ways (e.g. "1.2" recorded for more than one item) — dedupe by
  // value, not just exact text, so the 4 choices never contain a repeat.
  const seen = [quantityText]
  const closest = []
  for (const v of ranked) {
    if (seen.some((s) => sameQuantity(s, v))) continue
    seen.push(v)
    closest.push(v)
  }

  const distractors = closest.slice(0, 3)
  if (distractors.length < 3) {
    distractors.push(
      ...synthesizeDistractors(quantityText, 3 - distractors.length, [quantityText, ...distractors], HARD_SCALE_FACTORS)
    )
  }
  return finish(questionText, quantityText, distractors)
}
