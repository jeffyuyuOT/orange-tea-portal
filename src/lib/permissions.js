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
      my_information: 'My Information',
    },
  },
  shop_management: {
    label: 'Shop Management',
    pages: {
      learning_tracker: 'Learning Tracker',
      staff_information: 'Staff Information',
      training_code: 'Training Code',
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
      shop_training_database: 'Shop Training Database',
      file_repository: 'File Repository',
      user_management: 'User Management',
      store_management: 'Store Management',
      system_setting: 'System Setting',
    },
  },
}

// Flat list of every page key, e.g. "operations_training.formula"
export const ALL_PAGE_KEYS = Object.entries(SECTIONS).flatMap(([sectionKey, section]) =>
  Object.keys(section.pages).map((pageKey) => `${sectionKey}.${pageKey}`)
)

const ALL = ALL_PAGE_KEYS

const ROLE_DEFAULTS = {
  admin: ALL,

  shop_manager: ALL.filter(
    (key) =>
      ![
        'admin_center.formula_database',
        'admin_center.file_repository',
        'admin_center.user_management',
        'admin_center.store_management',
        'admin_center.system_setting',
      ].includes(key)
  ),

  staff: [
    'operations_training.formula',
    'operations_training.shop_training',
    'dashboard.bulletin',
    'dashboard.study_log',
    'dashboard.my_information',
    'roster_hub.my_roster',
    'roster_hub.leave_management',
  ],

  // Training users authenticate with an extra weekly training code and only
  // see Shop Training content flagged `visible_to_training` (enforced at the
  // data layer too, not just navigation).
  training: ['operations_training.shop_training'],
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
}
