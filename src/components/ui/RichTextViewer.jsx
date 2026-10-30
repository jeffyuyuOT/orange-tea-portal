import { useEffect, useMemo, useRef } from 'react'

// Renders stored HTML (from SimpleRichTextEditor) safely-enough for
// internal admin-authored content. If you later accept untrusted input,
// sanitize with a library like DOMPurify before rendering.
//
// Jeff, 2026-10-26: "如果training內文是連結，要可以直接點擊進連結觀看" — a
// training item's content is often just a bare URL pasted in as plain text
// (e.g. a YouTube link), not something typed through an "insert link"
// button, so it was rendering as plain unclickable text. `linkifyHtml`
// below walks the stored HTML's actual text (never its tags/attributes, so
// an existing real <a href>'s URL is untouched) and wraps any bare
// http(s):// URL it finds in a clickable, new-tab link.
const URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

function linkifyHtml(html) {
  if (!html || typeof document === 'undefined') return html
  const container = document.createElement('div')
  container.innerHTML = html

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
  const textNodes = []
  let node
  while ((node = walker.nextNode())) {
    // Text already inside a real <a> is already clickable — leave it alone
    // rather than nesting a second link inside it.
    if (node.parentElement?.closest('a')) continue
    URL_REGEX.lastIndex = 0
    if (URL_REGEX.test(node.nodeValue)) textNodes.push(node)
  }

  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue
    const frag = document.createDocumentFragment()
    let lastIndex = 0
    let match
    URL_REGEX.lastIndex = 0
    while ((match = URL_REGEX.exec(text))) {
      let url = match[0]
      let end = match.index + url.length
      // A URL at the end of a sentence tends to have trailing punctuation
      // that isn't actually part of it (".", "，", a closing paren, …) —
      // trim it off the link and leave it in the surrounding text instead.
      const trailing = url.match(TRAILING_PUNCTUATION)
      if (trailing) {
        url = url.slice(0, url.length - trailing[0].length)
        end -= trailing[0].length
      }
      if (!url) continue
      if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noreferrer'
      a.className = 'text-brand-600 underline hover:no-underline'
      a.textContent = url
      frag.appendChild(a)
      lastIndex = end
    }
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)))
    textNode.parentNode.replaceChild(frag, textNode)
  })

  return container.innerHTML
}

// Jeff, 2026-10-30: "可以點擊該歷史紀錄（顯示highlight），然後該記錄編輯的
// 文字也highlight" — a merge-mode notice's History list (AnnouncementDetail
// Modal.jsx) can pass `highlightId` (an announcement_history row's id) to
// flash the matching merged-comment block appended by that history entry
// (append_merged_comment(), migration 0159, stamps each block with
// data-comment-id="<that history row's id>"). Plain DOM manipulation
// rather than real React state, since the content this searches is itself
// raw HTML rendered via dangerouslySetInnerHTML below, not React elements
// — there's nothing else to attach a prop/class to.
function applyHighlight(container, highlightId) {
  if (!container) return
  container.querySelectorAll('[data-comment-id]').forEach((el) => {
    el.style.backgroundColor = ''
    el.style.transition = ''
  })
  if (!highlightId) return
  const target = container.querySelector(`[data-comment-id="${CSS.escape(String(highlightId))}"]`)
  if (!target) return
  target.style.transition = 'background-color 0.3s ease'
  target.style.backgroundColor = '#fef9c3'
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

export default function RichTextViewer({ html, className = '', highlightId = null }) {
  const containerRef = useRef(null)
  const linkedHtml = useMemo(() => linkifyHtml(html), [html])

  useEffect(() => {
    applyHighlight(containerRef.current, highlightId)
  }, [highlightId, linkedHtml])

  if (!html) return null
  return (
    <div
      ref={containerRef}
      className={`prose-content text-sm text-gray-700 ${className}`}
      dangerouslySetInnerHTML={{ __html: linkedHtml }}
    />
  )
}
