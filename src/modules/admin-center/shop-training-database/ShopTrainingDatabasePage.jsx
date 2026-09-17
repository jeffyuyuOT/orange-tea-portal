import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Modal from '../../../components/ui/Modal'
import SimpleRichTextEditor from '../../../components/ui/SimpleRichTextEditor'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

export default function ShopTrainingDatabasePage() {
  const { profile } = useAuth()
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)

  async function load() {
    const { data } = await supabase.from('shop_training_items').select('*').order('sort_order')
    setItems(data ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function move(item, dir) {
    const idx = items.findIndex((i) => i.id === item.id)
    const swapWith = items[idx + dir]
    if (!swapWith) return
    await supabase.from('shop_training_items').update({ sort_order: swapWith.sort_order }).eq('id', item.id)
    await supabase.from('shop_training_items').update({ sort_order: item.sort_order }).eq('id', swapWith.id)
    load()
  }

  async function remove(id) {
    if (!confirm('Delete this training item?')) return
    await supabase.from('shop_training_items').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Shop Training Database</h1>
      <p className="mb-4 text-sm text-gray-500">
        Content shown in Operations & Training &gt; Shop Training. Only items checked "Visible to Training" are
        shown to Training-role logins.
      </p>

      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing({})}>+ New Item</Button>
      </div>

      {!items.length ? (
        <EmptyState label="No shop training items yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {items.map((item, idx) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
              <button onClick={() => setEditing(item)} className="flex flex-1 items-center gap-2 text-left">
                <span className="font-medium text-gray-800">{item.title}</span>
                {item.visible_to_training && <Badge color="green">Visible to Training</Badge>}
              </button>
              <div className="flex items-center gap-1">
                <button disabled={idx === 0} onClick={() => move(item, -1)} className="px-1 text-gray-400 hover:text-brand-600 disabled:opacity-30">
                  ↑
                </button>
                <button disabled={idx === items.length - 1} onClick={() => move(item, 1)} className="px-1 text-gray-400 hover:text-brand-600 disabled:opacity-30">
                  ↓
                </button>
                <Button variant="danger" onClick={() => remove(item.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditModal
          item={editing}
          nextSortOrder={items.length}
          profileId={profile.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function EditModal({ item, nextSortOrder, profileId, onClose, onSaved }) {
  const isNew = !item.id
  const [title, setTitle] = useState(item.title ?? '')
  const [content, setContent] = useState(item.content_html ?? '')
  const [visible, setVisible] = useState(item.visible_to_training ?? false)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    if (isNew) {
      await supabase
        .from('shop_training_items')
        .insert({ title, content_html: content, visible_to_training: visible, sort_order: nextSortOrder, created_by: profileId })
    } else {
      await supabase
        .from('shop_training_items')
        .update({ title, content_html: content, visible_to_training: visible, updated_by: profileId })
        .eq('id', item.id)
    }
    setSaving(false)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? 'New Training Item' : 'Edit Training Item'}
      footer={
        <Button onClick={save} disabled={saving || !title}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="space-y-3">
        <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <SimpleRichTextEditor value={content} onChange={setContent} placeholder="Training content…" />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          Visible to Training-role logins
        </label>
      </div>
    </Modal>
  )
}
