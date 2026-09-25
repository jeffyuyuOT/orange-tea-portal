import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// Caps how many people this store lets be on leave at the same time —
// a weekday/weekend default, plus optional custom date-range overrides
// (e.g. a public holiday week) that win over the default for the dates
// they cover. Enforced in Apply Leave (see src/lib/leaveLimits.js) — this
// tab only edits the settings themselves.
export default function LeaveLimitsTab() {
  const { profile, currentStoreId } = useAuth()
  const [defaults, setDefaults] = useState({ weekday_max: '', weekend_max: '' })
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [periods, setPeriods] = useState([])
  const [form, setForm] = useState({ label: '', start: '', end: '', max: '' })
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState(null)

  async function load() {
    const [{ data: d }, { data: p }] = await Promise.all([
      supabase.from('leave_limit_defaults').select('*').eq('store_id', currentStoreId).maybeSingle(),
      supabase.from('leave_limit_periods').select('*').eq('store_id', currentStoreId).order('start_date'),
    ])
    setDefaults({ weekday_max: d?.weekday_max ?? '', weekend_max: d?.weekend_max ?? '' })
    setPeriods(p ?? [])
  }

  useEffect(() => {
    if (currentStoreId) load()
  }, [currentStoreId])

  async function saveDefaults() {
    setSavingDefaults(true)
    await supabase.from('leave_limit_defaults').upsert(
      {
        store_id: currentStoreId,
        weekday_max: defaults.weekday_max === '' ? null : Number(defaults.weekday_max),
        weekend_max: defaults.weekend_max === '' ? null : Number(defaults.weekend_max),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_id' }
    )
    setSavingDefaults(false)
  }

  async function addPeriod() {
    if (!form.start || !form.end || !form.max.trim()) {
      setError('Please fill in start date, end date and max people before adding.')
      return
    }
    if (form.end < form.start) {
      setError('End date must be on or after the start date.')
      return
    }
    setError('')
    setAdding(true)
    const meName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email
    const { data, error: err } = await supabase
      .from('leave_limit_periods')
      .insert({
        store_id: currentStoreId,
        label: form.label.trim() || null,
        start_date: form.start,
        end_date: form.end,
        max_count: Number(form.max),
        created_by: profile.id,
        created_by_name: meName,
      })
      .select()
      .single()
    setAdding(false)
    if (err) {
      setError(err.message)
      return
    }
    setPeriods((prev) => [...prev, data].sort((a, b) => a.start_date.localeCompare(b.start_date)))
    setForm({ label: '', start: '', end: '', max: '' })
  }

  async function updatePeriod(id, patch) {
    const { error: err } = await supabase
      .from('leave_limit_periods')
      .update({ label: patch.label.trim() || null, start_date: patch.start, end_date: patch.end, max_count: Number(patch.max) })
      .eq('id', id)
    if (err) return err.message
    setPeriods((prev) =>
      prev
        .map((p) =>
          p.id === id
            ? { ...p, label: patch.label.trim() || null, start_date: patch.start, end_date: patch.end, max_count: Number(patch.max) }
            : p
        )
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
    )
    return null
  }

  async function removePeriod(id) {
    setRemovingId(id)
    await supabase.from('leave_limit_periods').delete().eq('id', id)
    setPeriods((prev) => prev.filter((p) => p.id !== id))
    setRemovingId(null)
  }

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        Caps how many people can be on approved leave at the same time for this store. Applying for leave that would
        push any day over its limit is blocked with a warning naming that day. A custom period below overrides the
        weekday/weekend default for the dates it covers.
      </p>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-brand-100 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Weekday max (Mon–Fri)</span>
          <input
            type="number"
            min="0"
            className="input w-36"
            placeholder="No limit"
            value={defaults.weekday_max}
            onChange={(e) => setDefaults({ ...defaults, weekday_max: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Weekend max (Sat–Sun)</span>
          <input
            type="number"
            min="0"
            className="input w-36"
            placeholder="No limit"
            value={defaults.weekend_max}
            onChange={(e) => setDefaults({ ...defaults, weekend_max: e.target.value })}
          />
        </label>
        <Button variant="secondary" onClick={saveDefaults} disabled={savingDefaults}>
          {savingDefaults ? 'Saving…' : 'Save defaults'}
        </Button>
        <span className="text-xs text-gray-400">Leave blank for no limit on that kind of day.</span>
      </div>

      <h3 className="mb-2 text-sm font-semibold text-brand-700">Custom periods</h3>
      <p className="mb-3 text-xs text-gray-400">
        Override the default above for a specific date range (e.g. a public holiday week) — if more than one period
        covers the same day, the lowest max wins.
      </p>

      <div className="mb-2 grid grid-cols-2 gap-2 rounded-xl border border-brand-100 bg-white p-4 sm:grid-cols-5">
        <input
          className="input"
          placeholder="Label (optional)"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
        <input type="date" className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        <input type="date" className="input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        <input
          type="number"
          min="0"
          className="input"
          placeholder="Max people"
          value={form.max}
          onChange={(e) => setForm({ ...form, max: e.target.value })}
        />
        <Button onClick={addPeriod} disabled={adding}>
          {adding ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error && <p className="mb-4 text-xs text-red-600">{error}</p>}
      {!error && <div className="mb-3" />}

      {!periods.length ? (
        <EmptyState label="No custom periods set." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {periods.map((p) => (
            <PeriodRow key={p.id} period={p} onSave={(patch) => updatePeriod(p.id, patch)} onRemove={() => removePeriod(p.id)} removing={removingId === p.id} />
          ))}
        </div>
      )}
    </div>
  )
}

// One row: read-only summary with Edit/Delete, or (once Edit is clicked)
// the same fields as the Add form above, pre-filled — same in-place-edit
// pattern as RosterSettingsPage's staffing rules.
function PeriodRow({ period, onSave, onRemove, removing }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setDraft({ label: period.label ?? '', start: period.start_date, end: period.end_date, max: String(period.max_count) })
    setError('')
    setEditing(true)
  }

  async function handleSave() {
    if (!draft.start || !draft.end || !draft.max.trim()) {
      setError('Please fill in start date, end date and max people.')
      return
    }
    if (draft.end < draft.start) {
      setError('End date must be on or after the start date.')
      return
    }
    setSaving(true)
    const msg = await onSave(draft)
    setSaving(false)
    if (msg) {
      setError(msg)
      return
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-5">
        <input className="input" placeholder="Label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <input type="date" className="input" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
        <input type="date" className="input" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
        <input type="number" min="0" className="input" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} />
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving} className="!px-3">
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={() => setEditing(false)} className="!px-3">
            Cancel
          </Button>
        </div>
        {error && <p className="col-span-full text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <div className="text-sm text-gray-700">
        <span className="font-medium text-gray-800">{period.label || '(no label)'}</span>{' '}
        <span className="text-gray-500">
          {period.start_date} – {period.end_date} · max {period.max_count}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={startEdit} className="text-xs font-medium text-brand-600 hover:underline">
          Edit
        </button>
        <button
          onClick={onRemove}
          disabled={removing}
          className="text-xs font-medium text-red-500 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          {removing ? 'Removing…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}
