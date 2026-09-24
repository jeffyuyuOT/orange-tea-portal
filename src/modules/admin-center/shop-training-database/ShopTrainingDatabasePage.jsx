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
  // Locks BOTH ↑/↓ buttons for every row while a reorder is in flight —
  // not just the one clicked — since a reorder is a two-step swap
  // (two sequential updates) and a second click landing mid-swap could
  // race it and leave sort_order inconsistent, not just double-fire.
  const [moving, setMoving] = useState(false)

  async function load() {
    const { data } = await supabase.from('shop_training_items').select('*').order('sort_order')
    setItems(data ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function move(item, dir) {
    if (moving) return
    const idx = items.findIndex((i) => i.id === item.id)
    const swapWith = items[idx + dir]
    if (!swapWith) return
    setMoving(true)
    await supabase.from('shop_training_items').update({ sort_order: swapWith.sort_order }).eq('id', item.id)
    await supabase.from('shop_training_items').update({ sort_order: item.sort_order }).eq('id', swapWith.id)
    await load()
    setMoving(false)
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
                <button
                  disabled={idx === 0 || moving}
                  onClick={() => move(item, -1)}
                  className="px-1 text-gray-400 hover:text-brand-600 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  disabled={idx === items.length - 1 || moving}
                  onClick={() => move(item, 1)}
                  className="px-1 text-gray-400 hover:text-brand-600 disabled:opacity-30"
                >
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
          profileName={`${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email}
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

function EditModal({ item, nextSortOrder, profileId, profileName, onClose, onSaved }) {
  const isNew = !item.id
  const [title, setTitle] = useState(item.title ?? '')
  const [content, setContent] = useState(item.content_html ?? '')
  const [visible, setVisible] = useState(item.visible_to_training ?? false)
  // Attached files staff can download alongside the content — same
  // "upload immediately, only link it to the item at Save" pattern Formula
  // Database's videos use, since a brand-new item has no id yet for a
  // shop_training_item_files row to point at until it's actually inserted.
  const [files, setFiles] = useState([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isNew) return
    supabase
      .from('shop_training_item_files')
      .select('*')
      .eq('shop_training_item_id', item.id)
      .order('sort_order')
      .then(({ data }) => setFiles(data ?? []))
  }, [isNew, item.id])

  async function addFile(file) {
    setUploadingFile(true)
    const path = `shop-training/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
    if (error) {
      alert(error.message)
    } else {
      setFiles((prev) => [...prev, { _key: Math.random(), display_name: file.name, file_path: path }])
    }
    setUploadingFile(false)
  }
  function renameFile(key, displayName) {
    setFiles((prev) => prev.map((f) => ((f._key ?? f.id) === key ? { ...f, display_name: displayName } : f)))
  }
  function removeFile(key) {
    setFiles((prev) => prev.filter((f) => (f._key ?? f.id) !== key))
  }

  async function save() {
    setSaving(true)
    let itemId = item.id
    if (isNew) {
      const { data, error } = await supabase
        .from('shop_training_items')
        .insert({
          title,
          content_html: content,
          visible_to_training: visible,
          sort_order: nextSortOrder,
          created_by: profileId,
          created_by_name: profileName,
        })
        .select()
        .single()
      if (error) {
        alert(error.message)
        setSaving(false)
        return
      }
      itemId = data.id
    } else {
      await supabase
        .from('shop_training_items')
        .update({ title, content_html: content, visible_to_training: visible, updated_by: profileId, updated_by_name: profileName })
        .eq('id', item.id)
      await supabase.from('shop_training_item_files').delete().eq('shop_training_item_id', itemId)
    }
    const nonEmptyFiles = files.filter((f) => f.file_path)
    if (nonEmptyFiles.length) {
      await supabase.from('shop_training_item_files').insert(
        nonEmptyFiles.map((f, idx) => ({
          shop_training_item_id: itemId,
          display_name: f.display_name?.trim() || 'File',
          file_path: f.file_path,
          sort_order: idx,
          uploaded_by: profileId,
        }))
      )
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

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Attached files (optional)</span>
            <label className="cursor-pointer text-xs text-brand-600 hover:underline">
              {uploadingFile ? 'Uploading…' : '+ Add file'}
              <input
                type="file"
                className="hidden"
                disabled={uploadingFile}
                onChange={(e) => e.target.files[0] && addFile(e.target.files[0])}
              />
            </label>
          </div>
          <p className="mb-1 text-xs text-gray-400">
            Shown as downloadable links below the content on the staff-facing Shop Training page — a checklist,
            reference sheet, or any other file that's easier to hand over as-is than to type into the content above.
          </p>
          {files.length > 0 && (
            <div className="space-y-1.5">
              {files.map((f) => {
                const key = f._key ?? f.id
                return (
                  <div key={key} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
                    <input
                      className="input flex-1"
                      placeholder="Display name"
                      value={f.display_name}
                      onChange={(e) => renameFile(key, e.target.value)}
                    />
                    <button onClick={() => removeFile(key)} className="shrink-0 text-gray-400 hover:text-red-500">
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
