import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

export default function ImportantAnnouncementsModal({ storeId, onClose, onSelect }) {
  const [items, setItems] = useState([])

  useEffect(() => {
    if (!storeId) return
    supabase
      .from('announcements')
      .select('id, title, updated_at')
      .eq('store_id', storeId)
      .eq('is_important', true)
      .order('updated_at', { ascending: false })
      .then(({ data }) => setItems(data ?? []))
  }, [storeId])

  return (
    <Modal open onClose={onClose} title="Important Announcements">
      {!items.length ? (
        <EmptyState label="No important announcements right now." />
      ) : (
        <ul className="divide-y divide-brand-100">
          {items.map((a) => (
            <li key={a.id}>
              <button onClick={() => onSelect(a.id)} className="w-full py-2 text-left hover:text-brand-600">
                <div className="font-medium text-gray-800">{a.title}</div>
                <div className="text-xs text-gray-400">{new Date(a.updated_at).toLocaleString()}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
