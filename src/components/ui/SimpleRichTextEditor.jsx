import { useRef } from 'react'

// A minimal contentEditable-based rich text editor (bold / italic / list /
// link) that stores its value as an HTML string. This keeps the project
// dependency-free; swap in TipTap or Quill later if richer editing
// (tables, embedded images with resize, etc.) is needed.
export default function SimpleRichTextEditor({ value, onChange, placeholder = 'Type here…' }) {
  const ref = useRef(null)

  function exec(cmd) {
    document.execCommand(cmd)
    ref.current?.focus()
    onChange?.(ref.current?.innerHTML ?? '')
  }

  return (
    <div className="rounded-lg border border-gray-300 focus-within:border-brand-400">
      <div className="flex gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1 rounded-t-lg">
        <ToolbarButton onClick={() => exec('bold')}><b>B</b></ToolbarButton>
        <ToolbarButton onClick={() => exec('italic')}><i>I</i></ToolbarButton>
        <ToolbarButton onClick={() => exec('insertUnorderedList')}>• List</ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')}>1. List</ToolbarButton>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange?.(e.currentTarget.innerHTML)}
        data-placeholder={placeholder}
        className="min-h-[100px] px-3 py-2 text-sm outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400"
        dangerouslySetInnerHTML={{ __html: value || '' }}
      />
    </div>
  )
}

function ToolbarButton({ onClick, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded px-2 py-0.5 text-xs text-gray-600 hover:bg-brand-100 hover:text-brand-700"
    >
      {children}
    </button>
  )
}
