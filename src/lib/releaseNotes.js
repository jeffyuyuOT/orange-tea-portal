// Jeff, 2026-11-10: "系統設置的開關會彈出視窗顯示更新了哪些，有看過的就不會列出...admin
// 可以控制累積一定量再彈出視窗告訴大家多了什麼功能" — the content of the "What's new" popup
// (components/layout/WhatsNewModal.jsx, triggered from AppShell.jsx). The app itself updates
// quietly in the background (swUpdate.js); this list is only the human-readable "what
// changed". Add one entry per user-visible change, NEWEST FIRST, in words staff would use.
//
//   id           unique and never reused — it's what gets remembered as "already seen"
//   date         yyyy-mm-dd, shown small under the title
//   title/body   plain text, one or two short sentences for the body
//   requiresPage optional permission page key (lib/permissions.js) — the note is only shown
//                to people who can open that page, so a manager-only feature isn't listed
//                to staff who can never use it
//
// Nothing is shown (and nothing is marked as seen) while the admin switch in Admin Center >
// System Setting > "What's New Popup" is off, so notes keep accumulating until it's turned
// on; each person then sees everything they haven't seen yet, once.
export const RELEASE_NOTES = [
  {
    id: '2026-11-10-my-roster-shortcut',
    date: '2026-11-10',
    title: 'My Roster shortcut on your phone',
    body: 'Tap the 🗓️ icon next to the camera at the top to see your shifts for last week, this week and next week on one screen — no sideways scrolling. A red dot shows when your roster has changed.',
    requiresPage: 'roster_hub.my_roster',
  },
  {
    id: '2026-11-10-manage-roster-summary',
    date: '2026-11-10',
    title: 'Manage Roster: Summary page, availability and breaks',
    body: 'Use the Summary button to see only who is working each day, swap a person or change a shift time/break right there, with a warning if it clashes with their availability or leave. Tap a date or a name to see availability. Breaks show as B×1 (30 min each).',
    requiresPage: 'roster_hub.manage_roster',
  },
]

function storageKey(profileId) {
  return `ot_release_notes_seen_${profileId}`
}

export function loadSeenNoteIds(profileId) {
  try {
    const raw = localStorage.getItem(storageKey(profileId))
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

export function markNotesSeen(profileId, ids) {
  try {
    const seen = loadSeenNoteIds(profileId)
    ids.forEach((id) => seen.add(id))
    localStorage.setItem(storageKey(profileId), JSON.stringify([...seen]))
  } catch {
    // Storage unavailable (private mode etc.) — worst case the notes show again next time.
  }
}

// Notes this person hasn't seen yet and can actually use, newest first.
export function pendingReleaseNotes(profileId, canSeePage) {
  const seen = loadSeenNoteIds(profileId)
  return RELEASE_NOTES.filter((n) => !seen.has(n.id) && (!n.requiresPage || canSeePage(n.requiresPage)))
}
