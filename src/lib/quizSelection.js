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

// Jeff, 2026-10-08: "Formula fill-in-the-blank questions抓題的時候，不要抓到
// 同樣的飲料，除非可以抓的飲料比題數少" — same weighted-without-replacement
// idea as weightedSample above (a ⭐ Top 10 drink's own candidates still
// come up more often), but grouped by drink first: a drink only gets a
// SECOND fill-in-the-blank question (e.g. both "how much milk" and "how
// much sugar" for the one drink) once every other eligible drink has
// already contributed its one, and the quiz still needs more fill-in-the-
// blank questions than there are distinct drinks to draw from.
//
// `usedGroups` lets a caller carry forward which drinks an EARLIER call
// already picked from (examBuilders.js's Formal Exam shortfall top-up makes
// a second call against the leftover candidate pool to fill out a quiz that
// came up short on multiple-choice questions) — those drinks are excluded
// from the "give every drink a shot first" pass here too, so two separate
// calls for the same exam attempt still can't both land on the same drink
// while an unused one is still available.
export function weightedSampleOnePerGroup(items, weightOf, groupOf, count, usedGroups = new Set()) {
  const keyed = items.map((item) => ({ item, key: Math.pow(Math.random(), 1 / Math.max(weightOf(item), 0.0001)) }))

  // Pass 1: at most one candidate per drink — the highest-key (so still
  // weighted-random, not just "first ingredient alphabetically") candidate
  // for each drink not already used by an earlier call.
  const byGroup = new Map()
  keyed.forEach((k) => {
    const group = groupOf(k.item)
    if (usedGroups.has(group)) return // only eligible in the leftover fallback below
    const existing = byGroup.get(group)
    if (!existing || k.key > existing.key) byGroup.set(group, k)
  })
  const picked = [...byGroup.values()].sort((a, b) => b.key - a.key).slice(0, count)
  if (picked.length >= count) return picked.map((x) => x.item)

  // Not enough distinct drinks to fill the quota without a repeat — Jeff's
  // own exception ("除非可以抓的飲料比題數少"). Fill the rest from whatever's
  // left (including a drink's own second/third ingredient, and any drink
  // `usedGroups` held back), still weighted and without picking the exact
  // same candidate twice.
  const pickedSet = new Set(picked.map((x) => x.item))
  const leftover = keyed.filter((k) => !pickedSet.has(k.item)).sort((a, b) => b.key - a.key)
  picked.push(...leftover.slice(0, count - picked.length))
  return picked.map((x) => x.item)
}
