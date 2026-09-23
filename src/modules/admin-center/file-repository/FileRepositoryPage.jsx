import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { EmptyState } from '../../../components/ui/LoadingSpinner'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import FileCategoryManager from './FileCategoryManager'

export default function FileRepositoryPage() {
  const { profile } = useAuth()
  const [files, setFiles] = useState([])
  const [categories, setCategories] = useState([]) // from file_repository_categories — admin-editable, see FileCategoryManager
  const [categoryId, setCategoryId] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('') // '' = All categories — filters the list below, independent of the upload category above
  const [displayName, setDisplayName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [copiedId, setCopiedId] = useState(null) // brief "Copied!" feedback on the button just clicked
  const [editingFile, setEditingFile] = useState(null) // the file row currently open in the Edit modal, or null
  const [managingCategories, setManagingCategories] = useState(false)
  // Which file's ✕ button is mid-delete (covers the usage lookup + confirm
  // + the actual delete) — locks just that button against a double click.
  const [removingId, setRemovingId] = useState(null)

  async function load() {
    const { data } = await supabase.from('file_repository').select('*').order('uploaded_at', { ascending: false })
    setFiles(data ?? [])
  }
  async function loadCategories() {
    const { data } = await supabase.from('file_repository_categories').select('*').order('sort_order')
    const list = data ?? []
    setCategories(list)
    // Keep the upload form pointed at a real category — first load, or if
    // the one that was selected got removed from under it.
    setCategoryId((current) => (list.some((c) => c.id === current) ? current : (list[0]?.id ?? '')))
  }
  useEffect(() => {
    load()
    loadCategories()
  }, [])

  async function upload(file) {
    setUploading(true)
    const path = `repository/${categoryId}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
    if (!error) {
      await supabase.from('file_repository').insert({
        category_id: categoryId,
        display_name: displayName || file.name,
        file_path: path,
        uploaded_by: profile.id,
        uploaded_by_name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email,
      })
      setDisplayName('')
      load()
    } else {
      alert(error.message)
    }
    setUploading(false)
  }

  // Finds every place this file is actually in use, so deleting it doesn't
  // silently break a link someone relies on. store_document_links has a
  // real foreign key to check; the Formula Database video/image fields
  // just hold a pasted-in copy of this file's public URL as plain text
  // (see "Copy link" above), so those are matched by comparing that URL.
  async function findUsages(file) {
    const publicUrl = supabase.storage.from('documents').getPublicUrl(file.file_path).data.publicUrl
    const [storeLinks, videos, steps, notes] = await Promise.all([
      supabase.from('store_document_links').select('stores(name), file_repository_categories(label)').eq('file_repository_id', file.id),
      supabase.from('formula_item_videos').select('title, formula_items(name_en, name_zh)').eq('url', publicUrl),
      supabase.from('formula_item_steps').select('step_number, formula_items(name_en, name_zh)').eq('image_path', publicUrl),
      supabase.from('formula_items').select('name_en, name_zh').eq('notes_image_path', publicUrl),
    ])
    const itemName = (item) => item?.name_zh || item?.name_en || 'Untitled item'
    const usages = []
    ;(storeLinks.data ?? []).forEach((l) =>
      usages.push(`Store "${l.stores?.name ?? '?'}" — ${l.file_repository_categories?.label ?? 'document'} download`)
    )
    ;(videos.data ?? []).forEach((v) => usages.push(`Formula "${itemName(v.formula_items)}" — video "${v.title || 'Untitled'}"`))
    ;(steps.data ?? []).forEach((s) => usages.push(`Formula "${itemName(s.formula_items)}" — method step ${s.step_number} image`))
    ;(notes.data ?? []).forEach((n) => usages.push(`Formula "${itemName(n)}" — notes image/video`))
    return usages
  }

  async function remove(file) {
    setRemovingId(file.id)
    const usages = await findUsages(file)
    const message = usages.length
      ? `This file is linked from:\n\n${usages.map((u) => `• ${u}`).join('\n')}\n\nDeleting it will break those links. Delete anyway?`
      : 'Delete this file?'
    if (!confirm(message)) {
      setRemovingId(null)
      return
    }
    await supabase.storage.from('documents').remove([file.file_path])
    await supabase.from('file_repository').delete().eq('id', file.id)
    await load()
    setRemovingId(null)
  }

  // The URL itself was previously only reachable by right-clicking
  // "Download" — this puts it directly on the clipboard so a link (e.g. a
  // training video's URL) can be pasted straight into the "video link"
  // field on a Formula Database item, or anywhere else that needs it.
  async function copyLink(id, filePath) {
    const url = supabase.storage.from('documents').getPublicUrl(filePath).data.publicUrl
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
    } catch {
      prompt('Copy this link:', url)
    }
  }

  const visibleFiles = filterCategoryId ? files.filter((f) => f.category_id === filterCategoryId) : files

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">File Repository</h1>
      <p className="mb-4 text-sm text-gray-500">
        Files used across the app — e.g. blank TFN / Super / Parent Consent forms that My Information links to.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-brand-100 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Category</span>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Display name (optional)</span>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="cursor-pointer rounded-lg border border-brand-300 px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
          {uploading ? 'Uploading…' : 'Upload file'}
          <input type="file" className="hidden" disabled={uploading} onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
        </label>
        <Button variant="secondary" onClick={() => setManagingCategories(true)}>
          Manage categories
        </Button>
      </div>

      <label className="mb-2 block w-64">
        <span className="mb-1 block text-xs font-medium text-gray-500">Filter by category</span>
        <select className="input" value={filterCategoryId} onChange={(e) => setFilterCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {!visibleFiles.length ? (
        <EmptyState label={files.length ? 'No files in this category.' : 'No files uploaded yet.'} />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {visibleFiles.map((f) => (
            <div key={f.id} className="flex items-center justify-between px-4 py-2.5">
              <div>
                <div className="text-sm font-medium text-gray-800">{f.display_name}</div>
                <div className="text-xs text-gray-400">{categories.find((c) => c.id === f.category_id)?.label ?? '(no category)'}</div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => copyLink(f.id, f.file_path)} className="text-sm text-brand-600 hover:underline">
                  {copiedId === f.id ? 'Copied!' : 'Copy link'}
                </button>
                <a
                  className="text-sm text-brand-600 hover:underline"
                  href={supabase.storage.from('documents').getPublicUrl(f.file_path).data.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
                <button onClick={() => setEditingFile(f)} className="text-sm text-brand-600 hover:underline">
                  Edit
                </button>
                <button
                  onClick={() => remove(f)}
                  disabled={removingId === f.id}
                  className="text-gray-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingFile && (
        <EditFileModal
          file={editingFile}
          categories={categories}
          onClose={() => setEditingFile(null)}
          onSaved={() => {
            setEditingFile(null)
            load()
          }}
        />
      )}

      {managingCategories && (
        <FileCategoryManager
          categories={categories}
          onClose={() => setManagingCategories(false)}
          onChanged={loadCategories}
        />
      )}
    </div>
  )
}

function EditFileModal({ file, categories, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(file.display_name ?? '')
  const [categoryId, setCategoryId] = useState(file.category_id ?? categories[0]?.id ?? '')
  const [saving, setSaving] = useState(false)

  // Renames/re-categorizes the file_repository row only — the uploaded
  // file itself (and its storage path/link) is untouched, so any link
  // already copied out of here (e.g. pasted into a Formula item's video
  // link field) keeps working after an edit.
  async function save() {
    setSaving(true)
    const { error } = await supabase.from('file_repository').update({ display_name: displayName, category_id: categoryId }).eq('id', file.id)
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit File"
      footer={
        <Button onClick={save} disabled={saving || !displayName}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Display name</span>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Category</span>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  )
}
