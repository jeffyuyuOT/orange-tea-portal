// Renders stored HTML (from SimpleRichTextEditor) safely-enough for
// internal admin-authored content. If you later accept untrusted input,
// sanitize with a library like DOMPurify before rendering.
export default function RichTextViewer({ html, className = '' }) {
  if (!html) return null
  return <div className={`prose-content text-sm text-gray-700 ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}
