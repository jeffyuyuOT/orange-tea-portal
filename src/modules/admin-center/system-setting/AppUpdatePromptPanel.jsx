import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'

// Jeff, 2026-11-10: admin switch for the "new version available" popup AppShell.jsx
// shows (migration 0168, a column on the app_display_settings singleton). Lets an
// admin batch several small changes and only turn this on once there's something
// worth asking everyone to update for. Off = nobody gets the popup; anyone can still
// update themselves from My Information > Check for Updates.
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
      <h2 className="mb-1 text-sm font-semibold text-brand-700">Update Available Popup</h2>
      <p className="mb-3 text-sm text-gray-500">
        When a new version has been released, show staff an "Update now / Later" popup about 10 seconds after they open
        the app (held back while they are scanning to clock in/out). Keep this off while you are still making small
        changes, and turn it on once enough have built up to be worth asking everyone to update. Staff can always
        update themselves from My Information &gt; Check for Updates, whichever way this is set.
      </p>

      {enabled === null ? (
        <LoadingSpinner />
      ) : (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Show the update popup
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
