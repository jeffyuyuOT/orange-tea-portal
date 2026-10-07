import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import {
  loadTrainingJourneyData,
  currentTitle,
  phaseFillFractions,
  highestFilledPhase,
  isDefenseDue,
  findStaleMustKnowItems,
} from '../../../lib/trainingJourney'
import LevelUpExamModal from './LevelUpExamModal'
import FormalExamModal from './FormalExamModal'
import MasterExamModal from './MasterExamModal'

// Jeff, 2026-10-02 (Training Journey spec, points 3-4, 9): the gamified
// training view. `profileId` is whose journey is shown; `isSelf=false`
// (viewed from Shop Management > Learning Tracker) hides every exam-taking
// button — exams are something a staff member sits themselves, never
// something a manager triggers on their behalf — but the phase breakdown,
// item checklist (shared with Study Log — ticking here ticks there too)
// and title/warning banners are otherwise identical.
//
// Jeff, 2026-10-07 (8-point phase-merge request, point 1): the old 7-phase
// ladder with a separate Expert tier between Qualified/Advanced and Master
// is merged into 4 phases — Novice (old 1+2), Practitioner (old 3+4),
// Advanced (old 5), Master (old 6+7, Expert folded into Master). Phases 1-3
// still fill by hours worked + a Level-Up Exam each. What used to be TWO
// item-count tiers stacked above the hours ladder (Phase 6 Expert, Phase 7
// Master) is now just ONE: Phase 4 Master, its own pool of non-must-know
// items explicitly checked in via its own "Add Item" picker (Admin/shop
// Training Journey Setting — see PhaseItemTab.jsx /
// TrainingJourneySettingPage.jsx). A green "qualified" divider sits between
// Phase 4 and Phase 3, since passing the Formal Exam (becoming
// qualified/Advanced) is the gate that unlocks Phase 4 in the first place.
// Clicking "View items" on the Phase 4 card pops a standalone modal with a
// checklist (shared with Study Log, same upsert as the Phase 1-3 inline
// checklist) instead of expanding inline. Titles are two-tiered now —
// Advanced then Master — so the title-defense cascade is Advanced → Master
// based on whichever title is currently held.
//
// Jeff, 2026-10-07 (point 7): a true first-time Advanced staff member (one
// who's never been qualified before) skips their own Phase 3 Level-Up Exam
// entirely once every Phase 3 item is memorized — straight to the Formal
// Exam. A staff member RECOVERING from a lost Advanced title (disqualified,
// `qualified_at` already set) is excluded from that skip and instead sees
// the ordinary Phase 3 Level-Up Exam button — passing it restores Qualified
// directly, without a new Formal Exam review (point 8).
//
// Jeff, 2026-10-07 (point 2): before opening either Formal or Master Exam
// as a title defense, checks for any must-know item in an already-passed
// phase that's still unmemorized (findStaleMustKnowItems) — these can only
// exist because the item was added AFTER that phase's own Level-Up Exam was
// passed. If any are found, a blocking modal lists them (no "continue
// anyway") instead of opening the exam.
export default function TrainingJourneyPage({ profileId, isSelf }) {
  const { currentStoreId, profile: viewerProfile } = useAuth()
  const canView = viewerProfile?.role === 'developer'
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [targetProfile, setTargetProfile] = useState(null)
  const [openPhaseItems, setOpenPhaseItems] = useState(null)
  const [itemsModalPhase, setItemsModalPhase] = useState(null) // null | 4
  const [levelUpPhase, setLevelUpPhase] = useState(null)
  const [showFormal, setShowFormal] = useState(null) // null | { isDefense }
  const [showMaster, setShowMaster] = useState(null) // null | { isDefense }
  const [staleItemsWarning, setStaleItemsWarning] = useState(null) // null | items[]
  const [congrats, setCongrats] = useState(null)

  const reload = useCallback(async () => {
    if (!canView) {
      setLoading(false)
      return
    }
    setLoading(true)
    const [journeyData, { data: profileRow }] = await Promise.all([
      loadTrainingJourneyData(profileId, currentStoreId),
      supabase
        .from('profiles')
        .select('qualified, qualified_at, training_journey_phase, has_master_title, master_title_earned_at, title_defense_due_at')
        .eq('id', profileId)
        .single(),
    ])
    setData(journeyData)
    setTargetProfile(profileRow)
    setLoading(false)
  }, [profileId, currentStoreId, canView])

  useEffect(() => {
    reload()
  }, [reload])

  async function toggleItem(item, value) {
    const table = item.kind === 'formula' ? 'study_progress' : 'shop_training_progress'
    const idField = item.kind === 'formula' ? 'formula_item_id' : 'shop_training_item_id'
    await supabase
      .from(table)
      .upsert({ profile_id: profileId, [idField]: item.id, memorized: value, memorized_at: value ? new Date().toISOString() : null }, { onConflict: `profile_id,${idField}` })
    reload()
  }

  if (!canView) {
    return (
      <div className="rounded-2xl border border-brand-100 bg-white px-4 py-16 text-center">
        <p className="text-2xl">🚧</p>
        <p className="mt-2 text-lg font-semibold text-gray-700">Coming Soon</p>
        <p className="mt-1 text-sm text-gray-400">Training Journey is still being tested — check back soon.</p>
      </div>
    )
  }

  if (loading || !data || !targetProfile) return <LoadingSpinner />

  const { phases, itemsByPhase, phaseFourItems, phaseFourTotal, phaseFourMemorized, hoursWorked } = data
  const fractions = phaseFillFractions(phases, hoursWorked)
  const filledPhase = highestFilledPhase(fractions)
  const currentPhase = targetProfile.training_journey_phase ?? 0
  const title = currentTitle(targetProfile, phases)
  const phase4 = phases.find((p) => p.phase_number === 4)

  // "落後的item數就是計算工作時數填滿的phase還沒勾選的item數" — only the
  // IMMEDIATE next phase matters, since exams must be passed in order.
  const nextPhase = currentPhase + 1
  const behindItems = filledPhase > currentPhase && nextPhase <= 3 ? (itemsByPhase[nextPhase] ?? []).filter((i) => !i.memorized) : []

  // Jeff, 2026-10-03 (point 5, carried into the phase-merge): "title防衛戰失
  // 敗的話，則上面warning視窗不會像之前顯示'Warning! Your progress is behind
  // xx個items'而是顯示'Warning! Please pass the test as soon as possible to
  // restore your title'" — qualified_at is stamped every time `qualified`
  // flips, in either direction, and stays null for anyone who's never been
  // qualified at all — so "!qualified && qualified_at" is exactly "has lost
  // Advanced before" without needing a new column.
  const previouslyLostTitle = !targetProfile.qualified && !!targetProfile.qualified_at

  // Two-tiered defense: whichever title is currently held is the one being
  // defended — Master beats Advanced, since a Master holder is never also
  // mid-defending Advanced.
  const defenseDue = isDefenseDue(targetProfile)
  const showFormalDefenseBanner = isSelf && targetProfile.qualified && !targetProfile.has_master_title && defenseDue
  const showMasterDefenseBanner = isSelf && targetProfile.has_master_title && defenseDue

  // Jeff, 2026-10-07 (point 7): a true first-timer reaching Phase 3 100%
  // skips straight to the Formal Exam instead of a Phase 3 Level-Up Exam.
  // Gated on `!targetProfile.qualified_at` so this only ever fires once, for
  // someone who's never been qualified before — a disqualified-and-
  // recovering profile (qualified_at already set) still sees the ordinary
  // Level-Up Exam button below, and passing it restores Qualified directly
  // (see LevelUpExamModal's recoversQualified).
  const firstTimeAdvancing = !targetProfile.qualified_at

  function phaseCanLevelUp(phaseNumber) {
    if (!isSelf) return false
    if (phaseNumber === 3 && firstTimeAdvancing) return false // skip straight to Formal
    if (currentPhase !== phaseNumber - 1) return false
    const items = itemsByPhase[phaseNumber] ?? []
    return items.length > 0 && items.every((i) => i.memorized)
  }

  const phase3Items = itemsByPhase[3] ?? []
  const advancedItemsComplete = phase3Items.length > 0 && phase3Items.every((i) => i.memorized)
  const showFormalInitial =
    isSelf && !targetProfile.qualified && (currentPhase >= 3 || (currentPhase === 2 && advancedItemsComplete && firstTimeAdvancing))
  const phase4Complete = phaseFourTotal > 0 && phaseFourMemorized === phaseFourTotal
  // Master requires already being Qualified/Advanced first — strict
  // sequential progression through the two title tiers.
  const showMasterVoluntary = isSelf && targetProfile.qualified && !targetProfile.has_master_title && phase4Complete

  // Jeff, 2026-10-07 (point 2): a blocking pre-exam check — any must-know
  // item in an already-passed phase (plus Phase 4, for a Master holder
  // defending) that's still unmemorized has to be ticked off before the
  // defense exam can open at all.
  function staleItemsFor(includePhaseFour) {
    return findStaleMustKnowItems(itemsByPhase, currentPhase, { phaseFourItems, includePhaseFour })
  }

  function defendTopTitle() {
    const stale = staleItemsFor(targetProfile.has_master_title)
    if (stale.length) {
      setStaleItemsWarning(stale)
      return
    }
    if (targetProfile.has_master_title) setShowMaster({ isDefense: true })
    else setShowFormal({ isDefense: true })
  }

  // Jeff, 2026-10-07 (point 2a): non-blocking banner — any stale must-know
  // item anywhere already passed, shown as a heads-up (not a block) so it
  // gets memorized before it blocks a defense attempt later.
  const nonBlockingStale = staleItemsFor(targetProfile.has_master_title)
  const staleByPhase = {}
  nonBlockingStale.forEach((i) => {
    (staleByPhase[i.phaseNumber] ??= []).push(i)
  })

  return (
    <div
      className="space-y-4 rounded-2xl p-4"
      style={{ background: 'linear-gradient(180deg, #fafaf9 0%, #f5f3ff 100%)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-100 bg-white px-4 py-3">
        <div>
          <p className="text-xs text-gray-400">Current title</p>
          <p className="text-lg font-semibold text-gray-900">
            {targetProfile.has_master_title ? '👑 ' : ''}
            {title}
          </p>
        </div>
        {isSelf && defenseDue && (
          <Button variant="secondary" onClick={defendTopTitle}>
            {targetProfile.has_master_title ? 'Defend Master Title' : 'Defend Advanced Title'}
          </Button>
        )}
      </div>

      {previouslyLostTitle ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠️ Warning! Please pass the test as soon as possible to restore your title.
        </div>
      ) : (
        behindItems.length > 0 && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            ⚠️ Warning! Your progress is behind {behindItems.length} item{behindItems.length === 1 ? '' : 's'} — finish ticking Phase {nextPhase}'s
            items as Memorized and pass its Level-Up Exam to catch up.
          </div>
        )
      )}
      {Object.keys(staleByPhase).length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {Object.entries(staleByPhase)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([phaseNumber, items]) => (
              <p key={phaseNumber}>
                ⚠️ New must-know item added to Phase {phaseNumber}: {items.map((i) => i.label).join(', ')} — memorize it soon.
              </p>
            ))}
        </div>
      )}
      {showFormalDefenseBanner && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠️ Your Advanced title defense is due.
        </div>
      )}
      {showMasterDefenseBanner && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠️ Your Master title defense is due — tick every Phase 4 item as Memorized if you haven't already, then retake the Master Exam.
        </div>
      )}

      {/* Jeff, 2026-10-02: "工作小時填補phase的顏色再明顯一點，Phase 1放最下
          面，phase往上放，這樣才有一直往上填補的感覺" — rendered top-to-
          bottom in DESCENDING phase order, so the column reads like a
          tower/thermometer filling upward. Jeff, 2026-10-07 (phase merge):
          Phase 4 (Master) now sits at the very top, then a green "qualified"
          divider, then Phases 3..1 (hours-driven) below that. Every card's
          own frame is a thick border in that phase's own text_color,
          unconditionally. Phases 1-3 (hours-driven): NOT YET passed that
          phase's Level-Up Exam — the hours-worked fraction fills the card
          from the bottom in solid ORANGE at 50% opacity. ALREADY passed: the
          whole card fills with that phase's OWN color instead. */}
      {[4, 3, 2, 1].map((phaseNumber) => {
        const p = phaseNumber === 4 ? phase4 : phases.find((ph) => ph.phase_number === phaseNumber)
        if (!p) return null
        const fraction = phaseNumber === 4 ? (phaseFourTotal > 0 ? phaseFourMemorized / phaseFourTotal : 0) : fractions[phaseNumber] ?? 0
        const items = phaseNumber <= 3 ? itemsByPhase[phaseNumber] ?? [] : phaseFourItems
        const passed = phaseNumber <= 3 && currentPhase >= phaseNumber
        const canLevelUp = phaseNumber <= 3 && phaseCanLevelUp(phaseNumber)
        const complete = phaseNumber === 4 ? phase4Complete : false

        return (
          <div key={phaseNumber}>
            <div className="relative overflow-hidden rounded-xl bg-white" style={{ border: `3px solid ${p.text_color}` }}>
              {phaseNumber <= 3 ? (
                passed ? (
                  <div className="absolute bottom-0 left-0 h-full w-full" style={{ background: p.bg_color, filter: 'saturate(1.8) brightness(0.96)' }} />
                ) : (
                  <div
                    className="absolute bottom-0 left-0 w-full transition-all duration-500"
                    style={{ height: `${Math.round(fraction * 100)}%`, background: '#F97316', opacity: 0.5 }}
                  />
                )
              ) : (
                <div
                  className="absolute bottom-0 left-0 w-full transition-all duration-500"
                  style={{
                    height: `${Math.round(fraction * 100)}%`,
                    background: p.bg_color,
                    filter: 'saturate(2.4) brightness(0.94)',
                    borderTop: `3px solid ${p.text_color}`,
                  }}
                />
              )}
              <div className="relative z-10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold" style={{ color: p.text_color }}>
                    Phase {phaseNumber}: {p.label} {(passed || complete) && '✓'}
                  </p>
                  {phaseNumber <= 3 && <p className="text-xs text-gray-500">{Math.round(fraction * 100)}% hours filled</p>}
                </div>
                <p className="mt-1 text-center text-sm font-semibold text-gray-700">
                  {items.filter((i) => i.memorized).length} out of {items.length} items memorized
                </p>

                {phaseNumber <= 3 && (
                  <>
                    <button
                      className="mt-2 text-xs font-medium text-brand-600 hover:underline"
                      onClick={() => setOpenPhaseItems(openPhaseItems === phaseNumber ? null : phaseNumber)}
                    >
                      {openPhaseItems === phaseNumber ? 'Hide items' : `View items (${items.length})`}
                    </button>
                    {openPhaseItems === phaseNumber && (
                      <div className="mt-2 space-y-1 rounded-lg bg-white/70 p-2">
                        {items.length === 0 ? (
                          <p className="text-xs text-gray-400">No items assigned to this phase yet.</p>
                        ) : (
                          items.map((i) => (
                            <label key={`${i.kind}-${i.id}`} className="flex items-center gap-2 text-sm text-gray-700">
                              <input type="checkbox" checked={i.memorized} onChange={(e) => toggleItem(i, e.target.checked)} />
                              {i.label}
                            </label>
                          ))
                        )}
                      </div>
                    )}
                    {canLevelUp && (
                      <Button className="mt-3 !px-3 !py-1.5 text-xs" onClick={() => setLevelUpPhase(phaseNumber)}>
                        🎯 Take Level-Up Exam
                      </Button>
                    )}
                  </>
                )}

                {phaseNumber === 4 && (
                  <>
                    <button className="mt-2 text-xs font-medium text-brand-600 hover:underline" onClick={() => setItemsModalPhase(4)}>
                      View items ({items.length})
                    </button>
                    {showMasterVoluntary && (
                      <Button className="mt-3 !px-3 !py-1.5 text-xs" onClick={() => setShowMaster({ isDefense: false })}>
                        🏆 Take Master Exam
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {phaseNumber === 4 && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-3 rounded-full border-2 border-green-400 bg-green-50 px-4 py-2">
                <span className="text-xs font-bold uppercase tracking-wide text-green-700">
                  {targetProfile.qualified ? '✅ Qualified' : '🔒 Not Yet Qualified'}
                </span>
                {showFormalInitial && (
                  <Button className="!px-3 !py-1 text-xs" onClick={() => setShowFormal({ isDefense: false })}>
                    📝 Take Formal Exam
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {itemsModalPhase && (
        <Modal open onClose={() => setItemsModalPhase(null)} title="Phase 4 Items">
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {phaseFourItems.length === 0 ? (
              <p className="text-xs text-gray-400">No items yet.</p>
            ) : (
              phaseFourItems.map((i) => (
                <label key={`${i.kind}-${i.id}`} className="flex items-center gap-2 border-b border-gray-100 py-1.5 text-sm text-gray-700 last:border-0">
                  <input type="checkbox" checked={i.memorized} onChange={(e) => toggleItem(i, e.target.checked)} />
                  {i.label}
                </label>
              ))
            )}
          </div>
        </Modal>
      )}

      {staleItemsWarning && (
        <Modal open onClose={() => setStaleItemsWarning(null)} title="⚠️ New must-know items to memorize first">
          <p className="mb-3 text-sm text-gray-600">
            These must-know items were added after you passed their phase. Please memorize them before taking the defense exam:
          </p>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {staleItemsWarning.map((i) => (
              <label key={`${i.kind}-${i.id}`} className="flex items-center gap-2 border-b border-gray-100 py-1.5 text-sm text-gray-700 last:border-0">
                <input type="checkbox" checked={i.memorized} onChange={(e) => toggleItem(i, e.target.checked)} />
                Phase {i.phaseNumber}: {i.label}
              </label>
            ))}
          </div>
          <Button className="mt-4 w-full" onClick={() => setStaleItemsWarning(null)}>
            Close
          </Button>
        </Modal>
      )}

      {levelUpPhase && (
        <LevelUpExamModal
          phaseNumber={levelUpPhase}
          phaseLabel={phases.find((p) => p.phase_number === levelUpPhase)?.label}
          recoversQualified={levelUpPhase === 3 && !firstTimeAdvancing}
          onClose={() => setLevelUpPhase(null)}
          onPassed={() => {
            const label = phases.find((p) => p.phase_number === levelUpPhase)?.label
            setLevelUpPhase(null)
            setCongrats(label)
            reload()
          }}
        />
      )}
      {showFormal && (
        <FormalExamModal
          isDefense={showFormal.isDefense}
          onClose={() => setShowFormal(null)}
          onResult={() => reload()}
        />
      )}
      {showMaster && (
        <MasterExamModal
          isDefense={showMaster.isDefense}
          onClose={() => setShowMaster(null)}
          onResult={({ passed }) => {
            if (passed && !showMaster.isDefense) setCongrats('Master')
            reload()
          }}
        />
      )}
      {congrats && (
        <Modal open onClose={() => setCongrats(null)} title="🎉 Congratulations, Level-Up Unlocked!">
          <p className="py-4 text-center text-lg font-medium text-gray-800">You are now a {congrats}!</p>
          <Button className="w-full" onClick={() => setCongrats(null)}>
            Nice!
          </Button>
        </Modal>
      )}
    </div>
  )
}
