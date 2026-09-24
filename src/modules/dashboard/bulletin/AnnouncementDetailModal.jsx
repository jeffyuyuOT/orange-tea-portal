import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import SimpleRichTextEditor from '../../../components/ui/SimpleRichTextEditor'
import RichTextViewer from '../../../components/ui/RichTextViewer'
import { rosterDisplayName } from '../../../lib/excelRoster'

export default function AnnouncementDetailModal({ announcementId, storeId, onClose, onSaved }) {
  const { profile } = useAuth()
  const isNew = !announcementId
  const canEdit = profile?.role === 'admin' || profile?.role === 'shop_manager'
  const [editing, setEditing] = useState(isNew)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isImportant, setIsImportant] = useState(false)
  const [history, setHistory] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isNew) return
    supabase
      .from('announcements')
      .select('*')
      .eq('id', announcementId)
      .single()
      .then(({ data }) => {
        if (data) {
          setTitle(data.title)
          setContent(data.content_html ?? '')
          setIsImportant(data.is_important)
        }
      })
    supabase
      .from('announcement_history')
      .select('*, actor:actor_id(first_name,last_name,roster_display_name)')
      .eq('announcement_id', announcementId)
      .order('acted_at', { ascending: false })
      .then(({ data }) => setHistory(data ?? []))
  }, [announcementId, isNew])

  async function save() {
    setSaving(true)
    try {
      if (isNew) {
        const { data, error } = await supabase
          .from('announcements')
          .insert({ store_id: storeId, title, content_html: content, is_important: isImportant, created_by: profile.id, updated_by: profile.id })
          .select()
          .single()
        if (error) throw error
        await supabase.from('announcement_history').insert({ announcement_id: data.id, action: 'created', actor_id: profile.id })
      } else {
        const { error } = await supabase
          .from('announcements')
          .update({ title, content_html: content, is_important: isImportant, updated_by: profile.id })
          .eq('id', announcementId)
        if (error) throw error
        await supabase.from('announcement_history').insert({ announcement_id: announcementId, action: 'edited', actor_id: profile.id })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? 'New Announcement' : editing ? 'Edit Announcement' : title}
      footer={
        canEdit &&
        (editing ? (
          <>
            <Button variant="secondary" onClick={() => (isNew ? onClose() : setEditing(false))}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !title}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ))
      }
    >
      {editing ? (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <SimpleRichTextEditor value={content} onChange={setContent} placeholder="Announcement content…" />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={isImportant} onChange={(e) => setIsImportant(e.target.checked)} />
            Mark as important
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          <RichTextViewer html={content} />
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-gray-400">History</h4>
            <ul className="space-y-1 text-xs text-gray-500">
              {history.map((h) => (
                <li key={h.id}>
                  {new Date(h.acted_at).toLocaleString()} — {h.action.replace('_', ' ')} by{' '}
                  {h.actor ? rosterDisplayName(h.actor) : 'Unknown'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  )
}
