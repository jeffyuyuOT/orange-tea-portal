import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// Add/rename/delete File Repository categories, opened from the File
// Repository page. A single Modal switches between the list and the
// add/edit form (rather than opening a second Modal on top) so only one
// dialog is ever on screen at once. `categories` and `onChanged` are owned
// by the caller so the dropdown there stays in sync without a second fetch.
//
// Renaming and deleting are always safe here: a category is identified
// everywhere by its permanent `id`, never by its label, and My
// Information's TFN/Super/Parent Consent document downloads are keyed by
// their own fixed id independent of any category (see
// src/lib/staffDocumentTypes.js) — so nothing about those three document
// types depends on any category continuing to exist.
export default function FileCategoryManager({ categories, onClose, onChanged }) {
  const [editing, setEditing] = useState(null) // null=list view, {}=new, row=edit

  if (editing) {
    return (
      <CategoryEditForm
        category={editing}
        nextSortOrder={categories.length}
        onBack={() => setEditing(null)}
        onClose={onClose}
        onSaved={() => {
          setEditing(null)
          onChanged()
        }}
      />
    )
  }

  return (
    <Modal open onClose={onClose} title="File Categories">
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing({})}>+ New Category</Button>
      </div>
      {!categories.length ? (
        <EmptyState label="No categories yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2.5">
              <span className="text-sm font-medium text-gray-800">{c.label}</span>
              <Button variant="secondary" onClick={() => setEditing(c)}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function CategoryEditForm({ category, nextSortOrder, onBack, onClose, onSaved }) {
  const [label, setLabel] = useState(category.label ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const { error } = category.id
      ? await supabase.from('file_repository_categories').update({ label }).eq('id', category.id)
      : await supabase.from('file_repository_categories').insert({ label, sort_order: nextSortOrder })
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    onSaved()
  }

  // Files left under this category just become uncategorized (see 0023's
  // FK change) rather than blocking the delete outright — but the admin
  // should know that's about to happen, hence the count in the warning.
  async function remove() {
    setSaving(true)
    const { count } = await supabase
      .from('file_repository')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', category.id)
    setSaving(false)
    const message = count
      ? `${count} file${count === 1 ? '' : 's'} in this category will become uncategorized. Delete "${category.label}" anyway?`
      : `Delete "${category.label}"?`
    if (!confirm(message)) return
    setSaving(true)
    const { error } = await supabase.from('file_repository_categories').delete().eq('id', category.id)
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
      title={category.id ? 'Edit Category' : 'New Category'}
      footer={
        <>
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          {category.id && (
            <Button variant="danger" onClick={remove} disabled={saving}>
              Delete
            </Button>
          )}
          <Button onClick={save} disabled={saving || !label.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Name</span>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Marketing Assets" />
      </label>
    </Modal>
  )
}
