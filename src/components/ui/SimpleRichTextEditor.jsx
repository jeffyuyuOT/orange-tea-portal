import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

// A minimal contentEditable-based rich text editor (bold / italic / list /
// link) that stores its value as an HTML string. This keeps the project
// dependency-free; swap in TipTap or Quill later if richer editing
// (tables, embedded images with resize, etc.) is needed.
//
// Photo insertion is opt-in via `imageUploadPath` — pass a storage folder
// (e.g. `announcements/${storeId}`) to show a 📷 Photo button that uploads
// the picked file and inserts it inline at the cursor; leave it unset for
// callers that don't need images (most of this editor's other uses).
// A plain <input type="file" accept="image/*"> (no `capture` attribute)
// is what gives mobile browsers the "Take Photo / Choose from Library"
// picker — adding `capture` would force the camera and remove the gallery
// option.
export default function SimpleRichTextEditor({ value, onChange, placeholder = 'Type here…', imageUploadPath, imageBucket = 'documents' }) {
  const ref = useRef(null)
  const fileInputRef = useRef(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  // Only push `value` into the DOM when it changed from OUTSIDE this editor
  // (opening a different item, switching category, etc). Writing it on every
  // keystroke — via a reactive dangerouslySetInnerHTML — used to reset the
  // caret to the start of the field on every character typed, which made
  // typing feel reversed.
  useEffect(() => {
    const el = ref.current
    if (el && el.innerHTML !== (value || '')) {
      el.innerHTML = value || ''
    }
  }, [value])

  function exec(cmd) {
    // Focus BEFORE running the command, not after — execCommand acts on
    // whatever has an active selection right now, and if the editable div
    // was never focused yet (e.g. clicking a toolbar button before ever
    // clicking into the text area), running the command first had nothing
    // to apply to and silently did nothing — most noticeable on the list
    // buttons, since bold/italic on an empty/unfocused field already looked
    // like a no-op to begin with.
    ref.current?.focus()
    document.execCommand(cmd)
    onChange?.(ref.current?.innerHTML ?? '')
  }

  async function insertImage(file) {
    if (!file || !imageUploadPath) return
    setUploadingImage(true)
    const path = `${imageUploadPath}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from(imageBucket).upload(path, file, { upsert: true })
    setUploadingImage(false)
    if (error) {
      alert(`Image upload failed: ${error.message}`)
      return
    }
    const { data } = supabase.storage.from(imageBucket).getPublicUrl(path)
    ref.current?.focus()
    document.execCommand('insertHTML', false, `<img src="${data.publicUrl}" alt="" />`)
    onChange?.(ref.current?.innerHTML ?? '')
  }

  return (
    <div className="rounded-lg border border-gray-300 focus-within:border-brand-400">
      <div className="flex gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1 rounded-t-lg">
        <ToolbarButton onClick={() => exec('bold')}><b>B</b></ToolbarButton>
        <ToolbarButton onClick={() => exec('italic')}><i>I</i></ToolbarButton>
        <ToolbarButton onClick={() => exec('insertUnorderedList')}>• List</ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')}>1. List</ToolbarButton>
        {imageUploadPath && (
          <>
            <ToolbarButton onClick={() => fileInputRef.current?.click()} disabled={uploadingImage}>
              📷 {uploadingImage ? 'Uploading…' : 'Photo'}
            </ToolbarButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                insertImage(e.target.files[0])
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange?.(e.currentTarget.innerHTML)}
        data-placeholder={placeholder}
        className="prose-content min-h-[100px] px-3 py-2 text-sm outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400"
      />
    </div>
  )
}

function ToolbarButton({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className="rounded px-2 py-0.5 text-xs text-gray-600 hover:bg-brand-100 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}
