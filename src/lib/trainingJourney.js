import { supabase } from './supabaseClient'
import { filterVisibleForStore } from './storeVisibility'
import { getWorkedMinutesByProfile } from './attendance'

// Jeff, 2026-10-07 (8-point phase-merge request, point 1): the 7-phase
// Beginner..Master ladder with a separate Expert tier is merged into 4
// phases — Novice (old 1+2), Practitioner (old 3+4), Advanced (old 5),
// Master (old 6+7, the Expert tier folded into Master). See migration
// 0096_training_journey_phase_merge.sql for the DB side of this (phase
// renumbering, dropped has_expert_title/expert_title_earned_at/
// title_defense_attempts_used columns, new title_loss_* columns, new
// title_defense_settings table).
//
// Title shown at any given moment: Master beats whatever phase 1-3 label
// has been reached (phase 0 = nobody's passed one yet = "Trainee") —
// UNLESS has_master_title is set, which always wins over the phase label.
// Jeff: "一開始phase 1都還沒通過的話，title則是trainee，phase 1 通過level up
// exam後就會有Novice title，以此類推".
export function currentTitle(profile, phases) {
  if (profile?.has_master_title) return 'Master'
  const phase = profile?.training_journey_phase ?? 0
  if (!phase) return 'Trainee'
  return phases.find((p) => p.phase_number === phase)?.label ?? 'Trainee'
}

// Loads everything the Training Journey view needs for one profile at one
// store in a handful of parallel queries: the 4 phase definitions, every
// must-know formula/shop-training item grouped by phase (1-3), plus the
// Phase 4 (Master) item pool and this profile's memorized state for both
// item kinds, and hours worked so far.
export async function loadTrainingJourneyData(profileId, storeId) {
  const [
    { data: phaseRows },
    { data: formulaItemRows },
    { data: drinkStoreRows },
    { data: trainingItemRows },
    { data: progressRows },
    { data: trainingProgressRows },
    hoursByProfile,
  ] = await Promise.all([
    supabase.from('training_journey_phases').select('*').order('phase_number'),
    // Jeff, 2026-10-07 (migration 0093): hide_from_formula excludes an item
    // from phase assign (PhaseItemTab.jsx), so it's excluded from this
    // read-side phase/pool computation too — otherwise a hidden item that
    // was already phase-assigned before being hidden would keep counting
    // toward someone's Training Journey checklist even though it no longer
    // shows up anywhere an admin could re-check or un-assign it.
    supabase
      .from('formula_items')
      .select('id, name_en, name_zh, is_must_know, training_journey_phase')
      .eq('is_active', true)
      .eq('hide_from_formula', false),
    supabase.from('formula_item_stores').select('*'),
    storeId
      ? supabase.from('shop_training_items').select('id, title, is_must_know, training_journey_phase').eq('store_id', storeId)
      : Promise.resolve({ data: [] }),
    supabase.from('study_progress').select('formula_item_id, memorized').eq('profile_id', profileId).eq('memorized', true),
    supabase.from('shop_training_progress').select('shop_training_item_id, memorized').eq('profile_id', profileId).eq('memorized', true),
    getWorkedMinutesByProfile([profileId]),
  ])

  const visibleFormulaItems = filterVisibleForStore(formulaItemRows ?? [], drinkStoreRows ?? [], 'formula_item_id', storeId)
  const memorizedFormulaIds = new Set((progressRows ?? []).map((p) => p.formula_item_id))
  const memorizedTrainingIds = new Set((trainingProgressRows ?? []).map((p) => p.shop_training_item_id))

  function toFormula(i) {
    return { kind: 'formula', id: i.id, label: i.name_zh ? `${i.name_en} (${i.name_zh})` : i.name_en, memorized: memorizedFormulaIds.has(i.id) }
  }
  function toTraining(i) {
    return { kind: 'training', id: i.id, label: i.title, memorized: memorizedTrainingIds.has(i.id) }
  }

  // Phase 1-3 item lists: must-know only, grouped by their admin/shop-
  // assigned training_journey_phase. An item with no phase assigned yet
  // (pending, per Admin Training Journey Setting) is simply invisible here
  // — it still counts for Study Log's own Must-Know tracking, just not for
  // Training Journey until someone assigns it a phase.
  const itemsByPhase = {}
  for (let n = 1; n <= 3; n++) itemsByPhase[n] = []
  visibleFormulaItems
    .filter((i) => i.is_must_know && i.training_journey_phase && i.training_journey_phase <= 3)
    .forEach((i) => itemsByPhase[i.training_journey_phase].push(toFormula(i)))
  ;(trainingItemRows ?? [])
    .filter((i) => i.is_must_know && i.training_journey_phase && i.training_journey_phase <= 3)
    .forEach((i) => itemsByPhase[i.training_journey_phase].push(toTraining(i)))

  // Phase 4 (Master) item pool, Jeff 2026-10-03 (follow-up, pre-merge):
  // "master phase裡view item是看專屬於這個Phase的商品" — the checklist/X-of-Y
  // shows ONLY the items explicitly checked into Phase 4 via its own "Add
  // Item" page (Admin Training Journey Setting / shop Training Journey
  // Setting's Phase 4 tab — see PhaseItemTab.jsx / TrainingJourneySettingPage.jsx),
  // not a cumulative pool and not "every item". Must-know items can only
  // ever reach training_journey_phase 1-3 (the ordinary per-item dropdown
  // has no Phase 4 option, per Jeff's spec).
  const phaseFourItems = [
    ...visibleFormulaItems.filter((i) => i.training_journey_phase === 4).map(toFormula),
    ...(trainingItemRows ?? []).filter((i) => i.training_journey_phase === 4).map(toTraining),
  ]
  const phaseFourTotal = phaseFourItems.length
  const phaseFourMemorized = phaseFourItems.filter((i) => i.memorized).length

  const hoursWorked = (hoursByProfile[profileId] ?? 0) / 60

  return {
    phases: phaseRows ?? [],
    itemsByPhase,
    phaseFourItems,
    phaseFourTotal,
    phaseFourMemorized,
    hoursWorked,
  }
}

// Cumulative-hours fill fraction (0-1) for each phase 1-3, bottom-up —
// Jeff: "工作時間是累積上去的...如果user工作15小時，則時數計量就會填滿
// phase1，phase2則會有5小時計量" — and once a later phase's bar is full,
// filling continues straight into the next one regardless of whether its
// Level-Up Exam has been passed yet (that's the "behind" warning's job, not
// a cap on the fill itself).
export function phaseFillFractions(phases, hoursWorked) {
  const fractions = {}
  let cumulative = 0
  phases
    .filter((p) => p.phase_number <= 3)
    .sort((a, b) => a.phase_number - b.phase_number)
    .forEach((p) => {
      const start = cumulative
      const span = p.hours_required ?? 0
      cumulative += span
      fractions[p.phase_number] = span <= 0 ? 0 : Math.max(0, Math.min(1, (hoursWorked - start) / span))
    })
  return fractions
}

// The highest phase number whose hours bar is fully filled (0 if none).
export function highestFilledPhase(fractions) {
  let highest = 0
  for (let n = 1; n <= 3; n++) {
    if ((fractions[n] ?? 0) >= 1) highest = n
  }
  return highest
}

// Jeff, 2026-10-07 (8-point phase-merge request, point 2): an unmemorized
// must-know item in an already-passed phase can only exist if it was added
// AFTER that phase's Level-Up Exam was passed (passing required 100%
// memorized at the time) — so no new timestamp tracking is needed, just a
// re-check of every already-passed phase's current item list.
// `includePhaseFour` additionally checks Phase 4 (Master)'s own pool, for a
// Master titleholder about to re-sit a title defense.
export function findStaleMustKnowItems(itemsByPhase, currentPhase, { phaseFourItems, includePhaseFour } = {}) {
  const stale = []
  for (let n = 1; n <= Math.min(currentPhase, 3); n++) {
    (itemsByPhase[n] ?? []).filter((i) => !i.memorized).forEach((i) => stale.push({ ...i, phaseNumber: n }))
  }
  if (includePhaseFour) {
    (phaseFourItems ?? []).filter((i) => !i.memorized).forEach((i) => stale.push({ ...i, phaseNumber: 4 }))
  }
  return stale
}

// --- Title-defense helpers -------------------------------------------------

export function isDefenseDue(profile) {
  return !!profile?.title_defense_due_at && new Date(profile.title_defense_due_at) <= new Date()
}

// Jeff, 2026-10-07 (point 4): title-defense cadence/question-count for
// BOTH Advanced and Master is now the single shared title_defense_settings
// table (migration 0096), replacing the old split between quiz_settings'
// reminder_period_months (Advanced) and master_quiz_settings' (Master/
// Expert). quiz_settings.reminder_period_months keeps its own, unrelated
// meaning — the generic Bulletin quiz-reminder cadence (Quick Quiz).
async function titleDefenseMonths() {
  const { data: settings } = await supabase.from('title_defense_settings').select('reminder_period_months').maybeSingle()
  return settings?.reminder_period_months ?? 3
}

// Called once profiles.qualified first becomes true (Formal Exam reviewed-
// pass, or the manager's direct "Mark as Qualified") — starts the Advanced
// title-defense clock. Jeff: "Qualified advanced跟master員工每三個月(從獲得
// title或成功防衛title計算)會考一次試". Also resets title_defense_attempts_used
// to 0 — a brand-new cycle starts with a clean slate (point 2 below).
export async function startAdvancedDefenseClock(profileId) {
  const months = await titleDefenseMonths()
  const dueAt = new Date()
  dueAt.setMonth(dueAt.getMonth() + months)
  await supabase.from('profiles').update({ title_defense_due_at: dueAt.toISOString(), title_defense_attempts_used: 0 }).eq('id', profileId)
}

// A Formal Exam attempt taken as a title defense (profiles.qualified is
// already true and the defense is due) — self-graded, all-correct required.
// Jeff, 2026-10-07 (8-point phase-merge request, point 4): "lose advanced
// title的user會直接disqualified" — the old 3-strike grace was removed, a
// single failed defense attempt instantly disqualified, same no-grace rule
// Master's own defense always had.
//
// Jeff, 2026-10-08: brought the grace back — "title defense quiz失敗的話，
// 應該還有2次機會，所以总共可以考3次" — 2 extra chances after a first
// failure (3 attempts total) before disqualifying, tracked by
// profiles.title_defense_attempts_used (re-added by migration 0099, same
// column point 4 had dropped). A failed attempt that still has chances left
// just increments the counter and leaves title_defense_due_at untouched —
// still overdue, so "Defend Title" stays available to retry right away. Only
// the 3rd consecutive failure actually disqualifies: drops back to
// Practitioner (phase 2) and stamps title_loss_* (point 5's one-time login
// popup reads these). Independently, migration 0099's daily
// expire_overdue_title_defenses() pg_cron job disqualifies anyone who lets 7
// days pass since becoming overdue without passing — whether or not they
// have attempts left — so someone who never logs in to retry still gets
// demoted, not just someone who fails 3 times.
export async function recordFormalDefenseResult(profileId, passed) {
  if (passed) {
    const months = await titleDefenseMonths()
    const dueAt = new Date()
    dueAt.setMonth(dueAt.getMonth() + months)
    await supabase
      .from('profiles')
      .update({ title_defense_due_at: dueAt.toISOString(), title_defense_attempts_used: 0 })
      .eq('id', profileId)
    return { disqualified: false, attemptsRemaining: null }
  }

  const { data: freshProfile } = await supabase.from('profiles').select('title_defense_attempts_used').eq('id', profileId).single()
  const attemptsUsed = (freshProfile?.title_defense_attempts_used ?? 0) + 1
  if (attemptsUsed < 3) {
    await supabase.from('profiles').update({ title_defense_attempts_used: attemptsUsed }).eq('id', profileId)
    return { disqualified: false, attemptsRemaining: 3 - attemptsUsed }
  }

  await supabase
    .from('profiles')
    .update({
      qualified: false,
      qualified_at: new Date().toISOString(),
      training_journey_phase: 2,
      has_master_title: false,
      title_defense_due_at: null,
      title_defense_attempts_used: 0,
      title_loss_from: 'Advanced',
      title_loss_to: 'Practitioner',
      title_loss_at: new Date().toISOString(),
    })
    .eq('id', profileId)
  return { disqualified: true, attemptsRemaining: 0 }
}

// A Master Exam attempt — either the first-ever attempt (Phase 4 just
// reached 100%, which requires already being Qualified/Advanced — see
// TrainingJourneyPage.jsx's showMasterVoluntary) or a title-defense re-sit.
// Self-graded with error_tolerance (any must-know miss always fails
// regardless). Jeff: passing always (re-)grants Master and resets the
// shared title-defense cadence (and title_defense_attempts_used — see
// recordFormalDefenseResult's comment, 2026-10-08, for the full grace-period
// story, which applies symmetrically here). A failed DEFENSE (not a
// voluntary retry) gets the same 3-attempts-total grace as Formal's defense
// before actually dropping back to Advanced (qualified stays true) and
// stamping title_loss_*.
export async function recordMasterExamResult(profileId, passed, { wasDefense }) {
  if (passed) {
    const months = await titleDefenseMonths()
    const dueAt = new Date()
    dueAt.setMonth(dueAt.getMonth() + months)
    await supabase
      .from('profiles')
      .update({
        has_master_title: true,
        master_title_earned_at: new Date().toISOString(),
        title_defense_due_at: dueAt.toISOString(),
        title_defense_attempts_used: 0,
      })
      .eq('id', profileId)
    return { lostMaster: false, attemptsRemaining: null }
  }
  if (!wasDefense) return { lostMaster: false, attemptsRemaining: null } // a voluntary attempt that just didn't pass yet — nothing changes

  const { data: freshProfile } = await supabase.from('profiles').select('title_defense_attempts_used').eq('id', profileId).single()
  const attemptsUsed = (freshProfile?.title_defense_attempts_used ?? 0) + 1
  if (attemptsUsed < 3) {
    await supabase.from('profiles').update({ title_defense_attempts_used: attemptsUsed }).eq('id', profileId)
    return { lostMaster: false, attemptsRemaining: 3 - attemptsUsed }
  }

  const months = await titleDefenseMonths()
  const dueAt = new Date()
  dueAt.setMonth(dueAt.getMonth() + months)
  await supabase
    .from('profiles')
    .update({
      has_master_title: false,
      title_defense_due_at: dueAt.toISOString(),
      title_defense_attempts_used: 0,
      title_loss_from: 'Master',
      title_loss_to: 'Advanced',
      title_loss_at: new Date().toISOString(),
    })
    .eq('id', profileId)
  return { lostMaster: true, attemptsRemaining: 0 }
}

// --- Roster/Bulletin display (System Setting > Roster Name Display Format) -

export async function loadRosterDisplaySettings() {
  const { data } = await supabase.from('app_display_settings').select('roster_name_display_format').maybeSingle()
  return data?.roster_name_display_format ?? 'original'
}

// Jeff, 2026-10-02 (Training Journey spec, point 6): how a roster/Bulletin
// name+shift should be colored/badged under the 'title_crown'/
// 'title_no_crown' display formats — 'original' keeps the pre-existing
// qualified-only red/default split untouched (callers just skip this
// function entirely in that mode). Phase 0 (Trainee — never passed even the
// Phase 1 Level-Up Exam) reads the same as "not yet Qualified" always has:
// red. Phase 1-2 get that phase's own admin-configured color plus a small
// "P<n>" badge. Phase 3 (Advanced) and Master BOTH render in the
// default/black text, deliberately uncolored — Jeff's spec calls for an
// icon on Master, not another distinct color for what are, roster-wide,
// already the most experienced tiers; coloring every veteran a different
// shade just added visual noise without telling a manager anything they
// need mid-glance. Master's one remaining distinguisher is its icon —
// shown only when `format` is 'title_crown' (that icon is the ENTIRE
// difference between the two title display formats; Master under
// 'title_no_crown' simply reads identically to Advanced).
export function rosterTitleStyle(personLike, phases, format) {
  if (format === 'original') return null
  const phase = personLike?.training_journey_phase ?? 0
  const master = !!personLike?.has_master_title
  if (master) return { color: null, badge: null, icon: format === 'title_crown' ? '👑' : null }
  if (phase <= 0) return { color: '#DC2626', badge: null, icon: null }
  if (phase >= 3) return { color: null, badge: null, icon: null }
  const p = phases.find((ph) => ph.phase_number === phase)
  return { color: p?.text_color ?? null, badge: `P${phase}`, icon: null }
}
