import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabaseClient'
import { useAuth } from '../../../../lib/AuthContext'
import Button from '../../../../components/ui/Button'
import Badge from '../../../../components/ui/Badge'
import Modal from '../../../../components/ui/Modal'
import SimpleRichTextEditor from '../../../../components/ui/SimpleRichTextEditor'
import { EmptyState } from '../../../../components/ui/LoadingSpinner'

// Moved here from Admin Center (migration 0052): each store now owns its own
// training content outright — no more one shared global list with an
// optional "visible at these stores" restriction. Switching stores (the
// picker up in the header, which now shows here since this page is no
// longer under /admin-center) edits that store's own items. Admins keep a
// "Copy to store…" action per item for seeding another store from an
// existing one — see CopyToStoreModal below.
//
// Jeff, 2026-09: moved a second time, from its own top-level Shop Management
// page into a Training Centre sub-tab alongside Quiz Bank ("將quiz bank裡的
// quiz bank跟shop training database合併變成training centre") — same
// per-store shape of content, same "copy to other store" admin/developer
// action, so it now lives next to its Quiz Bank counterpart. No code changes
// needed for the move itself — this file's relative import depth is
// unchanged.
export default function ShopTrainingDatabasePage() {
  const { profile, currentStoreId, accessibleStores } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [copyingItem, setCopyingItem] = useState(null)
  // Locks BOTH ↑/↓ buttons for every row while a reorder is in flight — not
  // just the one clicked — since a reorder is a two-step swap (two
  // sequential updates) and a second click landing mid-swap could race it
  // and leave sort_order inconsistent, not just double-fire.
  const [moving, setMoving] = useState(false)

  // Jeff, 2026-09: "developer也要像admin一樣可以copy到其他分店" — developer
  // is meant to be admin's superset everywhere (RLS already treats it that
  // way since migration 0058), but this was a front-end-only miss: the
  // "Copy to store…" button/copy checked the literal 'admin' role and never
  // included 'developer'.
  const isAdmin = profile?.role === 'admin' || profile?.role === 'developer'

  async function load() {
    if (!currentStoreId) return
    setLoading(true)
    const { data } = await supabase.from('shop_training_items').select('*').eq('store_id', currentStoreId).order('sort_order')
    setItems(data ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [currentStoreId]) // eslint-disable-line react-hooks/exhaustive-deps

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
      {/* No own <h1> here — this now renders under TrainingCentreLayout's
          shared "Training Centre" heading + tab bar, same as QuizBankPage.jsx
          alongside it. */}
      <p className="mb-4 text-sm text-gray-500">
        Content shown in Operations &amp; Training &gt; Shop Training — for the store selected above only. Switch
        stores to edit another store's content.
        {isAdmin && ' As an admin, you can also copy an item from here straight into other stores.'}
      </p>

      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing({})}>+ New Item</Button>
      </div>

      {loading ? null : !items.length ? (
        <EmptyState label="No shop training items yet for this store." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {items.map((item, idx) => (
            <div key={item.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <button onClick={() => setEditing(item)} className="flex flex-1 items-center gap-2 text-left">
                <span className="font-medium text-gray-800">{item.title}</span>
                {item.visible_to_training && <Badge color="green">Visible to Training</Badge>}
              </button>
              <div className="flex shrink-0 items-center gap-1">
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
                {isAdmin && (
                  <Button variant="secondary" onClick={() => setCopyingItem(item)}>
                    Copy to store…
                  </Button>
                )}
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
          currentStoreId={currentStoreId}
          profileId={profile.id}
          profileName={`${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      {copyingItem && (
        <CopyToStoreModal
          item={copyingItem}
          currentStoreId={currentStoreId}
          accessibleStores={accessibleStores}
          onClose={() => setCopyingItem(null)}
        />
      )}
    </div>
  )
}

function EditModal({ item, nextSortOrder, currentStoreId, profileId, profileName, onClose, onSaved }) {
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

  async function addFiles(fileList) {
    setUploadingFile(true)
    // Uploaded one at a time (not Promise.all) so a shared timestamp prefix
    // can't collide two files picked in the same click into the same path.
    for (const file of Array.from(fileList)) {
      const path = `shop-training/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
      if (error) {
        alert(error.message)
      } else {
        setFiles((prev) => [...prev, { _key: Math.random(), display_name: file.name, file_path: path }])
      }
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
          store_id: currentStoreId,
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
                multiple
                className="hidden"
                disabled={uploadingFile}
                onChange={(e) => e.target.files.length && addFiles(e.target.files)}
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

// Admin-only: duplicates one item (title, content, "visible to training",
// and every attached file) straight into one or more other stores, each as
// its own brand-new row/id — the same as if that store's manager had
// created it themselves. The two copies are independent from that point on;
// editing this store's item afterwards does not touch the copies.
function CopyToStoreModal({ item, currentStoreId, accessibleStores, onClose }) {
  const targets = accessibleStores.filter((s) => s.id !== currentStoreId)
  const [selected, setSelected] = useState(new Set())
  const [copying, setCopying] = useState(false)

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copy() {
    if (!selected.size) return
    if (
      !confirm(
        `Copy "${item.title}" to ${selected.size} store(s)? This adds a new, independent copy at each — it won't stay linked to this one.`
      )
    ) {
      return
    }
    setCopying(true)
    const { data: sourceFiles } = await supabase
      .from('shop_training_item_files')
      .select('*')
      .eq('shop_training_item_id', item.id)
      .order('sort_order')

    let failCount = 0
    for (const storeId of selected) {
      const { count } = await supabase
        .from('shop_training_items')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', storeId)
      const { data: newItem, error } = await supabase
        .from('shop_training_items')
        .insert({
          title: item.title,
          content_html: item.content_html,
          visible_to_training: item.visible_to_training,
          sort_order: count ?? 0,
          store_id: storeId,
        })
        .select()
        .single()
      if (error || !newItem) {
        failCount += 1
        continue
      }
      if (sourceFiles?.length) {
        await supabase.from('shop_training_item_files').insert(
          sourceFiles.map((f) => ({
            shop_training_item_id: newItem.id,
            display_name: f.display_name,
            file_path: f.file_path,
            sort_order: f.sort_order,
          }))
        )
      }
    }
    setCopying(false)
    onClose()
    alert(failCount ? `Copied, but ${failCount} store(s) failed.` : `Copied to ${selected.size} store(s).`)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Copy "${item.title}" to…`}
      footer={
        <Button onClick={copy} disabled={copying || !selected.size}>
          {copying ? 'Copying…' : `Copy to ${selected.size || ''} store(s)`}
        </Button>
      }
    >
      {!targets.length ? (
        <p className="text-sm text-gray-500">No other stores to copy to.</p>
      ) : (
        <div className="space-y-1.5">
          {targets.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              {s.name}
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}
