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
      study_log: 'Study Log',
      time_attendance: 'Time & Attendance',
      my_information: 'My Information',
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

  shop_manager: ALL.filter(
    (key) =>
      ![
        'admin_center.formula_database',
        'admin_center.file_repository',
        'admin_center.user_management',
        'admin_center.store_management',
        'admin_center.system_setting',
        'shop_management.qr_code',
      ].includes(key)
  ),

  staff: [
    'operations_training.formula',
    'operations_training.shop_training',
    'dashboard.bulletin',
    'dashboard.study_log',
    'dashboard.time_attendance',
    'dashboard.my_information',
    'roster_hub.my_roster',
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
}

// Roles that shouldn't show up in a "pick a staff member" list — training is
// a weekly-code account with its own separate content visibility (not
// someone whose study/quiz/clock-in progress a manager reviews),
// qr_code_maker is a device account, not a person at all, and developer is
// usually Jeff's own account for the payroll app, not scheduled staff.
// Shared by every such picker (Learning Tracker, Staff Time Logs, Staff
// Information, …) so they can't drift apart on which roles count as "real
// staff" — EXCEPT roster contexts, which use NON_ROSTER_STAFF_ROLES below
// instead, because a developer account genuinely can be scheduled and
// shown on the roster like a real staff member once User Management
// assigns it a store (Jeff: "jeff chuang有勾取Also on the roster at
// sunnybank, toowong, 和brookside，但班表跟名字排序都沒看到" — that turned
// out to be this same exclusion, reused a bit too broadly).
export const NON_PICKABLE_STAFF_ROLES = ['training', 'qr_code_maker', 'developer']

// Manage Roster / Roster Staff Order / roster history & multi-store
// exports use this narrower list instead of NON_PICKABLE_STAFF_ROLES
// above — same reasoning for training (never actually works a shift) and
// qr_code_maker (a device, not a person), but developer is deliberately
// left OUT here: unlike the other pickers, a developer account is meant
// to be schedulable on the roster once it's assigned to a store via
// User Management's "Also on the roster at" checkboxes, the same as any
// other role.
export const NON_ROSTER_STAFF_ROLES = ['training', 'qr_code_maker']

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
