import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Modal from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/LoadingSpinner'

// file_repository has no mime-type column, so "is this an image" is judged
// by file extension — good enough since every file offered here was itself
// uploaded as an image (via this same picker or File Repository directly).
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|svg|bmp)$/i

// Browse-only: lets a question reuse an image someone already uploaded
// (here or in File Repository directly) instead of uploading it again —
// see QuestionEditModal, which also offers "Upload new image" alongside
// this for a brand new picture.
export default function QuizImagePicker({ onSelect, onClose }) {
  const [files, setFiles] = useState(null) // null = still loading
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase
      .from('file_repository')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .then(({ data }) => setFiles((data ?? []).filter((f) => IMAGE_EXT_RE.test(f.file_path))))
  }, [])

  const visible = (files ?? []).filter((f) => f.display_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <Modal open onClose={onClose} wide title="Choose an image from File Repository">
      <input
        className="input mb-3"
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {files === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !visible.length ? (
        <EmptyState label="No images in File Repository yet — use “Upload new image” instead." />
      ) : (
        <div className="grid max-h-[60vh] grid-cols-4 gap-3 overflow-y-auto">
          {visible.map((f) => (
            <button
              key={f.id}
              onClick={() => onSelect(f.file_path)}
              className="group overflow-hidden rounded-lg border border-gray-200 text-left hover:border-brand-400"
            >
              <img
                src={supabase.storage.from('documents').getPublicUrl(f.file_path).data.publicUrl}
                alt={f.display_name}
                className="h-24 w-full bg-gray-50 object-contain"
              />
              <div className="truncate px-2 py-1 text-xs text-gray-600 group-hover:text-brand-700">{f.display_name}</div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
