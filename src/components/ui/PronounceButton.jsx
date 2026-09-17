// Speaks a Chinese (or any) string aloud using the browser's built-in
// Web Speech API (SpeechSynthesis) — free, instant, no external service
// call. Falls back to a disabled icon with a tooltip if the browser
// doesn't support speech synthesis at all.
export default function PronounceButton({ text, lang = 'zh-TW', className = '' }) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  function speak(e) {
    e?.stopPropagation()
    if (!supported || !text) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    utterance.rate = 0.9
    window.speechSynthesis.speak(utterance)
  }

  return (
    <button
      type="button"
      onClick={speak}
      disabled={!supported || !text}
      title={supported ? `Pronounce "${text}"` : 'Speech synthesis not supported in this browser'}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-brand-600 hover:bg-brand-100 disabled:opacity-30 ${className}`}
      aria-label="Pronounce"
    >
      🔊
    </button>
  )
}
