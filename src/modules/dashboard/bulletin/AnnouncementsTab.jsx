import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { rosterDisplayName } from '../../../lib/excelRoster'
import AnnouncementDetailModal from './AnnouncementDetailModal'
import ImportantAnnouncementsModal from './ImportantAnnouncementsModal'

export default function AnnouncementsTab() {
  const { currentStoreId, profile } = useAuth()
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null) // null = closed, 'new' = create, uuid = view/edit
  const [showImportant, setShowImportant] = useState(false)

  async function load() {
    if (!currentStoreId) return
    setLoading(true)
    const { data } = await supabase
      .from('announcements')
      .select('*, creator:created_by(first_name,last_name,roster_display_name), editor:updated_by(first_name,last_name,roster_display_name)')
      .eq('store_id', currentStoreId)
      .order('updated_at', { ascending: false })
    setAnnouncements(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [currentStoreId])

  const canPost = profile?.role === 'admin' || profile?.role === 'shop_manager'

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Button variant="secondary" onClick={() => setShowImportant(true)}>
          ⭐ Important Announcements
        </Button>
        {canPost && <Button onClick={() => setOpenId('new')}>+ New Announcement</Button>}
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !announcements.length ? (
        <EmptyState label="No announcements yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {announcements.map((a) => {
            const actor = a.editor ?? a.creator
            const actorName = actor ? rosterDisplayName(actor) : ''
            return (
              <button
                key={a.id}
                onClick={() => setOpenId(a.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-50"
              >
                <div className="flex items-center gap-2">
                  {a.is_important && <Badge color="red">Important</Badge>}
                  <span className="font-medium text-gray-800">{a.title}</span>
                </div>
                <span className="shrink-0 text-xs text-gray-400">
                  {new Date(a.updated_at).toLocaleString()} · {actorName}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {openId && (
        <AnnouncementDetailModal
          announcementId={openId === 'new' ? null : openId}
          storeId={currentStoreId}
          onClose={() => setOpenId(null)}
          onSaved={() => {
            setOpenId(null)
            load()
          }}
        />
      )}
      {showImportant && (
        <ImportantAnnouncementsModal
          storeId={currentStoreId}
          onClose={() => setShowImportant(false)}
          onSelect={(id) => {
            setShowImportant(false)
            setOpenId(id)
          }}
        />
      )}
    </div>
  )
}
