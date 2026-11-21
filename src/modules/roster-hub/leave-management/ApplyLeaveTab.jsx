import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import { findBlockedDate } from '../../../lib/leaveLimits'
import { brisbaneLocalToIso } from '../../../lib/brisbaneTime'
import LeaveDateRangeFields from './LeaveDateRangeFields'

// Jeff, 2026-09-30: "Leave申請的時候，start的時間預設是一天的開始(12am)，End
// 的時間預設是一天的最後,而不是當下的時間，因為通常leave是請一整天，除非有特定
// 時段才會自己去輸入時間" -- leave is normally requested for a whole day, so
// default Start/End to today's 00:00/23:59 instead of the browser's "now"
// (a bare `useState('')` datetime-local input just shows the current time
// when first opened). Editing only the date portion of a datetime-local
// input via its native picker leaves the time portion untouched, so picking
// a different day keeps these same full-day bounds -- someone who actually
// needs a partial-day leave can still type a specific time in manually.
function pad2(n) {
  return String(n).padStart(2, '0')
}
function todayAt(hh, mm) {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(hh)}:${pad2(mm)}`
}

export default function ApplyLeaveTab() {
  const { profile, currentStoreId, accessibleStores } = useAuth()
  const stores = accessibleStores ?? []
  const [startAt, setStartAt] = useState(() => todayAt(0, 0))
  const [endAt, setEndAt] = useState(() => todayAt(23, 59))
  // Jeff, 2026-10-02: "specific time" checkbox — unchecked (the default,
  // matching the whole-day-by-default behavior above) shows date-only
  // pickers; checking it reveals the full start/end time pickers. See
  // LeaveDateRangeFields.jsx.
  const [specificTime, setSpecificTime] = useState(false)
  const [reason, setReason] = useState('')
  const [overlapping, setOverlapping] = useState([])
  // This store's leave-limit settings (Roster Hub > Setting > Leave
  // limits) — loaded once per store, then checked against `overlapping`
  // below whenever the picked dates change.
  const [limitDefaults, setLimitDefaults] = useState(null)
  const [limitPeriods, setLimitPeriods] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  // Jeff, 2026-11-21: someone who works at more than one shop is asked, on
  // submit, whether this leave also applies to their other shop(s) — leave is
  // stored per store, so "this shop only" leaves them schedulable elsewhere.
  // [{ id, name }] — the person's OTHER active shops (not the one selected).
  const [otherStores, setOtherStores] = useState([])
  const [askStores, setAskStores] = useState(false)
  // Jeff, 2026-11-22: "also apply to shops應該要可以勾選要apply to哪些店" — which of
  // the other shops are ticked in the popup (ids). Defaults to all of them.
  const [pickedStoreIds, setPickedStoreIds] = useState([])

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    ;(async () => {
      const [{ data: us }, { data: primary }] = await Promise.all([
        supabase.from('user_stores').select('stores ( id, name, is_active )').eq('profile_id', profile.id),
        profile.primary_store_id
          ? supabase.from('stores').select('id, name, is_active').eq('id', profile.primary_store_id)
          : Promise.resolve({ data: [] }),
      ])
      if (cancelled) return
      const byId = new Map()
      ;[...(primary ?? []), ...(us ?? []).map((r) => r.stores).filter(Boolean)].forEach((s) => {
        if (s.is_active !== false) byId.set(s.id, { id: s.id, name: s.name })
      })
      setOtherStores(Array.from(byId.values()))
    })()
    return () => {
      cancelled = true
    }
  }, [profile?.id, profile?.primary_store_id])

  const otherStoresExcludingCurrent = otherStores.filter((s) => s.id !== currentStoreId)

  useEffect(() => {
    if (!currentStoreId) return
    Promise.all([
      supabase.from('leave_limit_defaults').select('*').eq('store_id', currentStoreId).maybeSingle(),
      supabase.from('leave_limit_periods').select('*').eq('store_id', currentStoreId),
    ]).then(([{ data: d }, { data: p }]) => {
      setLimitDefaults(d ?? null)
      setLimitPeriods(p ?? [])
    })
  }, [currentStoreId])

  useEffect(() => {
    if (!startAt || !endAt || !currentStoreId || endAt < startAt) {
      setOverlapping([])
      return
    }
    // Jeff, 2026-10-02: compared against the raw datetime-local strings
    // before — same missing-timezone bug as the insert below (see
    // brisbaneTime.js), which could make this overlap check itself wrong
    // by up to 10 hours. Converted the same way for an accurate comparison.
    supabase
      .from('leave_requests')
      .select('*, profiles(first_name,last_name)')
      .eq('store_id', currentStoreId)
      .eq('status', 'active')
      .lt('start_at', brisbaneLocalToIso(endAt))
      .gt('end_at', brisbaneLocalToIso(startAt))
      .then(({ data }) => setOverlapping(data ?? []))
  }, [startAt, endAt, currentStoreId])

  // Jeff, 2026-10-02: "end的日期比開始日期還早要跳出錯誤提示" — every
  // date-range picker needs this same guard; this is Apply Leave's.
  const rangeInvalid = startAt && endAt && endAt < startAt

  // The first day (if any) in the picked range that's already at this
  // store's leave-limit cap, checked against everyone ELSE already on
  // active leave that day — not counting this application itself, since
  // it's the one asking to be added.
  const blockedDate =
    startAt && endAt ? findBlockedDate(startAt, endAt, limitDefaults, limitPeriods, overlapping) : null

  // Same cap check as above, run for a shop other than the selected one.
  async function findBlockedForStore(storeId) {
    const [{ data: d }, { data: p }, { data: others }] = await Promise.all([
      supabase.from('leave_limit_defaults').select('*').eq('store_id', storeId).maybeSingle(),
      supabase.from('leave_limit_periods').select('*').eq('store_id', storeId),
      supabase
        .from('leave_requests')
        .select('*')
        .eq('store_id', storeId)
        .eq('status', 'active')
        .lt('start_at', brisbaneLocalToIso(endAt))
        .gt('end_at', brisbaneLocalToIso(startAt)),
    ])
    return findBlockedDate(startAt, endAt, d ?? null, p ?? [], others ?? [])
  }

  function submit() {
    if (rangeInvalid) {
      setMessage('Error: End date/time can’t be before the start.')
      return
    }
    if (blockedDate) {
      alert(
        `Leave is full for ${new Date(`${blockedDate.dateKey}T00:00:00`).toLocaleDateString()} (max ${blockedDate.max} ` +
          `people already on leave) — this leave request can't be submitted for that period.`
      )
      return
    }
    // Works at another shop too -> ask first (see otherStores above).
    if (otherStoresExcludingCurrent.length) {
      setPickedStoreIds(otherStoresExcludingCurrent.map((s) => s.id))
      setAskStores(true)
      return
    }
    register([])
  }

  function togglePickedStore(id) {
    setPickedStoreIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // `alsoStoreIds` = the other shops (by id) this leave should ALSO be saved to;
  // empty = the selected shop only.
  async function register(alsoStoreIds) {
    setAskStores(false)
    setSubmitting(true)
    setMessage('')
    const row = (storeId) => ({
      profile_id: profile.id,
      store_id: storeId,
      start_at: brisbaneLocalToIso(startAt),
      end_at: brisbaneLocalToIso(endAt),
      reason,
    })
    const { error } = await supabase.from('leave_requests').insert(row(currentStoreId))
    if (error) {
      setSubmitting(false)
      setMessage(`Error: ${error.message}`)
      return
    }
    const done = [stores.find((s) => s.id === currentStoreId)?.name ?? 'this shop']
    const skipped = []
    if (alsoStoreIds.length) {
      for (const s of otherStoresExcludingCurrent.filter((o) => alsoStoreIds.includes(o.id))) {
        // Each shop has its own leave cap — don't push someone past it.
        const blocked = await findBlockedForStore(s.id)
        if (blocked) {
          skipped.push(`${s.name} (leave is full on ${new Date(`${blocked.dateKey}T00:00:00`).toLocaleDateString()})`)
          continue
        }
        const { error: e2 } = await supabase.from('leave_requests').insert(row(s.id))
        if (e2) skipped.push(`${s.name} (${e2.message})`)
        else done.push(s.name)
      }
    }
    setSubmitting(false)
    setMessage(
      `Leave registered for ${done.join(', ')}.` + (skipped.length ? ` Not applied to: ${skipped.join('; ')}.` : '')
    )
    setStartAt(todayAt(0, 0))
    setEndAt(todayAt(23, 59))
    setSpecificTime(false)
    setReason('')
  }

  return (
    <div className="max-w-lg space-y-4">
      <LeaveDateRangeFields
        startAt={startAt}
        endAt={endAt}
        specificTime={specificTime}
        onChange={(next) => {
          setStartAt(next.startAt)
          setEndAt(next.endAt)
          setSpecificTime(next.specificTime)
        }}
      />
      {rangeInvalid && <p className="text-sm text-red-600">End date/time can’t be before the start.</p>}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Reason (optional)</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>

      {startAt && endAt && (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">Others on leave during this period:</p>
          {overlapping.length === 0 ? (
            <EmptyState label="No one else is on leave in this window." />
          ) : (
            <ul className="space-y-1 text-sm text-gray-600">
              {overlapping.map((l) => (
                <li key={l.id}>
                  {l.profiles?.first_name} {l.profiles?.last_name}: {new Date(l.start_at).toLocaleString()} –{' '}
                  {new Date(l.end_at).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {blockedDate && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Leave is full for {new Date(`${blockedDate.dateKey}T00:00:00`).toLocaleDateString()} (max {blockedDate.max}{' '}
          people) — this request can't be submitted as-is.
        </div>
      )}

      <Button onClick={submit} disabled={submitting || !startAt || !endAt || rangeInvalid}>
        {submitting ? 'Submitting…' : 'Confirm & Register Leave'}
      </Button>
      {message && <p className="text-sm text-brand-600">{message}</p>}

      <Modal
        open={askStores}
        onClose={() => setAskStores(false)}
        title="Also apply to your other shops?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAskStores(false)}>
              Back
            </Button>
            <Button onClick={() => register(pickedStoreIds)} disabled={submitting}>
              {pickedStoreIds.length
                ? `Apply to ${stores.find((s) => s.id === currentStoreId)?.name ?? 'this shop'} + ${pickedStoreIds.length} other shop${pickedStoreIds.length === 1 ? '' : 's'}`
                : `${stores.find((s) => s.id === currentStoreId)?.name ?? 'This shop'} only`}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-gray-600">
          This leave will be registered at {stores.find((s) => s.id === currentStoreId)?.name ?? 'this shop'}. Tick the other
          shops it should also apply to. Shops you leave unticked stay open, so you can still be rostered there for these dates.
        </p>
        <div className="space-y-2 rounded-lg border border-gray-200 p-3">
          {otherStoresExcludingCurrent.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={pickedStoreIds.includes(s.id)} onChange={() => togglePickedStore(s.id)} />
              {s.name}
            </label>
          ))}
        </div>
      </Modal>
    </div>
  )
}
