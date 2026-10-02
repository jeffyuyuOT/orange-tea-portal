import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'

const OPTIONS = [
  {
    value: 'original',
    label: 'Original',
    description: 'Today\'s behavior, unchanged: a not-yet-Qualified staff member\'s name/shift time shows in red, everyone else default.',
  },
  {
    value: 'title_crown',
    label: 'Title mode, with crown',
    description:
      'Name/shift time colored by Training Journey phase (Phase 1–4 each in their own color; Advanced and Master both default/black, to avoid clutter) — Master gets a 👑.',
  },
  {
    value: 'title_no_crown',
    label: 'Title mode, no crown',
    description: 'Same phase coloring as above, but without the 👑 — a Master titleholder then reads identically to Advanced.',
  },
]

// Jeff, 2026-10-02 (Training Journey spec, point 6): one global singleton
// (app_display_settings, migration 0091 — same "singleton boolean primary
// key" shape as every other one-row admin setting) controlling how
// RosterWeekTable.jsx (Bulletin Board's Roster view + My Roster) and
// RosterEntryGrid.jsx (Manage Roster) color staff names/shift times. 'Break'
// stays red in every mode — it was never tied to Qualified/title. Phase 0
// (Trainee) always reads red in either title mode too, same reasoning as
// 'original''s not-yet-Qualified red.
export default function RosterDisplayFormatPanel() {
  const { profile } = useAuth()
  const [value, setValue] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    supabase
      .from('app_display_settings')
      .select('roster_name_display_format')
      .maybeSingle()
      .then(({ data }) => setValue(data?.roster_name_display_format ?? 'original'))
  }, [])

  async function save() {
    setSaving(true)
    setMessage('')
    const { error } = await supabase
      .from('app_display_settings')
      .update({ roster_name_display_format: value, updated_by: profile?.id ?? null })
      .eq('singleton', true)
    setMessage(error ? 'Could not save — please try again.' : 'Saved.')
    setSaving(false)
  }

  return (
    <section className="rounded-xl border border-brand-100 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-brand-700">Roster Name Display Format</h2>
      <p className="mb-3 text-sm text-gray-500">
        How staff names/shift times are colored on the Bulletin Board's Roster view, My Roster, and Manage Roster.
      </p>

      {value === null ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-2">
          {OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${
                value === opt.value ? 'border-brand-400 bg-brand-50' : 'border-gray-200'
              }`}
            >
              <input
                type="radio"
                name="roster_name_display_format"
                className="mt-0.5"
                checked={value === opt.value}
                onChange={() => setValue(opt.value)}
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">{opt.label}</span>
                <span className="block text-xs text-gray-500">{opt.description}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button onClick={save} disabled={value === null || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {message && <span className="text-xs text-gray-500">{message}</span>}
      </div>
    </section>
  )
}
