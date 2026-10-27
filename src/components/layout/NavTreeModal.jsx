import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
//
// Jeff, 2026-10-27 (follow-up): "樹狀圖如果點選分頁跳出前往某某分頁視窗，
// 確定並前往。或X取消，做視窗的用意是以防按到上下附近的分頁直接跳過去" —
// tapping a row doesn't navigate straight away; it opens a small confirm
// step first ("Go to <page>? Confirm and go / ✕ Cancel"), since the tree's
// rows sit close together on a phone and a mis-tap on the row just above
// or below is an easy mistake with no way to back out once it's already
// navigated.
export default function NavTreeModal({ open, onClose }) {
  const { effectivePages, sidebarOrder } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState(null) // { label, to } | null

  const tree = orderedSectionEntries(sidebarOrder)
    .filter(([sectionKey]) => canAccessSection(effectivePages, sectionKey))
    .map(([sectionKey, section]) => {
      const prefix = `/${sectionKey.replace(/_/g, '-')}`
      const pages = logicalPageEntries(sectionKey, sidebarOrder)
        .map((entry) => {
          if (entry.type === 'group') {
            // Same as Sidebar.jsx's own group row — lands on whichever
            // member this person can actually reach first (in the group's
            // own fixed order), never the member keys themselves.
            const accessibleMembers = entry.pages.filter((p) => canAccessPage(effectivePages, `${sectionKey}.${p}`))
            if (!accessibleMembers.length) return null
            return { key: entry.key, label: entry.label, to: `${prefix}/${accessibleMembers[0].replace(/_/g, '-')}` }
          }
          if (!canAccessPage(effectivePages, `${sectionKey}.${entry.key}`)) return null
          return { key: entry.key, label: entry.label, to: `${prefix}/${entry.key.replace(/_/g, '-')}` }
        })
        .filter(Boolean)
      return { key: sectionKey, label: section.label, icon: SECTION_STYLE[sectionKey]?.icon ?? '📁', pages }
    })
    .filter((s) => s.pages.length)

  function confirmNav() {
    if (!pending) return
    navigate(pending.to)
    setPending(null)
    onClose?.()
  }

  return (
    <>
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
                  <button
                    key={page.key}
                    type="button"
                    onClick={() => setPending({ label: page.label, to: page.to })}
                    className="flex w-full items-center gap-1.5 rounded py-1.5 text-left text-sm text-gray-600 hover:bg-brand-50 hover:text-brand-700"
                  >
                    <span className="text-brand-300" aria-hidden>
                      {i === section.pages.length - 1 ? '└' : '├'}
                    </span>
                    {page.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
      {/* A second, smaller Modal stacked on top of the tree one — mounted
          after it in the DOM, so it naturally renders above it despite
          both sharing the same fixed z-50 overlay. */}
      {pending && (
        <Modal
          open
          onClose={() => setPending(null)}
          title="Go to this page?"
          footer={
            <>
              <button
                onClick={() => setPending(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50"
              >
                ✕ Cancel
              </button>
              <button
                onClick={confirmNav}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Confirm and go
              </button>
            </>
          }
        >
          <p className="text-sm text-gray-700">
            Go to <span className="font-medium text-brand-700">{pending.label}</span>?
          </p>
        </Modal>
      )}
    </>
  )
}
