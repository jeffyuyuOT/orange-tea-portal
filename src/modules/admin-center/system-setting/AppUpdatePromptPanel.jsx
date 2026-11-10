import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'

// Jeff, 2026-11-10/11: admin switch for the popups AppShell.jsx shows about new versions
// (migration 0168, a column on the app_display_settings singleton). When on, staff who open
// the app after a new version is out get an "Update now / Update when I close the app" popup,
// and then a "What's new" list of the changes they haven't seen yet (lib/releaseNotes.js).
// The app no longer updates itself silently; when this is off nobody is prompted (people can
// still update from My Information > Check for Updates), so small tweaks don't nag everyone.
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
      <h2 className="mb-1 text-sm font-semibold text-brand-700">Update Popup</h2>
      <p className="mb-3 text-sm text-gray-500">
        When this is on and a new version of the app is out, staff see a popup about 10 seconds after opening the
        app (never while scanning to clock in/out) with two choices: "Update now", or "Update when I close the app"
        (applied when they switch away or lock the phone). After updating they also see a "What's new" list of
        changes they haven't seen yet. Keep it off while small changes build up, then turn it on when there is
        enough to announce. While it is off, nobody is prompted — staff can still update themselves from My
        Information &gt; Check for Updates.
      </p>

      {enabled === null ? (
        <LoadingSpinner />
      ) : (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Show the update popup (and "What's new")
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
