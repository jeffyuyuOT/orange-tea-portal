import { useAuth } from '../../lib/AuthContext'
import { canAccessSection, canAccessPage } from '../../lib/permissions'
import { orderedSectionEntries, logicalPageEntries } from '../../lib/sidebarOrder'
import { SECTION_STYLE } from '../../lib/sectionStyle'
import Modal from '../ui/Modal'

// Jeff, 2026-10-27: "手機版分頁按鈕最下方新增一個樹狀圖的圖案，按下去會彈出
// 視窗顯示樹狀圖有哪些主分頁，主分頁下有哪些子分頁(要依權限看到不同的樹狀
// 圖)" — a bird's-eye view of the WHOLE nav tree (every section this person
// can reach, and every page/group within each) in one popup, instead of
// drilling in one level at a time through MobileSectionHome's own grid.
// Reuses exactly the same section/page gating Sidebar.jsx's desktop nav
// tree already uses (canAccessSection + per-entry/per-group-member
// canAccessPage), off the same effectivePages/sidebarOrder from AuthContext
// — so this always matches what that person can actually navigate to
// elsewhere, and a role or permission_override change updates both at once
// without any extra code here.
export default function NavTreeModal({ open, onClose }) {
  const { effectivePages, sidebarOrder } = useAuth()

  const tree = orderedSectionEntries(sidebarOrder)
    .filter(([sectionKey]) => canAccessSection(effectivePages, sectionKey))
    .map(([sectionKey, section]) => {
      const pages = logicalPageEntries(sectionKey, sidebarOrder)
        .map((entry) => {
          if (entry.type === 'group') {
            // Same as Sidebar.jsx's own group row — shown once the group
            // has at least one reachable member, never the member keys
            // themselves (they share one logical row here too).
            const hasAccessibleMember = entry.pages.some((p) => canAccessPage(effectivePages, `${sectionKey}.${p}`))
            return hasAccessibleMember ? { key: entry.key, label: entry.label } : null
          }
          return canAccessPage(effectivePages, `${sectionKey}.${entry.key}`) ? { key: entry.key, label: entry.label } : null
        })
        .filter(Boolean)
      return { key: sectionKey, label: section.label, icon: SECTION_STYLE[sectionKey]?.icon ?? '📁', pages }
    })
    .filter((s) => s.pages.length)

  return (
    <Modal open={open} onClose={onClose} title="🌳 Navigation Map" wide>
      <div className="space-y-4">
        {tree.map((section) => (
          <div key={section.key}>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-brand-800">
              <span aria-hidden>{section.icon}</span>
              {section.label}
            </div>
            <div className="ml-3 mt-1 border-l border-brand-200 pl-3">
              {section.pages.map((page, i) => (
                <div key={page.key} className="flex items-center gap-1.5 py-0.5 text-sm text-gray-600">
                  <span className="text-brand-300" aria-hidden>
                    {i === section.pages.length - 1 ? '└' : '├'}
                  </span>
                  {page.label}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
