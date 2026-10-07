import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'

// Jeff, 2026-10-02 (Training Journey spec, point 5; phase-merge, 2026-10-07,
// point 1): per-phase styling + pacing, backing `training_journey_phases`
// (migration 0096 — 4 rows, phase_number 1-4: Novice/Practitioner/Advanced/
// Master). Phase names are fixed, not editable here — only color, how many
// hours worked fill each phase (1-3 only; Phase 4/Master fills by memorized
// items instead, see TrainingJourneyPage.jsx), and each phase's Level-Up
// Exam question count.
export default function PhaseSettingTab() {
  const [phases, setPhases] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('training_journey_phases')
      .select('*')
      .order('phase_number')
      .then(({ data }) => {
        setPhases(data ?? [])
        setLoading(false)
      })
  }, [])

  function update(phaseNumber, patch) {
    setPhases((prev) => prev.map((p) => (p.phase_number === phaseNumber ? { ...p, ...patch } : p)))
  }

  async function save() {
    setSaving(true)
    const results = await Promise.all(
      phases.map((p) =>
        supabase
          .from('training_journey_phases')
          .update({
            hours_required: p.phase_number <= 3 ? p.hours_required : null,
            bg_color: p.bg_color,
            text_color: p.text_color,
            level_up_exam_question_count: p.phase_number <= 3 ? p.level_up_exam_question_count : null,
          })
          .eq('phase_number', p.phase_number)
      )
    )
    setSaving(false)
    const err = results.find((r) => r.error)?.error
    if (err) alert(err.message)
  }

  if (loading) return null

  const totalHours = phases.filter((p) => p.phase_number <= 3).reduce((sum, p) => sum + (Number(p.hours_required) || 0), 0)

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        Each phase's color (used on its Training Journey card, and — once a staff member reaches it — their roster
        name/time if System Setting's "Roster Name Display Format" is set to show titles), how many hours worked
        fill it, and how many questions its Level-Up Exam draws.
      </p>

      <div className="space-y-3">
        {phases.map((p) => (
          <div key={p.phase_number} className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white p-3">
            <span
              className="w-36 shrink-0 rounded-lg px-3 py-1.5 text-center text-sm font-semibold"
              style={{ background: p.bg_color, color: p.text_color }}
            >
              Phase {p.phase_number}: {p.label}
            </span>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Background
              <input
                type="color"
                value={p.bg_color}
                onChange={(e) => update(p.phase_number, { bg_color: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Text
              <input
                type="color"
                value={p.text_color}
                onChange={(e) => update(p.phase_number, { text_color: e.target.value })}
              />
            </label>
            {p.phase_number <= 3 ? (
              <>
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  Hours to fill
                  <input
                    type="number"
                    min="0"
                    className="input w-24"
                    value={p.hours_required ?? ''}
                    onChange={(e) => update(p.phase_number, { hours_required: Number(e.target.value) })}
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  Level-Up Exam questions
                  <input
                    type="number"
                    min="1"
                    className="input w-20"
                    value={p.level_up_exam_question_count ?? ''}
                    onChange={(e) => update(p.phase_number, { level_up_exam_question_count: Number(e.target.value) })}
                  />
                </label>
              </>
            ) : (
              <span className="text-xs text-gray-400">Phase 4 fills by % of all items memorized, not hours or a Level-Up Exam.</span>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-gray-400">Phase 1–3 total: {totalHours} hours worked to reach Phase 3 (Advanced) from hours alone.</p>

      <Button onClick={save} disabled={saving} className="mt-4">
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}
