// Weighted random sampling without replacement (Efraimidis-Spirakis: each
// item gets a random key raised to 1/weight, then take the top `count` by
// key) — used so a ⭐ Top 10 drink's fill-in-the-blank questions come up
// more often than everything else, without ever risking the exact same
// question twice in one quiz (which a simpler "duplicate the item N times
// before shuffling" approach could do).
//
// Shared by Quick Quiz and Formal Quiz (both read the same
// `formal_quiz_settings.top10_fill_blank_weight` value — see the "Formula
// fill-in-the-blank questions" settings section in Admin Center's Quiz Bank
// Setting page, QuizSettingsPage.jsx) so a Top 10 drink gets boosted
// consistently in both quiz types, not just one.
export function weightedSample(items, weightOf, count) {
  return items
    .map((item) => ({ item, key: Math.pow(Math.random(), 1 / Math.max(weightOf(item), 0.0001)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((x) => x.item)
}
