import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// One color per distinct time-slot label, so e.g. every "weekday morning"
// bar reads the same color across every day of the week at a glance. Picked
// by hashing the label text rather than by order of appearance, so a
// label's color stays the same across reloads regardless of what order
// rules come back in. Two DIFFERENT labels can still hash to the same
// color though — pickColor() below nudges one of them to the next palette
// color whenever that would land two different labels right next to each
// other on the same day's bar, so touching segments never blend together.
const BAR_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#0891b2', '#ca8a04', '#db2777']
function colorForLabel(label) {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return BAR_COLORS[hash % BAR_COLORS.length]
}
function pickColor(label, prevColor) {
  const base = colorForLabel(label)
  if (base !== prevColor) return base
  const idx = BAR_COLORS.indexOf(base)
  return BAR_COLORS[(idx + 1) % BAR_COLORS.length]
}

function parseMin(raw) {
  const nums = raw.split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n))
  return nums.length ? Math.min(...nums) : 0
}

// "16:00:00" / "16:00" -> 960 (minutes since midnight).
function timeToMinutes(raw) {
  const [h, m] = (raw || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function formatTime(raw) {
  const mins = timeToMinutes(raw)
  const h24 = Math.floor(mins / 60)
  const m = mins % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// Short axis-tick label, e.g. 630 -> "10:30am", 1080 -> "6pm".
function formatTickLabel(mins) {
  const h24 = Math.floor(mins / 60) % 24
  const m = mins % 60
  const ampm = h24 >= 12 ? 'pm' : 'am'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

// Tick marks across [open, close] — always includes both ends, plus evenly
// spaced hour marks in between (coarser for a long window, finer for a
// short one) so the axis stays readable whether a store is open 4 hours or
// 20.
function buildTicks(open, close) {
  const span = close - open
  const step = span > 12 * 60 ? 180 : span > 6 * 60 ? 120 : span > 2 * 60 ? 60 : 30
  const ticks = new Set([open, close])
  for (let t = Math.ceil(open / step) * step; t < close; t += step) ticks.add(t)
  return Array.from(ticks).sort((a, b) => a - b)
}

export default function RosterSettingsPage() {
  const { currentStoreId } = useAuth()
  const [rules, setRules] = useState([])
  // weekdayFrom === weekdayTo means a single day — same as before; picking
  // a wider range adds the same time slot/staffing rule to every weekday
  // in between in one go, instead of repeating "Add" once per day.
  const [form, setForm] = useState({ weekdayFrom: 1, weekdayTo: 1, label: '', start: '', end: '', counts: '' })
  // Which rule's ✕ button is mid-delete — that one button locks until the
  // request finishes, so a slow connection can't turn one click into two
  // deletes.
  const [removingId, setRemovingId] = useState(null)
  // Which rule is mid-save from the timeline's inline edit popover.
  const [savingId, setSavingId] = useState(null)
  // Add used to just silently do nothing when a required field (e.g. Label)
  // was left blank — from the outside that looked exactly like the button
  // being stuck/unresponsive. Now it tells you what's missing instead.
  const [error, setError] = useState('')
  // Every store keeps different hours, so the timeline below is scaled to
  // just this store's open–close window instead of always drawing the
  // full 24 hours with a big empty stretch before opening. Unset (blank)
  // falls back to the full day, same as before this existed.
  const [storeHours, setStoreHours] = useState({ open: '', close: '' })
  const [hoursSaving, setHoursSaving] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('roster_staffing_rules')
      .select('*')
      .eq('store_id', currentStoreId)
      .order('weekday')
    setRules(data ?? [])
  }

  async function loadStoreHours() {
    const { data } = await supabase.from('stores').select('roster_open_time, roster_close_time').eq('id', currentStoreId).single()
    setStoreHours({
      open: data?.roster_open_time?.slice(0, 5) ?? '',
      close: data?.roster_close_time?.slice(0, 5) ?? '',
    })
  }

  useEffect(() => {
    if (currentStoreId) {
      load()
      loadStoreHours()
    }
  }, [currentStoreId])

  async function saveHours() {
    setHoursSaving(true)
    await supabase
      .from('stores')
      .update({ roster_open_time: storeHours.open || null, roster_close_time: storeHours.close || null })
      .eq('id', currentStoreId)
    setHoursSaving(false)
  }

  async function addRule() {
    if (!form.label.trim() || !form.start || !form.end || !form.counts.trim()) {
      setError('Please fill in Label, start time, end time and required counts before adding.')
      return
    }
    setError('')
    const lo = Math.min(Number(form.weekdayFrom), Number(form.weekdayTo))
    const hi = Math.max(Number(form.weekdayFrom), Number(form.weekdayTo))
    const weekdays = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
    const { error: err } = await supabase.from('roster_staffing_rules').insert(
      weekdays.map((weekday) => ({
        store_id: currentStoreId,
        weekday,
        time_slot_label: form.label,
        time_slot_start: form.start,
        time_slot_end: form.end,
        required_counts_raw: form.counts,
        required_min: parseMin(form.counts),
      }))
    )
    if (err) {
      setError(err.message)
      return
    }
    setForm({ weekdayFrom: 1, weekdayTo: 1, label: '', start: '', end: '', counts: '' })
    load()
  }

  async function removeRule(id) {
    setRemovingId(id)
    await supabase.from('roster_staffing_rules').delete().eq('id', id)
    await load()
    setRemovingId(null)
  }

  // Edits a single existing rule in place (from the timeline popover's Edit
  // form) instead of the only previous option, delete-and-re-add. Returns
  // an error message string on failure, or null on success, so the popover
  // can show what went wrong without the caller needing its own state.
  async function updateRule(id, patch) {
    if (!patch.label.trim() || !patch.start || !patch.end || !patch.counts.trim()) {
      return 'Please fill in all fields.'
    }
    setSavingId(id)
    const { error: err } = await supabase
      .from('roster_staffing_rules')
      .update({
        time_slot_label: patch.label,
        time_slot_start: patch.start,
        time_slot_end: patch.end,
        required_counts_raw: patch.counts,
        required_min: parseMin(patch.counts),
      })
      .eq('id', id)
    await load()
    setSavingId(null)
    return err ? err.message : null
  }

  const windowStart = storeHours.open ? timeToMinutes(storeHours.open) : 0
  let windowEnd = storeHours.close ? timeToMinutes(storeHours.close) : 1440
  // An overnight window (close time earlier than open) isn't supported here
  // — fall back to the full day rather than collapsing the axis.
  if (windowEnd <= windowStart) windowEnd = 1440

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Setting</h1>

      <p className="mb-4 text-sm text-gray-500">
        Minimum staffing per weekday + time slot — used for the understaffed warning in Manage Roster. For multiple
        acceptable levels, separate numbers with commas (e.g. "2,3"). Pick a day range (e.g. Mon–Wed) to add the same
        rule to every day in between at once, instead of one at a time.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-brand-100 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Store opens</span>
          <input
            type="time"
            className="input"
            value={storeHours.open}
            onChange={(e) => setStoreHours({ ...storeHours, open: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Store closes</span>
          <input
            type="time"
            className="input"
            value={storeHours.close}
            onChange={(e) => setStoreHours({ ...storeHours, close: e.target.value })}
          />
        </label>
        <Button variant="secondary" onClick={saveHours} disabled={hoursSaving}>
          {hoursSaving ? 'Saving…' : 'Save hours'}
        </Button>
        <span className="text-xs text-gray-400">
          Scales the timeline below to this store's actual hours instead of the full 24 hours. Leave blank to show
          the full day.
        </span>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2 rounded-xl border border-brand-100 bg-white p-4 sm:grid-cols-5">
        <div className="flex items-center gap-1" title="Pick the same day twice for a single weekday, or a range to apply this rule to every day in between">
          <select className="input" value={form.weekdayFrom} onChange={(e) => setForm({ ...form, weekdayFrom: e.target.value })}>
            {WEEKDAYS_SHORT.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400">–</span>
          <select className="input" value={form.weekdayTo} onChange={(e) => setForm({ ...form, weekdayTo: e.target.value })}>
            {WEEKDAYS_SHORT.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <input className="input" placeholder="Label e.g. Morning" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input type="time" className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        <input type="time" className="input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        <div className="flex gap-1">
          <input className="input" placeholder="2,3" value={form.counts} onChange={(e) => setForm({ ...form, counts: e.target.value })} />
          <Button onClick={addRule}>Add</Button>
        </div>
      </div>
      {error && <p className="mb-4 text-xs text-red-600">{error}</p>}
      {!error && <div className="mb-3" />}

      {!rules.length ? (
        <EmptyState label="No staffing rules set yet." />
      ) : (
        <WeeklyTimelineView
          rules={rules}
          removingId={removingId}
          onRemove={removeRule}
          savingId={savingId}
          onSave={updateRule}
          windowStart={windowStart}
          windowEnd={windowEnd}
        />
      )}
    </div>
  )
}

// One horizontal bar per weekday, spanning the store's open–close window,
// with each staffing rule drawn as a colored segment positioned/sized by
// its start–end time and labelled with its required count — a shape/
// position at a glance instead of reading every rule's start/end time as
// text.
//
// Two separate popovers, so moving the mouse toward Edit/Delete doesn't
// dismiss them the moment it leaves the (often narrow) segment:
// - Hovering a segment (mouse; there's no real hover on mobile) shows a
//   quick read-only "label · time · count" tip that follows the cursor
//   the plain way — it opens on mouseenter and disappears on mouseleave,
//   exactly like a native tooltip.
// - Clicking a segment instead "pins" a second popover with Edit/Delete,
//   which — being driven by click rather than hover — stays open no
//   matter where the mouse moves, until the segment is clicked again or
//   the click lands elsewhere in this section.
function WeeklyTimelineView({ rules, removingId, onRemove, savingId, onSave, windowStart, windowEnd }) {
  const [hoverId, setHoverId] = useState(null)
  const [pinnedId, setPinnedId] = useState(null)
  const containerRef = useRef(null)
  useEffect(() => {
    // mousedown, not click: clicking "Edit" swaps that same popover's own
    // DOM (buttons -> input fields), and React applies that swap
    // synchronously before the click event finishes bubbling up to
    // document. A 'click' listener here would then find the original
    // button already detached from the page and (wrongly) conclude the
    // click landed "outside" this section, instantly re-closing the
    // popover it was just meant to switch into edit mode — Edit would
    // look like it silently does nothing. mousedown fires first, while
    // the DOM still matches what was actually clicked.
    function handleOutsideMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setPinnedId(null)
    }
    document.addEventListener('mousedown', handleOutsideMouseDown)
    return () => document.removeEventListener('mousedown', handleOutsideMouseDown)
  }, [])

  const span = windowEnd - windowStart
  const ticks = buildTicks(windowStart, windowEnd)
  const rulesByDay = Array.from({ length: 7 }, (_, d) =>
    rules.filter((r) => r.weekday === d).sort((a, b) => timeToMinutes(a.time_slot_start) - timeToMinutes(b.time_slot_start))
  )

  return (
    <div ref={containerRef} className="rounded-xl border border-brand-100 bg-white p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="w-10 shrink-0" />
        <div className="relative h-3 flex-1 text-[10px] text-gray-400">
          {ticks.map((t, i) => {
            const isFirst = i === 0
            const isLast = i === ticks.length - 1
            return (
              <span
                key={t}
                className={`absolute ${isFirst ? 'left-0' : isLast ? 'right-0' : '-translate-x-1/2'}`}
                style={isFirst || isLast ? undefined : { left: `${((t - windowStart) / span) * 100}%` }}
              >
                {formatTickLabel(t)}
              </span>
            )
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        {rulesByDay.map((dayRules, day) => {
          let prevColor = null
          return (
            <div key={day} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-xs font-medium text-gray-500">{WEEKDAYS_SHORT[day]}</span>
              <div className="relative h-9 flex-1 rounded-md border border-gray-200 bg-gray-50">
                {ticks.slice(1, -1).map((t) => (
                  <div key={t} className="absolute top-0 bottom-0 border-l border-gray-200" style={{ left: `${((t - windowStart) / span) * 100}%` }} />
                ))}
                {dayRules.map((rule) => {
                  const color = pickColor(rule.time_slot_label, prevColor)
                  prevColor = color
                  return (
                    <TimeSlotBar
                      key={rule.id}
                      rule={rule}
                      color={color}
                      windowStart={windowStart}
                      span={span}
                      hovering={hoverId === rule.id}
                      pinned={pinnedId === rule.id}
                      onHoverEnter={() => setHoverId(rule.id)}
                      onHoverLeave={() => setHoverId((cur) => (cur === rule.id ? null : cur))}
                      onTogglePin={() => setPinnedId((cur) => (cur === rule.id ? null : rule.id))}
                      removing={removingId === rule.id}
                      onRemove={() => onRemove(rule.id)}
                      saving={savingId === rule.id}
                      onSave={(patch) => onSave(rule.id, patch)}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TimeSlotBar({
  rule,
  color,
  windowStart,
  span,
  hovering,
  pinned,
  onHoverEnter,
  onHoverLeave,
  onTogglePin,
  removing,
  onRemove,
  saving,
  onSave,
}) {
  const startMin = timeToMinutes(rule.time_slot_start)
  const endMin = timeToMinutes(rule.time_slot_end)
  // A shift ending at/before its own start time (e.g. 22:00–02:00) crosses
  // midnight — split it into the two segments that actually fall within
  // this one day's 24-hour bar instead of drawing a negative-width bar.
  const rawSegments = endMin > startMin ? [[startMin, endMin]] : [[startMin, 1440], [0, endMin]]
  const windowClose = windowStart + span
  // Clip each segment to the store's open–close window — a rule that falls
  // (even partly) outside it is cropped to the visible part; one entirely
  // outside the window just doesn't draw anything.
  const visibleSegments = rawSegments.map(([s, e]) => [Math.max(s, windowStart), Math.min(e, windowClose)]).filter(([s, e]) => e > s)

  // The Edit form (label/start/end/counts) — lets a segment's time be
  // corrected in place instead of the only previous option, delete and
  // re-add. Reset back to the read-only view whenever the pinned popover
  // closes, so reopening it later doesn't reopen mid-edit.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [editError, setEditError] = useState('')
  useEffect(() => {
    if (!pinned) setEditing(false)
  }, [pinned])

  function startEdit() {
    setDraft({
      label: rule.time_slot_label,
      start: rule.time_slot_start?.slice(0, 5) ?? '',
      end: rule.time_slot_end?.slice(0, 5) ?? '',
      counts: rule.required_counts_raw,
    })
    setEditError('')
    setEditing(true)
  }

  async function handleSave() {
    const msg = await onSave(draft)
    if (msg) {
      setEditError(msg)
      return
    }
    // A successful save closes the whole popover instead of dropping back
    // to the Edit/Delete view — the segment itself now shows the updated
    // time, so there's nothing left to check here, and closing saves the
    // extra click to dismiss it manually.
    setEditing(false)
    onTogglePin()
  }

  if (!visibleSegments.length) return null
  const anchorPct = ((visibleSegments[0][0] - windowStart) / span) * 100

  return (
    <>
      {visibleSegments.map(([s, e], i) => (
        <div
          key={i}
          className="absolute top-0.5 bottom-0.5 flex cursor-pointer items-center justify-center overflow-hidden rounded text-[11px] font-semibold text-white"
          style={{
            left: `${((s - windowStart) / span) * 100}%`,
            width: `${((e - s) / span) * 100}%`,
            minWidth: '16px', // keeps a short shift's count readable/tappable instead of collapsing to a sliver
            backgroundColor: color,
          }}
          onMouseEnter={onHoverEnter}
          onMouseLeave={onHoverLeave}
          onClick={(evt) => {
            evt.stopPropagation()
            onTogglePin()
          }}
        >
          {rule.required_counts_raw}
        </div>
      ))}
      {/* Quick hover-only tip: label/time/count, no actions. Suppressed
          while pinned so it doesn't sit behind/overlap the pinned popover
          below. */}
      {hovering && !pinned && (
        <div
          className="pointer-events-none absolute top-full z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-2.5 text-xs shadow-lg"
          style={{ left: `clamp(0px, ${anchorPct}%, calc(100% - 12rem))` }}
        >
          <div className="font-semibold text-gray-800">{rule.time_slot_label}</div>
          <div className="mt-0.5 text-gray-500">
            {formatTime(rule.time_slot_start)}–{formatTime(rule.time_slot_end)} · Needs {rule.required_counts_raw}
          </div>
        </div>
      )}
      {/* Pinned by a click — Edit/Delete live here. Driven only by
          `pinned` (click state), never by hover, so moving the mouse off
          the segment toward these buttons can't dismiss it. */}
      {pinned && (
        <div
          className="absolute top-full z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-2.5 text-xs shadow-lg"
          style={{ left: `clamp(0px, ${anchorPct}%, calc(100% - 18rem))` }}
        >
          {!editing ? (
            <>
              <div className="font-semibold text-gray-800">{rule.time_slot_label}</div>
              <div className="mt-0.5 text-gray-500">
                {formatTime(rule.time_slot_start)}–{formatTime(rule.time_slot_end)} · Needs {rule.required_counts_raw}
              </div>
              <div className="mt-1.5 flex gap-3">
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
            </>
          ) : (
            <div className="space-y-1.5">
              <input
                className="input"
                placeholder="Label"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
              <div className="flex gap-2">
                <input type="time" className="input" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
                <input type="time" className="input" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
              </div>
              <input
                className="input"
                placeholder="2,3"
                value={draft.counts}
                onChange={(e) => setDraft({ ...draft, counts: e.target.value })}
              />
              {editError && <p className="text-red-600">{editError}</p>}
              <div className="flex items-center gap-3 pt-0.5">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-xs font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
