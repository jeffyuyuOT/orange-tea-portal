// Jeff, 2026-11-27: Availability Cut-off Settings + manager approval.
//
// A staff member can NOT change availability / leave by themselves when:
//   1. the roster for the week being changed is already submitted (leave too), or
//   2. they are changing NEXT week's availability after this week's cut-off
//      (store setting: weekday + time, Brisbane time).
// In both cases the change becomes a schedule_change_requests row that the
// store's designated approver confirms (decide_schedule_change(), migration
// 0170); only then does it take effect. Admin / developer / shop managers are
// not held up by this — they can approve their own changes anyway.
import { addDays, format, parseISO } from 'date-fns'
import { supabase } from './supabaseClient'
import { describeDay, editDayToRowShape, weekDatesFrom } from './availability'
import { thisWeekStart } from '../modules/roster-hub/shared/rosterWeeks'

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const APPROVAL_EXEMPT_ROLES = ['admin', 'developer', 'shop_manager']
export const APPROVER_ROLES = ['admin', 'shop_manager', 'developer']

export function isApprovalExempt(profile) {
  return APPROVAL_EXEMPT_ROLES.includes(profile?.role)
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function formatClock(timeStr) {
  const [h, m] = String(timeStr || '23:59').slice(0, 5).split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function formatCutoff(weekday, timeStr) {
  return `${WEEKDAY_NAMES[weekday] ?? '?'} ${formatClock(timeStr)}`
}

// A store's cut-off settings: { weekday, time ('HH:MM'), approverId, approverName } — or null if unreadable.
export async function loadStoreCutoff(storeId) {
  if (!storeId) return null
  const { data } = await supabase
    .from('stores')
    .select('availability_cutoff_weekday, availability_cutoff_time, availability_approver_id')
    .eq('id', storeId)
    .maybeSingle()
  if (!data) return null
  let approverName = ''
  if (data.availability_approver_id) {
    const { data: ap } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', data.availability_approver_id)
      .maybeSingle()
    approverName = `${ap?.first_name ?? ''} ${ap?.last_name ?? ''}`.trim()
  }
  return {
    weekday: data.availability_cutoff_weekday,
    time: String(data.availability_cutoff_time ?? '23:59').slice(0, 5),
    approverId: data.availability_approver_id ?? null,
    approverName: approverName || 'your manager',
  }
}

// The moment the cut-off for editing `weekStartStr` ('yyyy-MM-dd', a Monday) passes.
// It sits in the week BEFORE that week: Monday-based offset of the cut-off weekday.
export function cutoffDeadline(weekStartStr, weekday, timeStr) {
  const offset = (weekday + 6) % 7 // Mon=0 ... Sun=6
  const day = format(addDays(parseISO(weekStartStr), -7 + offset), 'yyyy-MM-dd')
  return new Date(`${day}T${String(timeStr).slice(0, 5)}:00+10:00`)
}

export function isPastCutoff(weekStartStr, cutoff, now = new Date()) {
  if (!cutoff || cutoff.weekday == null) return false
  if (weekStartStr <= thisWeekStart()) return false // the cut-off only governs future weeks
  return now > cutoffDeadline(weekStartStr, cutoff.weekday, cutoff.time)
}

// Which of `weekStartStrs` have a SUBMITTED roster in any of `storeIds`.
export async function submittedWeeks(storeIds, weekStartStrs) {
  if (!storeIds?.length || !weekStartStrs?.length) return new Set()
  const { data } = await supabase
    .from('roster_periods')
    .select('week_start_date')
    .eq('status', 'submitted')
    .in('store_id', storeIds)
    .in('week_start_date', weekStartStrs)
  return new Set((data ?? []).map((r) => r.week_start_date))
}

// -> { needsApproval, reason: 'cutoff' | 'roster_submitted' | null }
export async function getAvailabilityWeekLock({ profile, storeIds, cutoff, weekStart }) {
  if (isApprovalExempt(profile)) return { needsApproval: false, reason: null }
  const submitted = await submittedWeeks(storeIds, [weekStart])
  if (submitted.has(weekStart)) return { needsApproval: true, reason: 'roster_submitted' }
  if (isPastCutoff(weekStart, cutoff)) return { needsApproval: true, reason: 'cutoff' }
  return { needsApproval: false, reason: null }
}

export function lockReasonText(reason, cutoff) {
  if (reason === 'roster_submitted') return "this week's roster has already been submitted"
  if (reason === 'cutoff') return `the cut-off (${formatCutoff(cutoff?.weekday, cutoff?.time)}) has passed`
  return ''
}

// Of `storeIds`, the ones whose roster is submitted for any week touching [startLocal, endLocal]
// ('YYYY-MM-DDTHH:mm' Brisbane wall-clock strings, as in Apply Leave).
export async function storesWithSubmittedRoster(storeIds, startLocal, endLocal) {
  if (!storeIds?.length || !startLocal || !endLocal) return new Set()
  const { data } = await supabase
    .from('roster_periods')
    .select('store_id')
    .eq('status', 'submitted')
    .in('store_id', storeIds)
    .lte('week_start_date', endLocal.slice(0, 10))
    .gte('week_end_date', startLocal.slice(0, 10))
  return new Set((data ?? []).map((r) => r.store_id))
}

// Plain-text change lines for the approver ("Mon 3 Nov: All day available → Before 2:00 PM").
export function buildAvailabilityDetails(weekStartStr, oldByDate, newEditState) {
  const lines = []
  weekDatesFrom(weekStartStr).forEach((d) => {
    const before = describeDay(oldByDate?.[d]?.dayRow, oldByDate?.[d]?.windows)
    const nd = editDayToRowShape(newEditState[d])
    const after = describeDay(nd.dayRow, nd.windows)
    if (before !== after) lines.push(`${format(parseISO(d), 'EEE d MMM')}: ${before} → ${after}`)
  })
  return lines
}

// Sends a System message (no real sender) to `recipientIds`.
export async function sendSystemMessage({ storeId, senderId, recipientIds, subject, html }) {
  const ids = Array.from(new Set((recipientIds ?? []).filter(Boolean)))
  if (!storeId || !ids.length) return
  const { data: msg, error } = await supabase
    .from('messages')
    .insert({ store_id: storeId, sender_id: senderId, sender_name: 'System', subject, content_html: html })
    .select()
    .single()
  if (error || !msg) return
  await supabase.from('message_recipients').insert(ids.map((id) => ({ message_id: msg.id, profile_id: id })))
}

// Creates a pending request and messages the approver. Returns { error } like the other helpers here.
export async function createChangeRequest({ profile, storeId, approverId, kind, reasonCode, weekStart = null, title, details, payload }) {
  if (kind === 'availability' && weekStart) {
    // A newer submission for the same week replaces the earlier waiting one.
    await supabase
      .from('schedule_change_requests')
      .update({ status: 'cancelled' })
      .eq('profile_id', profile.id)
      .eq('kind', 'availability')
      .eq('week_start_date', weekStart)
      .eq('status', 'pending')
  }
  const requesterName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email || 'A staff member'
  const { error } = await supabase.from('schedule_change_requests').insert({
    store_id: storeId,
    profile_id: profile.id,
    requester_name: requesterName,
    approver_id: approverId,
    kind,
    reason_code: reasonCode,
    week_start_date: weekStart,
    title,
    details,
    payload,
  })
  if (error) return { error }
  if (approverId && approverId !== profile.id) {
    await sendSystemMessage({
      storeId,
      senderId: profile.id,
      recipientIds: [approverId],
      subject: `Approval needed: ${requesterName} — ${title}`.slice(0, 200),
      html: `<p>${esc(requesterName)} wants to change: ${esc(title)}.</p>${(details ?? []).map((l) => `<p>${esc(l)}</p>`).join('')}<p>You will also see a pop-up with Approve / Reject when you open the app.</p>`,
    })
  }
  return { error: null }
}

export async function loadPendingAvailability(profileId, weekStart) {
  if (!profileId) return null
  const { data } = await supabase
    .from('schedule_change_requests')
    .select('*')
    .eq('profile_id', profileId)
    .eq('kind', 'availability')
    .eq('week_start_date', weekStart)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}

export async function cancelChangeRequest(id) {
  return supabase.from('schedule_change_requests').update({ status: 'cancelled' }).eq('id', id)
}

// Leave limits tab checkbox: when ON for a store, its approver gets a Message whenever a
// staff member applies for / changes / cancels leave there.
export async function notifyLeaveChange({ profile, storeIds, text }) {
  const ids = Array.from(new Set(storeIds ?? []))
  if (!ids.length) return
  const [{ data: defaults }, { data: stores }] = await Promise.all([
    supabase.from('leave_limit_defaults').select('store_id, notify_approver_on_leave').in('store_id', ids),
    supabase.from('stores').select('id, availability_approver_id').in('id', ids),
  ])
  const notify = new Set((defaults ?? []).filter((d) => d.notify_approver_on_leave).map((d) => d.store_id))
  const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email || 'A staff member'
  for (const s of stores ?? []) {
    if (!notify.has(s.id) || !s.availability_approver_id || s.availability_approver_id === profile.id) continue
    await sendSystemMessage({
      storeId: s.id,
      senderId: profile.id,
      recipientIds: [s.availability_approver_id],
      subject: `Leave update: ${name}`,
      html: `<p>${esc(name)} ${esc(text)}</p>`,
    })
  }
}
