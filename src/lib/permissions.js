// ---------------------------------------------------------------------------
// Page-level RBAC. Each page/sub-page has a key ("section.subPage"). Every
// role has a default access matrix per the spec; Admin can grant/revoke
// individual pages per-user via the `permission_overrides` table, which is
// layered on top of the role default here.
// ---------------------------------------------------------------------------

export const SECTIONS = {
  operations_training: {
    label: 'Operations & Training',
    pages: {
      formula: 'Formula',
      shop_training: 'Shop Training',
    },
  },
  dashboard: {
    label: 'My Dashboard',
    pages: {
      bulletin: 'Bulletin Board',
      // Jeff, 2026-09: private messaging moved out of Bulletin Board into
      // its own My Dashboard tab (Inbox/Sent) — see MessagePage.jsx and
      // migration 0066_bulletin_messages.sql. Personal scope, so this page
      // is never store-filtered the way Bulletin Board is.
      message: 'Message',
      study_log: 'Study Log',
      time_attendance: 'Time & Attendance',
      my_information: 'My Information',
    },
  },
  // Jeff, 2026-09: its own top-level section — "跟my dashboard同等級，不是
  // 在my dashboard下" — a plain "submit a request" form (SupportPage.jsx)
  // that hands off to the private Message system in `dashboard` above for
  // delivery (a message to the developer role + a case-number badge), so
  // it doesn't need its own inbox/RLS story. One page for now; room to add
  // siblings here later (the original spec's HR/Admin Request Database)
  // without touching this section's shape.
  support: {
    label: 'Support',
    pages: {
      submit_request: 'Submit Request',
    },
  },
  shop_management: {
    label: 'Shop Management',
    pages: {
      learning_tracker: 'Learning Tracker',
      staff_information: 'Staff Information',
      training_code: 'Training Code',
      shop_training_database: 'Shop Training Database',
      staff_time_logs: 'Staff Time Logs',
      // Not a real "manage this" page — just the rotating QR display meant
      // to sit on a phone in the store. Excluded from shop_manager's default
      // below so only qr_code_maker and admin ever see it (per Jeff).
      qr_code: '2D Code',
    },
  },
  roster_hub: {
    label: 'Roster Hub',
    pages: {
      my_roster: 'My Roster',
      my_availability: 'My Availability',
      manage_roster: 'Manage Roster',
      history: 'History',
      leave_management: 'Leave Management',
      settings: 'Setting',
    },
  },
  admin_center: {
    label: 'Admin Center',
    pages: {
      formula_database: 'Formula Database',
      quiz_bank: 'Quiz Bank',
      file_repository: 'File Repository',
      user_management: 'User Management',
      store_management: 'Store Management',
      system_setting: 'System Setting',
    },
  },
  // Hidden from everyone except the developer role itself — see
  // visibleRoleEntries/roleLabelFor below and migration
  // 0057_developer_role_and_payroll.sql (the real security boundary; this
  // is only what decides what shows up in the nav/checkboxes/dropdowns).
  developer_tools: {
    label: 'Developer',
    pages: {
      payroll: 'Payroll',
    },
  },
}

// Flat list of every page key, e.g. "operations_training.formula"
export const ALL_PAGE_KEYS = Object.entries(SECTIONS).flatMap(([sectionKey, section]) =>
  Object.keys(section.pages).map((pageKey) => `${sectionKey}.${pageKey}`)
)

const ALL = ALL_PAGE_KEYS

const ROLE_DEFAULTS = {
  // Admin gets everything EXCEPT the hidden developer_tools.payroll page —
  // Jeff's request specifically: admin shouldn't be able to reach the
  // payroll app, whether by role default or by a permission_overrides
  // grant (UserDetailModal's Page Access section also hides that
  // checkbox from non-developer viewers, so admin can't grant it either).
  admin: ALL.filter((key) => key !== 'developer_tools.payroll'),

  // The developer role is admin's superset: same full access, PLUS the
  // payroll app. Hidden everywhere else (see visibleRoleEntries/
  // roleLabelFor) — only a developer account itself ever sees this role
  // name; to anyone else it reads as "Admin".
  developer: ALL,

  // Jeff, 2026-09: this list forgot 'developer_tools.payroll' — shop_manager
  // got it by default (like every other key ALL.filter() doesn't explicitly
  // exclude), so the Page Access checkbox showed it ticked for any
  // shop_manager account nobody had manually patched with a per-account
  // permission_overrides row (Angel Cheah / "jeff test" already had one,
  // set to false — that was exactly this bug, worked around one account at
  // a time instead of fixed at the root). The page itself is just an iframe
  // into the standalone payroll app (PayrollPage.jsx) whose real boundary is
  // payroll_*'s RLS (is_developer()), so a shop_manager with this leaked
  // page access could reach the tab/route but the app underneath would
  // deny/empty everything — Jeff's "有勾取，只是進不去". Now excluded here
  // the same way admin already is above, so the checkbox/Sidebar
  // link/route all agree: only `developer` gets Payroll by default.
  shop_manager: ALL.filter(
    (key) =>
      ![
        'admin_center.formula_database',
        'admin_center.file_repository',
        'admin_center.user_management',
        'admin_center.store_management',
        'admin_center.system_setting',
        'shop_management.qr_code',
        'developer_tools.payroll',
      ].includes(key)
  ),

  staff: [
    'operations_training.formula',
    'operations_training.shop_training',
    'dashboard.bulletin',
    'dashboard.message',
    'dashboard.study_log',
    'dashboard.time_attendance',
    'dashboard.my_information',
    'support.submit_request',
    'roster_hub.my_roster',
    'roster_hub.my_availability',
    'roster_hub.leave_management',
  ],

  // Training users authenticate with an extra weekly training code and only
  // see Shop Training content flagged `visible_to_training` (enforced at the
  // data layer too, not just navigation).
  training: ['operations_training.shop_training'],

  // A device account, not a person — sits on a phone mounted in the store
  // and does nothing but display the rotating clock-in/out QR code (see
  // migration 0054 / QrCodeDisplayPage.jsx). Exactly one page, on purpose.
  qr_code_maker: ['shop_management.qr_code'],

  // For an external/contract bookkeeper — sees only Staff Information
  // (address, bank details, TFN/super/parent-consent uploads), and even
  // there only staff who aren't marked cash_in_hand (StaffDetailModal.jsx
  // is read-only for this role; the cash-in-hand exclusion is also
  // enforced at the RLS layer — see migration
  // 0060_accountant_role_and_profile_fields.sql's accountant_visible_profile()).
  accountant: ['shop_management.staff_information'],
}

/**
 * @param {{role: string}} profile
 * @param {Array<{page_key: string, allowed: boolean}>} overrides
 * @returns {Set<string>} the effective set of allowed page keys
 */
export function getEffectivePages(profile, overrides = []) {
  const base = new Set(ROLE_DEFAULTS[profile?.role] ?? [])
  for (const o of overrides) {
    if (o.allowed) base.add(o.page_key)
    else base.delete(o.page_key)
  }
  return base
}

export function canAccessPage(effectivePages, pageKey) {
  return effectivePages.has(pageKey)
}

export function canAccessSection(effectivePages, sectionKey) {
  return Array.from(effectivePages).some((k) => k.startsWith(`${sectionKey}.`))
}

export const ROLE_LABELS = {
  admin: 'Admin',
  shop_manager: 'Shop Manager',
  staff: 'Staff',
  training: 'Training',
  qr_code_maker: '2D Code Maker',
  developer: 'Developer',
  accountant: 'Accountant',
}

// Roles that shouldn't show up in a "pick a staff member" list — training is
// a weekly-code account with its own separate content visibility (not
// someone whose study/quiz/clock-in progress a manager reviews),
// qr_code_maker is a device account, not a person at all, and accountant is
// an external bookkeeper's login, not a real front-line staff member.
// Shared by every such picker (Learning Tracker, Staff Time Logs, Staff
// Information, …) so they can't drift apart on which roles count as "real
// staff".
//
// developer used to be excluded here too ("usually Jeff's own account for
// the payroll app, not scheduled staff") — but a developer account can
// genuinely BE a real front-line staff member with actual shifts, the same
// as anyone else, once User Management assigns it a store. That wrong
// assumption already caused this exact list to wrongly hide a developer
// account from the roster once (Jeff: "jeff chuang有勾取Also on the roster
// at sunnybank, toowong, 和brookside，但班表跟名字排序都沒看到"), which is
// why NON_ROSTER_STAFF_ROLES below was created, carving developer back in
// for roster contexts specifically. The same mistake then resurfaced here,
// hiding a developer account from Learning Tracker too (Jeff: "jeff
// chuang沒有在learning tracker裡所以沒辦法qualified") — since every picker
// that shares THIS list has the identical "real staff, real progress to
// track" reasoning the roster fix already established, developer is now
// dropped from here for good instead of being carved out one picker at a
// time as each one gets reported. A developer account being hidden from
// role PICKERS in User Management (so admin can't see/assign "Developer"
// as a role at all) is a separate, narrower rule — see visibleRoleEntries()
// below — and is unaffected by this.
export const NON_PICKABLE_STAFF_ROLES = ['training', 'qr_code_maker', 'accountant']

// Manage Roster / Roster Staff Order / roster history & multi-store exports
// use this — kept as its own named export (even though it's the same list
// as NON_PICKABLE_STAFF_ROLES above now) since it's specifically about who
// can be scheduled/shown on a roster, which could legitimately diverge from
// "who's a real staff member" again in the future without that being a bug.
export const NON_ROSTER_STAFF_ROLES = NON_PICKABLE_STAFF_ROLES

// Every ROLE_LABELS entry EXCEPT 'developer', unless the viewer IS a
// developer. Used everywhere a role picker is shown (User Management's
// Staff/Pending Staff role <select>s) so the hidden role stays invisible
// to everyone else — per Jeff's request, admin shouldn't see "Developer"
// as an option at all, only a developer account looking at its own (or
// another developer's) profile should.
export function visibleRoleEntries(viewerRole) {
  return Object.entries(ROLE_LABELS).filter(([key]) => key !== 'developer' || viewerRole === 'developer')
}

// A role <select>'s options: every role the viewer is allowed to pick,
// plus — if it's not already in that list — whatever role the record
// being edited already has, so an existing developer account's role
// field still has a matching, selectable option (labelled via
// roleLabelFor, so it still doesn't say "Developer") instead of silently
// not matching any <option> and rendering blank.
export function roleSelectOptions(currentRole, viewerRole) {
  const visible = visibleRoleEntries(viewerRole)
  if (currentRole && !visible.some(([key]) => key === currentRole)) {
    return [...visible, [currentRole, roleLabelFor(currentRole, viewerRole)]]
  }
  return visible
}

// Label for a role, masked to the Admin label when the viewer isn't a
// developer and the role itself is 'developer' — so a developer
// account's role badge/caption doesn't leak the role's existence either.
export function roleLabelFor(role, viewerRole) {
  if (role === 'developer' && viewerRole !== 'developer') return ROLE_LABELS.admin
  return ROLE_LABELS[role] ?? role
}
