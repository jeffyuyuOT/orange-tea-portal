import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Modal from './Modal'
import { EmptyState } from './LoadingSpinner'

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|svg|bmp)$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|avi|mkv)$/i

// Jeff, 2026-10-02: "admin centre裡的formula, admin quiz，add image/video
// 旁都新增'+ from file repository'，選擇的話可以從file repository新增檔
// 案...training centre裡的branch或shop training的編輯頁面裡，+ Add file旁
// 也顯示" — a shared, generalized picker (same browse/search/pick shape as
// quiz-bank/QuizImagePicker.jsx, which stays as its own image-only
// component for that one existing call site) for every OTHER "add image/
// video"/"+ Add file" control that wants to reuse a file already sitting
// in File Repository instead of uploading a fresh copy.
//
// `accept` controls which rows are offered: 'image' (thumbnail grid, the
// default), 'video', 'media' (image+video together — Formula Database's
// step/notes/video fields all take either), or 'all' (any file at all —
// Shop Training's generic downloadable attachments). file_repository has
// no mime-type column, so "what kind of file is this" is judged by
// extension, same approach QuizImagePicker already uses. Non-image rows
// (video/other) show a placeholder icon instead of trying to thumbnail
// them.
//
// onSelect receives the whole file_repository row (not just file_path) so
// callers that need a full public URL (Formula Database's fields, which
// store a complete `formula-images`-bucket URL rather than a bucket-
// relative path) can build one, while callers that just want the bucket-
// relative path/display name (Shop Training's attachments, already in that
// shape) can destructure what they need.
export default function FileRepositoryPicker({ accept = 'image', title, onSelect, onClose }) {
  const [files, setFiles] = useState(null) // null = still loading
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase
      .from('file_repository')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .then(({ data }) => {
        let rows = data ?? []
        if (accept === 'image') rows = rows.filter((f) => IMAGE_EXT_RE.test(f.file_path))
        else if (accept === 'video') rows = rows.filter((f) => VIDEO_EXT_RE.test(f.file_path))
        else if (accept === 'media') rows = rows.filter((f) => IMAGE_EXT_RE.test(f.file_path) || VIDEO_EXT_RE.test(f.file_path))
        // 'all' — no filtering
        setFiles(rows)
      })
  }, [accept])

  const visible = (files ?? []).filter((f) => f.display_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <Modal open onClose={onClose} wide title={title || 'Choose from File Repository'}>
      <input
        className="input mb-3"
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {files === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !visible.length ? (
        <EmptyState label="No matching files in File Repository yet." />
      ) : (
        <div className="grid max-h-[60vh] grid-cols-4 gap-3 overflow-y-auto">
          {visible.map((f) => {
            const isImage = IMAGE_EXT_RE.test(f.file_path)
            const isVideo = VIDEO_EXT_RE.test(f.file_path)
            return (
              <button
                key={f.id}
                onClick={() => onSelect(f)}
                className="group overflow-hidden rounded-lg border border-gray-200 text-left hover:border-brand-400"
              >
                {isImage ? (
                  <img
                    src={supabase.storage.from('documents').getPublicUrl(f.file_path).data.publicUrl}
                    alt={f.display_name}
                    className="h-24 w-full bg-gray-50 object-contain"
                  />
                ) : (
                  <div className="flex h-24 w-full items-center justify-center bg-gray-50 text-3xl">
                    {isVideo ? '🎬' : '📄'}
                  </div>
                )}
                <div className="truncate px-2 py-1 text-xs text-gray-600 group-hover:text-brand-700">{f.display_name}</div>
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
