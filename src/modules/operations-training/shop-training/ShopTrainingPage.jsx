import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import Modal from '../../../components/ui/Modal'
import RichTextViewer from '../../../components/ui/RichTextViewer'

export default function ShopTrainingPage() {
  const { profile } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [openItem, setOpenItem] = useState(null)

  useEffect(() => {
    let active = true
    let query = supabase.from('shop_training_items').select('*').order('sort_order')
    // Training-role accounts only ever see content an admin marked visible.
    if (profile?.role === 'training') query = query.eq('visible_to_training', true)
    query.then(({ data }) => {
      if (active) {
        setItems(data ?? [])
        setLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [profile])

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Shop Training</h1>
      <p className="mb-4 text-sm text-gray-500">In-store training material. Tap a title to read the full content.</p>

      {loading ? (
        <LoadingSpinner />
      ) : !items.length ? (
        <EmptyState label="No shop training content yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => setOpenItem(item)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50"
            >
              <span className="font-medium text-gray-800">{item.title}</span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}

      <Modal open={!!openItem} onClose={() => setOpenItem(null)} title={openItem?.title} wide>
        <RichTextViewer html={openItem?.content_html} />
      </Modal>
    </div>
  )
}
