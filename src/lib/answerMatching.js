// Shared fill-in-the-blank answer checking, used by both Quick Quiz's and
// Formal Quiz's grading (both for Quiz Bank-authored fill-blank questions
// and the auto-generated "ingredient quantity" ones built from Formula
// Database recipes).
//
// Two kinds of leniency, per Jeff's request:
//   1. Abbreviations / alternate names that mean the same thing (e.g. "OT"
//      for "Orange Tea", "100%" for "Full Sugar") — there's no way for the
//      app to infer these on its own, so an admin lists them once as
//      `acceptedAnswers` when writing the question, and any of them is
//      treated as fully correct.
//   2. Minor typos/spelling differences that aren't really a different
//      answer — a small Levenshtein edit-distance tolerance, scaled to the
//      answer's length so a short answer (where every character carries
//      more weight, e.g. a unit like "30g") isn't as forgiving as a longer
//      phrase.

export function normalizeAnswer(s) {
  return (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ')
}

// Strips punctuation that's only ever used to SEPARATE list items (comma,
// semicolon, slash) and all whitespace — so "b, d, f, g" and "b/d/f/g" both
// collapse down to just "bdfg", matching a correct answer written either
// way. This deliberately leaves other punctuation (a decimal point, "%",
// etc.) untouched, since that can change what a number actually means
// ("1.5" vs "15") — only separators between otherwise-identical list items
// are safe to ignore.
function stripListSeparators(s) {
  return s.replace(/[,;/]/g, '').replace(/\s+/g, '')
}

// Standard Levenshtein edit distance (insertions/deletions/substitutions).
function editDistance(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1])
    }
    prev = curr
  }
  return prev[n]
}

// How many edited characters still count as "close enough" for an answer
// of this length. Deliberately strict below 5 characters — "30g" vs "3g"
// (an edit distance of 1) is a genuinely different answer, not a typo.
function typoTolerance(len) {
  if (len <= 4) return 0
  if (len <= 10) return 1
  return 2
}

// `answer` = what the person typed. `correct` = the question's main
// accepted answer. `acceptedAnswers` = extra accepted alternates/
// abbreviations an admin listed for this question. Returns true if
// `answer` matches any of them, either exactly (after normalizing) or
// within typo tolerance of one of them.
export function isAnswerAccepted(answer, correct, acceptedAnswers = []) {
  const normAnswer = normalizeAnswer(answer)
  if (!normAnswer) return false
  const candidates = [correct, ...(acceptedAnswers ?? [])].map(normalizeAnswer).filter(Boolean)
  const strippedAnswer = stripListSeparators(normAnswer)
  return candidates.some((c) => {
    if (c === normAnswer) return true
    // Same letters/numbers, just written with different list punctuation or
    // spacing — e.g. "b, d, f, g" vs "bdfg", or "160, 240" vs "160 240".
    // Case is already handled above by normalizeAnswer; this is the same
    // idea for separator symbols in between.
    if (strippedAnswer && stripListSeparators(c) === strippedAnswer) return true
    const tolerance = typoTolerance(Math.max(normAnswer.length, c.length))
    return tolerance > 0 && editDistance(normAnswer, c) <= tolerance
  })
}
