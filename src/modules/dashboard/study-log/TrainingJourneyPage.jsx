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
} from '../../../lib/trainingJourney'
import LevelUpExamModal from './LevelUpExamModal'
import FormalExamModal from './FormalExamModal'
import ExpertExamModal from './ExpertExamModal'
import MasterExamModal from './MasterExamModal'

// Jeff, 2026-10-02 (Training Journey spec, points 3-4, 9): the gamified
// training view. `profileId` is whose journey is shown; `isSelf=false`
// (viewed from Shop Management > Learning Tracker) hides every exam-taking
// button — exams are something a staff member sits themselves, never
// something a manager triggers on their behalf — but the phase breakdown,
// item checklist (shared with Study Log — ticking here ticks there too)
// and title/warning banners are otherwise identical.
//
// Jeff, 2026-10-03 (Expert/Master split, points 1-4): phases 1-5 still fill
// by hours worked + a Level-Up Exam each, exactly as before. What used to
// be a single "Phase 6 (Master)" item-count tier is now TWO item-count
// tiers stacked on top of the hours-driven ladder: Phase 6 "Expert" and
// Phase 7 "Master", each its own pool of non-must-know items explicitly
// checked in via its own "Add Item" picker (Admin/shop Training Journey
// Setting — see PhaseItemTab.jsx / TrainingJourneySettingPage.jsx). A green
// "qualified" divider sits between Phase 6 and Phase 5, since passing the
// Formal Exam (becoming qualified/Advanced) is the gate that unlocks Phase
// 6+ in the first place. Clicking "View items" on the Phase 6/7 cards pops
// a standalone modal with a checklist (shared with Study Log, same upsert
// as the Phase 1-5 inline checklist) instead of expanding inline. Titles
// are now sequential — Expert before Master — so the Master Exam button
// requires has_expert_title first, and the title-defense cascade is
// 3-tiered (Advanced → Expert → Master) based on whichever title is
// currently held.
//
// Jeff, 2026-10-03 (follow-up, same day): "exper跟master phase裡view item
// 是看專屬於這個Phase的商品" — Phase 6/7's item pool (and the "X out of Y"
// below) is each phase's OWN exclusively-assigned items only, not a
// cumulative 1-6 or "every item" pool like the first Expert/Master split
// pass had — see trainingJourney.js's loadTrainingJourneyData. Also per
// that follow-up, "所有phase區塊中間都要顯示X out of Y" — every phase card
// (1-7), not just 6/7, now shows a prominent centered "X out of Y items
// memorized" line, using the same items list that phase's own checklist
// already uses (itemsByPhase[n] for 1-5, the phase's own pool for 6/7).
//
// Jeff, 2026-10-03: "如果現在要push command，但user(除了developer)看到
// training journey頁面會顯示coming soon" — the feature's still being tested
// locally, so a "Coming Soon" placeholder gates the real view for anyone
// whose OWN account isn't the developer role — this checks the VIEWER
// (useAuth's profile), not whose journey is being looked at, so a manager
// looking at a staff member's Training Journey tab in Learning Tracker
// sees the same placeholder unless the manager's own account is developer.
// Once Jeff's happy with it, this gate is the one block to delete (and the
// tab/page work underneath it ships immediately, already pushed).
export default function TrainingJourneyPage({ profileId, isSelf }) {
  const { currentStoreId, profile: viewerProfile } = useAuth()
  const canView = viewerProfile?.role === 'developer'
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [targetProfile, setTargetProfile] = useState(null)
  const [openPhaseItems, setOpenPhaseItems] = useState(null)
  const [itemsModalPhase, setItemsModalPhase] = useState(null) // null | 6 | 7
  const [levelUpPhase, setLevelUpPhase] = useState(null)
  const [showFormal, setShowFormal] = useState(null) // null | { isDefense }
  const [showExpert, setShowExpert] = useState(null) // null | { isDefense }
  const [showMaster, setShowMaster] = useState(null) // null | { isDefense }
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
        .select(
          'qualified, qualified_at, training_journey_phase, has_expert_title, expert_title_earned_at, has_master_title, master_title_earned_at, title_defense_due_at, title_defense_attempts_used'
        )
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

  const { phases, itemsByPhase, phaseSixItems, phaseSixTotal, phaseSixMemorized, phaseSevenItems, phaseSevenTotal, phaseSevenMemorized, hoursWorked } = data
  const fractions = phaseFillFractions(phases, hoursWorked)
  const filledPhase = highestFilledPhase(fractions)
  const currentPhase = targetProfile.training_journey_phase ?? 0
  const title = currentTitle(targetProfile, phases)
  const phase6 = phases.find((p) => p.phase_number === 6)
  const phase7 = phases.find((p) => p.phase_number === 7)

  // "落後的item數就是計算工作時數填滿的phase還沒勾選的item數" — only the
  // IMMEDIATE next phase matters, since exams must be passed in order.
  const nextPhase = currentPhase + 1
  const behindItems = filledPhase > currentPhase && nextPhase <= 5 ? (itemsByPhase[nextPhase] ?? []).filter((i) => !i.memorized) : []

  // Jeff, 2026-10-03 (point 5): "title防衛戰失敗的話，則上面warning視窗不會
  // 像之前顯示'Warning! Your progress is behind xx個items'而是顯示
  // 'Warning! Please pass the test as soon as possible to restore your
  // title'" — qualified_at is stamped every time `qualified` flips, in
  // either direction (recordFormalDefenseResult's 3-strike disqualify,
  // StaffStudyDetail's manual Cancel Qualified), and stays null for anyone
  // who's never been qualified at all — so "!qualified && qualified_at" is
  // exactly "has lost Advanced before" without needing a new column. Takes
  // over the slot the generic behind-items banner would otherwise use,
  // since for this person the real fix isn't "finish ticking items", it's
  // retaking the exam that restores the title.
  const previouslyLostTitle = !targetProfile.qualified && !!targetProfile.qualified_at

  // Three-tiered defense: whichever title is currently held is the one
  // being defended — Master > Expert > Advanced, since a holder of a
  // higher title is never also mid-defending a lower one.
  const defenseDue = isDefenseDue(targetProfile)
  const showFormalDefenseBanner = isSelf && targetProfile.qualified && !targetProfile.has_expert_title && !targetProfile.has_master_title && defenseDue
  const showExpertDefenseBanner = isSelf && targetProfile.has_expert_title && !targetProfile.has_master_title && defenseDue
  const showMasterDefenseBanner = isSelf && targetProfile.has_master_title && defenseDue

  function phaseCanLevelUp(phaseNumber) {
    if (!isSelf) return false
    if (currentPhase !== phaseNumber - 1) return false
    const items = itemsByPhase[phaseNumber] ?? []
    return items.length > 0 && items.every((i) => i.memorized)
  }

  const showFormalInitial = isSelf && currentPhase >= 5 && !targetProfile.qualified
  const phase6Complete = phaseSixTotal > 0 && phaseSixMemorized === phaseSixTotal
  const phase7Complete = phaseSevenTotal > 0 && phaseSevenMemorized === phaseSevenTotal
  const showExpertVoluntary = isSelf && targetProfile.qualified && !targetProfile.has_expert_title && phase6Complete
  // Master requires Expert first — strict sequential progression through
  // the three title tiers, same as Expert requires Advanced (qualified)
  // first.
  const showMasterVoluntary = isSelf && targetProfile.has_expert_title && !targetProfile.has_master_title && phase7Complete

  function defendTopTitle() {
    if (targetProfile.has_master_title) setShowMaster({ isDefense: true })
    else if (targetProfile.has_expert_title) setShowExpert({ isDefense: true })
    else setShowFormal({ isDefense: true })
  }

  return (
    <div
      className="space-y-4 rounded-2xl p-4"
      style={{ background: 'linear-gradient(180deg, #fafaf9 0%, #f5f3ff 100%)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-100 bg-white px-4 py-3">
        <div>
          <p className="text-xs text-gray-400">Current title</p>
          <p className="text-lg font-semibold text-gray-900">
            {targetProfile.has_master_title ? '👑 ' : targetProfile.has_expert_title ? '🏅 ' : ''}
            {title}
          </p>
        </div>
        {isSelf && defenseDue && (
          <Button variant="secondary" onClick={defendTopTitle}>
            {targetProfile.has_master_title ? 'Defend Master Title' : targetProfile.has_expert_title ? 'Defend Expert Title' : 'Defend Advanced Title'}
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
      {showFormalDefenseBanner && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠️ Your Advanced title defense is due{targetProfile.title_defense_attempts_used ? ` — ${targetProfile.title_defense_attempts_used} of 3 attempts used` : ''}.
        </div>
      )}
      {showExpertDefenseBanner && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠️ Your Expert title defense is due — tick every Phase 6 item as Memorized if you haven't already, then retake the Expert Exam.
        </div>
      )}
      {showMasterDefenseBanner && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠️ Your Master title defense is due — tick every Phase 7 item as Memorized if you haven't already, then retake the Master Exam.
        </div>
      )}

      {/* Jeff, 2026-10-02: "工作小時填補phase的顏色再明顯一點，Phase 1放最下
          面，phase 6放在上面，這樣才有一直往上填補的感覺" — rendered
          top-to-bottom in DESCENDING phase order, so the column reads like
          a tower/thermometer filling upward — the highest tier sits at the
          top of the page, Phase 1 (the floor) at the bottom.
          Jeff, 2026-10-03 (Expert/Master split): Phase 7 (Master) now sits
          at the very top, Phase 6 (Expert) just below it, then a green
          "qualified" divider, then Phases 5..1 (hours-driven) below that.
          Phases 6 and 7 both render through this same loop (fraction = % of
          their own item pool memorized) rather than being visually separate
          blocks. Every card's own frame is a thick border in that phase's
          own text_color, unconditionally, so the column still reads as
          "phase 7 / 6 / 5…" at a glance even when a card is mid-way through
          filling.
          Phases 1-5 (hours-driven): NOT YET passed that phase's Level-Up
          Exam — the hours-worked fraction fills the card from the bottom in
          solid ORANGE at 50% opacity — "要有感覺phase區塊被佔領感覺，但顏色
          不要太深影響閱讀內容" — no border-top line on the fill (the orange
          block itself is the signal). ALREADY passed: the whole card fills
          with that phase's OWN color instead — "如果通過level up exam，則該
          phase色塊變回自己的顏色". A Qualified staff member has
          currentPhase>=5, so every one of phases 1-5 is "passed" and shows
          its own color (考試都過了). A staff member disqualified after
          losing a title defense drops back to currentPhase=4, so Phase 5
          goes back to NOT passed — rendering fully orange if hours worked
          exceed the sum of every phase's hours_required (fraction clamps
          to 1), or a partial orange fill otherwise, exactly Jeff's
          "advanced phase變回全橘色(工作小時超過...)，沒有超過的話則回照原
          本填補計算" — both cases fall out of the same fraction/passed
          logic below, no special-casing needed. */}
      {[7, 6, 5, 4, 3, 2, 1].map((phaseNumber) => {
        const p = phaseNumber === 7 ? phase7 : phaseNumber === 6 ? phase6 : phases.find((ph) => ph.phase_number === phaseNumber)
        if (!p) return null
        const fraction =
          phaseNumber === 7
            ? phaseSevenTotal > 0
              ? phaseSevenMemorized / phaseSevenTotal
              : 0
            : phaseNumber === 6
              ? phaseSixTotal > 0
                ? phaseSixMemorized / phaseSixTotal
                : 0
              : fractions[phaseNumber] ?? 0
        const items = phaseNumber <= 5 ? itemsByPhase[phaseNumber] ?? [] : phaseNumber === 6 ? phaseSixItems : phaseSevenItems
        const passed = phaseNumber <= 5 && currentPhase >= phaseNumber
        const canLevelUp = phaseNumber <= 5 && phaseCanLevelUp(phaseNumber)
        const complete = phaseNumber === 6 ? phase6Complete : phaseNumber === 7 ? phase7Complete : false

        return (
          <div key={phaseNumber}>
            <div className="relative overflow-hidden rounded-xl bg-white" style={{ border: `3px solid ${p.text_color}` }}>
              {phaseNumber <= 5 ? (
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
                  {phaseNumber <= 5 && <p className="text-xs text-gray-500">{Math.round(fraction * 100)}% hours filled</p>}
                </div>
                {/* Jeff, 2026-10-03 (follow-up): "所有phase區塊中間都要顯示X
                    out of Y" — every phase, not just 6/7, shows this same
                    prominent centered line now; X/Y both come from `items`,
                    which is already scoped to exactly this phase's own
                    pool above (itemsByPhase[n] for 1-5, the phase's own
                    exclusive pool for 6/7). */}
                <p className="mt-1 text-center text-sm font-semibold text-gray-700">
                  {items.filter((i) => i.memorized).length} out of {items.length} items memorized
                </p>

                {phaseNumber <= 5 && (
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

                {(phaseNumber === 6 || phaseNumber === 7) && (
                  <>
                    <button
                      className="mt-2 text-xs font-medium text-brand-600 hover:underline"
                      onClick={() => setItemsModalPhase(phaseNumber)}
                    >
                      View items ({items.length})
                    </button>
                    {phaseNumber === 6 && showExpertVoluntary && (
                      <Button className="mt-3 !px-3 !py-1.5 text-xs" onClick={() => setShowExpert({ isDefense: false })}>
                        🏅 Take Expert Exam
                      </Button>
                    )}
                    {phaseNumber === 7 && showMasterVoluntary && (
                      <Button className="mt-3 !px-3 !py-1.5 text-xs" onClick={() => setShowMaster({ isDefense: false })}>
                        🏆 Take Master Exam
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {phaseNumber === 6 && (
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
        <Modal open onClose={() => setItemsModalPhase(null)} title={`Phase ${itemsModalPhase} Items`}>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {(itemsModalPhase === 6 ? phaseSixItems : phaseSevenItems).length === 0 ? (
              <p className="text-xs text-gray-400">No items yet.</p>
            ) : (
              (itemsModalPhase === 6 ? phaseSixItems : phaseSevenItems).map((i) => (
                <label key={`${i.kind}-${i.id}`} className="flex items-center gap-2 border-b border-gray-100 py-1.5 text-sm text-gray-700 last:border-0">
                  <input type="checkbox" checked={i.memorized} onChange={(e) => toggleItem(i, e.target.checked)} />
                  {i.label}
                </label>
              ))
            )}
          </div>
        </Modal>
      )}

      {levelUpPhase && (
        <LevelUpExamModal
          phaseNumber={levelUpPhase}
          phaseLabel={phases.find((p) => p.phase_number === levelUpPhase)?.label}
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
      {showExpert && (
        <ExpertExamModal
          isDefense={showExpert.isDefense}
          onClose={() => setShowExpert(null)}
          onResult={({ passed }) => {
            if (passed && !showExpert.isDefense) setCongrats('Expert')
            reload()
          }}
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
