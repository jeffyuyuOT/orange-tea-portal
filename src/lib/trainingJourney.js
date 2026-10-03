import { supabase } from './supabaseClient'
import { filterVisibleForStore } from './storeVisibility'
import { getWorkedMinutesByProfile } from './attendance'

// Title shown at any given moment: Master beats Expert beats whatever phase
// 1-5 label has been reached (phase 0 = nobody's passed one yet =
// "Trainee") — UNLESS has_master_title/has_expert_title is set, which
// always win over the phase label. Jeff: "一開始phase 1都還沒通過的話，title
// 則是trainee，phase 1 通過level up exam後就會有Beginner title，以此類推" —
// Phase 1's own label IS "Beginner", so passing phase 1 (moving
// training_journey_phase from 0 to 1) is exactly when "Beginner" starts
// showing. Jeff, 2026-10-03 (Expert/Master split): added has_expert_title
// as its own title tier, between the phase-label ladder and Master.
export function currentTitle(profile, phases) {
  if (profile?.has_master_title) return 'Master'
  if (profile?.has_expert_title) return 'Expert'
  const phase = profile?.training_journey_phase ?? 0
  if (!phase) return 'Trainee'
  return phases.find((p) => p.phase_number === phase)?.label ?? 'Trainee'
}

// Loads everything the Training Journey view needs for one profile at one
// store in a handful of parallel queries: the 7 phase definitions, every
// must-know formula/shop-training item grouped by phase (1-5), plus the
// Phase 6 (Expert) and Phase 7 (Master) item pools and this profile's
// memorized state for both item kinds, and hours worked so far.
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
    supabase.from('formula_items').select('id, name_en, name_zh, is_must_know, training_journey_phase').eq('is_active', true),
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

  // Phase 1-5 item lists: must-know only, grouped by their admin/shop-
  // assigned training_journey_phase. An item with no phase assigned yet
  // (pending, per Admin Training Journey Setting) is simply invisible here
  // — it still counts for Study Log's own Must-Know tracking, just not for
  // Training Journey until someone assigns it a phase.
  const itemsByPhase = {}
  for (let n = 1; n <= 5; n++) itemsByPhase[n] = []
  visibleFormulaItems
    .filter((i) => i.is_must_know && i.training_journey_phase && i.training_journey_phase <= 5)
    .forEach((i) => itemsByPhase[i.training_journey_phase].push(toFormula(i)))
  ;(trainingItemRows ?? [])
    .filter((i) => i.is_must_know && i.training_journey_phase && i.training_journey_phase <= 5)
    .forEach((i) => itemsByPhase[i.training_journey_phase].push(toTraining(i)))

  // Phase 6 (Expert) and Phase 7 (Master) item pools, Jeff 2026-10-03
  // (follow-up): "exper跟master phase裡view item是看專屬於這個Phase的商品" —
  // each phase's checklist/X-of-Y now shows ONLY the items explicitly
  // checked into that exact phase via its own "Add Item" page (Admin
  // Training Journey Setting / shop Training Journey Setting's Phase 6 /
  // Phase 7 tabs — see PhaseItemTab.jsx / TrainingJourneySettingPage.jsx),
  // not a cumulative "1 through N" pool and not "every item" — that's a
  // change from the first Expert/Master split pass, where Phase 6 summed
  // 1-6 and Phase 7 was literally every active item. Must-know items can
  // only ever reach training_journey_phase 1-5 (the ordinary per-item
  // dropdown has no Phase 6/7 option, per Jeff's spec), and each phase's Add
  // Item page only ever offers items not yet assigned anywhere, so an item
  // can only ever land in exactly one of Phase 6 or Phase 7, never both.
  // (The Expert/Master EXAM question pools are a separate, deliberately
  // broader concept — see examBuilders.js's buildExpertExamQuestionSet/
  // buildMasterExamQuestionSet, unchanged by this.)
  const phaseSixItems = [
    ...visibleFormulaItems.filter((i) => i.training_journey_phase === 6).map(toFormula),
    ...(trainingItemRows ?? []).filter((i) => i.training_journey_phase === 6).map(toTraining),
  ]
  const phaseSixTotal = phaseSixItems.length
  const phaseSixMemorized = phaseSixItems.filter((i) => i.memorized).length

  const phaseSevenItems = [
    ...visibleFormulaItems.filter((i) => i.training_journey_phase === 7).map(toFormula),
    ...(trainingItemRows ?? []).filter((i) => i.training_journey_phase === 7).map(toTraining),
  ]
  const phaseSevenTotal = phaseSevenItems.length
  const phaseSevenMemorized = phaseSevenItems.filter((i) => i.memorized).length

  const hoursWorked = (hoursByProfile[profileId] ?? 0) / 60

  return {
    phases: phaseRows ?? [],
    itemsByPhase,
    phaseSixItems,
    phaseSixTotal,
    phaseSixMemorized,
    phaseSevenItems,
    phaseSevenTotal,
    phaseSevenMemorized,
    hoursWorked,
  }
}

// Cumulative-hours fill fraction (0-1) for each phase 1-5, bottom-up —
// Jeff: "工作時間是累積上去的...如果user工作15小時，則時數計量就會填滿
// phase1，phase2則會有5小時計量" — and once a later phase's bar is full,
// filling continues straight into the next one regardless of whether its
// Level-Up Exam has been passed yet (that's the "behind" warning's job, not
// a cap on the fill itself).
export function phaseFillFractions(phases, hoursWorked) {
  const fractions = {}
  let cumulative = 0
  phases
    .filter((p) => p.phase_number <= 5)
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
  for (let n = 1; n <= 5; n++) {
    if ((fractions[n] ?? 0) >= 1) highest = n
  }
  return highest
}

// --- Title-defense helpers -------------------------------------------------

export function isDefenseDue(profile) {
  return !!profile?.title_defense_due_at && new Date(profile.title_defense_due_at) <= new Date()
}

// Called once profiles.qualified first becomes true (Formal Exam reviewed-
// pass, or the manager's direct "Mark as Qualified") — starts the Advanced
// title-defense clock. Jeff: "Qualified advanced跟master員工每三個月(從獲得
// title或成功防衛title計算)會考一次試".
export async function startAdvancedDefenseClock(profileId) {
  const { data: settings } = await supabase.from('quiz_settings').select('reminder_period_months').maybeSingle()
  const months = settings?.reminder_period_months ?? 3
  const dueAt = new Date()
  dueAt.setMonth(dueAt.getMonth() + months)
  await supabase
    .from('profiles')
    .update({ title_defense_due_at: dueAt.toISOString(), title_defense_attempts_used: 0 })
    .eq('id', profileId)
}

// A Formal Exam attempt taken as a title defense (profiles.qualified is
// already true and the defense is due) — self-graded, all-correct required.
// Jeff: "Qualified advanced員工考title防衛戰的exam必須全對，如果有錯的話可以
// 再考兩次，三次裡都沒有一次全對的話就會被disqualified並失去advanced title
// 變回Proficient".
export async function recordFormalDefenseResult(profileId, passed) {
  if (passed) {
    const { data: settings } = await supabase.from('quiz_settings').select('reminder_period_months').maybeSingle()
    const months = settings?.reminder_period_months ?? 3
    const dueAt = new Date()
    dueAt.setMonth(dueAt.getMonth() + months)
    await supabase.from('profiles').update({ title_defense_due_at: dueAt.toISOString(), title_defense_attempts_used: 0 }).eq('id', profileId)
    return { disqualified: false }
  }
  const { data: current } = await supabase.from('profiles').select('title_defense_attempts_used').eq('id', profileId).single()
  const attemptsUsed = (current?.title_defense_attempts_used ?? 0) + 1
  if (attemptsUsed >= 3) {
    await supabase
      .from('profiles')
      .update({
        qualified: false,
        qualified_at: new Date().toISOString(),
        training_journey_phase: 4,
        has_expert_title: false,
        has_master_title: false,
        title_defense_due_at: null,
        title_defense_attempts_used: 0,
      })
      .eq('id', profileId)
    return { disqualified: true }
  }
  await supabase.from('profiles').update({ title_defense_attempts_used: attemptsUsed }).eq('id', profileId)
  return { disqualified: false, attemptsUsed }
}

// An Expert Exam attempt — either the first-ever attempt (Phase 6 just
// reached 100%) or a title-defense re-sit once title_defense_due_at has
// passed while holding Expert. Self-graded using master_quiz_settings'
// error_tolerance — same engine/settings as Master Exam, per Jeff, 2026-10-
// 03 (point 3): "要得到expert title必須做expert exam,出題是從phase 1-6勾選
// 的item出題，邏輯設定都跟master exam一樣" — only the question pool differs
// (see buildExpertExamQuestionSet in examBuilders.js). Passing always (re-)
// grants Expert and resets its own defense cadence (master_quiz_settings,
// shared with Master's own cadence); a failed DEFENSE (not a voluntary
// retry) drops straight back to Advanced — no 3-strike grace, same shape as
// Master's own defense — and restarts the ADVANCED cadence (quiz_settings).
export async function recordExpertExamResult(profileId, passed, { wasDefense }) {
  if (passed) {
    const { data: settings } = await supabase.from('master_quiz_settings').select('reminder_period_months').maybeSingle()
    const months = settings?.reminder_period_months ?? 3
    const dueAt = new Date()
    dueAt.setMonth(dueAt.getMonth() + months)
    await supabase
      .from('profiles')
      .update({
        has_expert_title: true,
        expert_title_earned_at: new Date().toISOString(),
        title_defense_due_at: dueAt.toISOString(),
        title_defense_attempts_used: 0,
      })
      .eq('id', profileId)
    return { lostExpert: false }
  }
  if (!wasDefense) return { lostExpert: false } // a voluntary attempt that just didn't pass yet — nothing changes
  const { data: settings } = await supabase.from('quiz_settings').select('reminder_period_months').maybeSingle()
  const months = settings?.reminder_period_months ?? 3
  const dueAt = new Date()
  dueAt.setMonth(dueAt.getMonth() + months)
  await supabase
    .from('profiles')
    .update({ has_expert_title: false, title_defense_due_at: dueAt.toISOString(), title_defense_attempts_used: 0 })
    .eq('id', profileId)
  return { lostExpert: true }
}

// A Master Exam attempt — either the first-ever attempt (Phase 7 just
// reached 100%, which requires already holding Expert — see
// TrainingJourneyPage.jsx's showMasterVoluntary) or a title-defense re-sit.
// Self-graded with error_tolerance (any must-know miss always fails
// regardless). Jeff: passing always (re-)grants Master and resets the
// Master cadence. Jeff, 2026-10-03 (Expert/Master split, point 1-3): a
// failed DEFENSE now drops back to EXPERT instead of all the way to
// Advanced like it did before Expert existed as its own tier — the holder
// still has Expert's own exam passed, so losing Master just re-opens the
// Expert-level defense clock (master_quiz_settings, shared cadence) rather
// than discarding two tiers of progress at once. No 3-strike grace like
// Formal's defense either way.
export async function recordMasterExamResult(profileId, passed, { wasDefense }) {
  if (passed) {
    const { data: settings } = await supabase.from('master_quiz_settings').select('reminder_period_months').maybeSingle()
    const months = settings?.reminder_period_months ?? 3
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
    return { lostMaster: false }
  }
  if (!wasDefense) return { lostMaster: false } // a voluntary attempt that just didn't pass yet — nothing changes
  const { data: settings } = await supabase.from('master_quiz_settings').select('reminder_period_months').maybeSingle()
  const months = settings?.reminder_period_months ?? 3
  const dueAt = new Date()
  dueAt.setMonth(dueAt.getMonth() + months)
  await supabase
    .from('profiles')
    .update({ has_master_title: false, title_defense_due_at: dueAt.toISOString(), title_defense_attempts_used: 0 })
    .eq('id', profileId)
  return { lostMaster: true }
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
// red. Phase 1-4 get that phase's own admin-configured color plus a small
// "P<n>" badge. Phase 5 (Advanced), Expert and Master ALL render in the
// default/black text, deliberately uncolored — Jeff's spec calls for an
// icon on Expert/Master, not a fourth/fifth/sixth distinct color for what
// are, roster-wide, already the most experienced tiers; coloring every
// veteran a different shade just added visual noise without telling a
// manager anything they need mid-glance. Expert's and Master's one
// remaining distinguisher is their icon — shown only when `format` is
// 'title_crown' (that icon is the ENTIRE difference between the two title
// display formats; an Expert/Master under 'title_no_crown' simply reads
// identically to Advanced). Jeff, 2026-10-03 (point 4): Expert gets 🏅
// (Medal/Badge), Master keeps 👑 — Master wins when someone somehow holds
// both (shouldn't normally happen mid-transition, but Master always implies
// "further along" than Expert alone).
export function rosterTitleStyle(personLike, phases, format) {
  if (format === 'original') return null
  const phase = personLike?.training_journey_phase ?? 0
  const master = !!personLike?.has_master_title
  const expert = !!personLike?.has_expert_title
  if (master) return { color: null, badge: null, icon: format === 'title_crown' ? '👑' : null }
  if (expert) return { color: null, badge: null, icon: format === 'title_crown' ? '🏅' : null }
  if (phase <= 0) return { color: '#DC2626', badge: null, icon: null }
  if (phase >= 5) return { color: null, badge: null, icon: null }
  const p = phases.find((ph) => ph.phase_number === phase)
  return { color: p?.text_color ?? null, badge: `P${phase}`, icon: null }
}
