import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'

// Jeff, 2026-11-10: admin switch for the "What's new" popup AppShell.jsx shows (migration
// 0168, a column on the app_display_settings singleton; list in lib/releaseNotes.js). The app
// updates itself quietly either way — this only decides whether people are TOLD what changed,
// so small tweaks don't pop up constantly: leave it off while notes build up, turn it on when
// there's enough to announce, and each person sees what they haven't seen yet, once.
export default function AppUpdatePromptPanel() {
  const { profile } = useAuth()
  const [enabled, setEnabled] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    supabase
      .from('app_display_settings')
      .select('update_prompt_enabled')
      .maybeSingle()
      .then(({ data }) => setEnabled(data?.update_prompt_enabled ?? false))
  }, [])

  async function save() {
    setSaving(true)
    setMessage('')
    const { error } = await supabase
      .from('app_display_settings')
      .update({ update_prompt_enabled: enabled, updated_by: profile?.id ?? null })
      .eq('singleton', true)
    setMessage(error ? 'Could not save — please try again.' : 'Saved.')
    setSaving(false)
  }

  return (
    <section className="rounded-xl border border-brand-100 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-brand-700">What's New Popup</h2>
      <p className="mb-3 text-sm text-gray-500">
        The app already updates itself quietly in the background. This switch controls whether staff also see a
        "What's new" popup listing the changes they haven't seen yet (about 10 seconds after they open the app, and
        not while they are scanning to clock in/out). Keep it off while small changes build up, then turn it on when
        there is enough worth announcing — everyone sees each item once. Nothing is lost while it is off.
      </p>

      {enabled === null ? (
        <LoadingSpinner />
      ) : (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Show the "What's new" popup
        </label>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button onClick={save} disabled={enabled === null || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {message && <span className="text-xs text-gray-500">{message}</span>}
      </div>
    </section>
  )
}
