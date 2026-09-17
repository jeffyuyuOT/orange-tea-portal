import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

const CATEGORIES = [
  { key: 'tfn_template', label: 'TFN Declaration Form (blank template)' },
  { key: 'super_template', label: 'Super Choice Form (blank template)' },
  { key: 'parent_consent_template', label: 'Parent Consent Form (blank template)' },
  { key: 'food_safety', label: 'Food Safety' },
  { key: 'other', label: 'Other' },
]

export default function FileRepositoryPage() {
  const { profile } = useAuth()
  const [files, setFiles] = useState([])
  const [category, setCategory] = useState(CATEGORIES[0].key)
  const [displayName, setDisplayName] = useState('')
  const [uploading, setUploading] = useState(false)

  async function load() {
    const { data } = await supabase.from('file_repository').select('*').order('uploaded_at', { ascending: false })
    setFiles(data ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  async function upload(file) {
    setUploading(true)
    const path = `repository/${category}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
    if (!error) {
      await supabase.from('file_repository').insert({
        category,
        display_name: displayName || file.name,
        file_path: path,
        uploaded_by: profile.id,
      })
      setDisplayName('')
      load()
    } else {
      alert(error.message)
    }
    setUploading(false)
  }

  async function remove(id, filePath) {
    if (!confirm('Delete this file?')) return
    await supabase.storage.from('documents').remove([filePath])
    await supabase.from('file_repository').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">File Repository</h1>
      <p className="mb-4 text-sm text-gray-500">
        Files used across the app — e.g. blank TFN / Super / Parent Consent forms that My Information links to.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-brand-100 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
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
      </div>

      {!files.length ? (
        <EmptyState label="No files uploaded yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between px-4 py-2.5">
              <div>
                <div className="text-sm font-medium text-gray-800">{f.display_name}</div>
                <div className="text-xs text-gray-400">{CATEGORIES.find((c) => c.key === f.category)?.label ?? f.category}</div>
              </div>
              <div className="flex items-center gap-3">
                <a
                  className="text-sm text-brand-600 hover:underline"
                  href={supabase.storage.from('documents').getPublicUrl(f.file_path).data.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
                <button onClick={() => remove(f.id, f.file_path)} className="text-gray-400 hover:text-red-500">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
