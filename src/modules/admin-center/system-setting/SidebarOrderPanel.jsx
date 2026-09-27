import { useEffect, useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import { SECTIONS } from '../../../lib/permissions'
import { fetchSidebarOrder, saveSidebarOrder } from '../../../lib/sidebarOrder'
import Button from '../../../components/ui/Button'
import LoadingSpinner from '../../../components/ui/LoadingSpinner'

function move(arr, index, dir) {
  const target = index + dir
  if (target < 0 || target >= arr.length) return arr
  const next = [...arr]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

// One shared order for the whole app (migration 0055) — not per role or per
// person, per Jeff. Follows the same ▲▼ up/down reorder pattern already
// used for Formula ingredients (Formula Database > Edit Item) rather than
// drag-and-drop, since that's the one reorder UI already established in
// this codebase.
export default function SidebarOrderPanel() {
  const { profile, refreshSidebarOrder } = useAuth()
  const [order, setOrder] = useState(null) // { sectionOrder, pageOrder } — null while loading
  const [expanded, setExpanded] = useState(null) // the one section currently showing its pages, or null
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchSidebarOrder().then(setOrder)
  }, [])

  function moveSection(index, dir) {
    setMessage('')
    setOrder((prev) => ({ ...prev, sectionOrder: move(prev.sectionOrder, index, dir) }))
  }

  function movePage(sectionKey, index, dir) {
    setMessage('')
    setOrder((prev) => ({
      ...prev,
      pageOrder: { ...prev.pageOrder, [sectionKey]: move(prev.pageOrder[sectionKey] ?? [], index, dir) },
    }))
  }

  async function save() {
    setSaving(true)
    setMessage('')
    const { error } = await saveSidebarOrder(order, profile?.id)
    setMessage(error ? 'Could not save — please try again.' : 'Saved — the Sidebar for everyone now reflects this order.')
    if (!error) refreshSidebarOrder() // updates this admin's own Sidebar immediately too
    setSaving(false)
  }

  return (
    <section className="rounded-xl border border-brand-100 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-brand-700">Sidebar order</h2>
      <p className="mb-3 text-sm text-gray-500">
        Controls the order sections and pages appear in the Sidebar for everyone — one shared order for the whole
        app, not per role or per person. Use ▲▼ to reorder sections; click a section to open and reorder the pages
        inside it.
      </p>

      {!order ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-1.5">
          {order.sectionOrder.map((sectionKey, i) => {
            const section = SECTIONS[sectionKey]
            if (!section) return null
            // Hidden from everyone except the developer role itself, same as
            // everywhere else this section is filtered — an admin reordering
            // the Sidebar shouldn't even see "Developer" listed here.
            if (sectionKey === 'developer_tools' && profile?.role !== 'developer') return null
            const pages = order.pageOrder[sectionKey] ?? []
            const isExpanded = expanded === sectionKey
            return (
              <div key={sectionKey} className="rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 p-2">
                  <div className="flex shrink-0 flex-col">
                    <button
                      onClick={() => moveSection(i, -1)}
                      disabled={i === 0}
                      className="leading-none text-gray-400 hover:text-brand-600 disabled:pointer-events-none disabled:opacity-20"
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveSection(i, 1)}
                      disabled={i === order.sectionOrder.length - 1}
                      className="leading-none text-gray-400 hover:text-brand-600 disabled:pointer-events-none disabled:opacity-20"
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : sectionKey)}
                    className="flex-1 text-left text-sm font-medium text-gray-800"
                  >
                    {section.label}
                  </button>
                  <span className="text-xs text-gray-400">{isExpanded ? '▾' : '▸'}</span>
                </div>
                {isExpanded && (
                  <div className="space-y-1 border-t border-gray-100 p-2 pl-8">
                    {pages.map((pageKey, j) => (
                      <div key={pageKey} className="flex items-center gap-2">
                        <div className="flex shrink-0 flex-col">
                          <button
                            onClick={() => movePage(sectionKey, j, -1)}
                            disabled={j === 0}
                            className="leading-none text-gray-400 hover:text-brand-600 disabled:pointer-events-none disabled:opacity-20"
                            title="Move up"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => movePage(sectionKey, j, 1)}
                            disabled={j === pages.length - 1}
                            className="leading-none text-gray-400 hover:text-brand-600 disabled:pointer-events-none disabled:opacity-20"
                            title="Move down"
                          >
                            ▼
                          </button>
                        </div>
                        <span className="text-sm text-gray-600">{section.pages[pageKey]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button onClick={save} disabled={!order || saving}>
          {saving ? 'Saving…' : 'Save order'}
        </Button>
        {message && <span className="text-xs text-gray-500">{message}</span>}
      </div>
    </section>
  )
}
