import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'

// Manager/admin-only "who has viewed this" list (see migration 0056) —
// reuses the same announcement_reads table that also powers the New/Update
// badges on the Bulletin Board list itself (BulletinPage.jsx), just read
// here with a wider RLS policy that lets manager/admin see everyone's row
// for their store, not only their own.
export default function AnnouncementViewersModal({ announcementId, onClose }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])

  useEffect(() => {
    supabase
      .from('announcement_reads')
      .select('profile_id, read_at, profile:profile_id(first_name,last_name,email)')
      .eq('announcement_id', announcementId)
      .order('read_at', { ascending: false })
      .then(({ data }) => {
        setRows(data ?? [])
        setLoading(false)
      })
  }, [announcementId])

  return (
    <Modal open onClose={onClose} title="Viewed by">
      {loading ? (
        <LoadingSpinner />
      ) : !rows.length ? (
        <EmptyState label="Nobody has opened this yet." />
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((r) => {
            const name = r.profile ? `${r.profile.first_name ?? ''} ${r.profile.last_name ?? ''}`.trim() || r.profile.email : 'Unknown'
            return (
              <li key={r.profile_id} className="flex items-center justify-between border-b border-gray-100 pb-1.5 last:border-0">
                <span className="text-gray-700">{name}</span>
                <span className="text-xs text-gray-400">{new Date(r.read_at).toLocaleString()}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
