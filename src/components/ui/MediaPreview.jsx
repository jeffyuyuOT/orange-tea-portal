import { getMediaKind } from '../../lib/mediaType'

// Renders whatever was attached to a Method step or Notes field: an
// uploaded image, an uploaded video, or a link the admin pasted to a video
// that already lives somewhere else (a shared training-video repository,
// YouTube, Google Drive, etc.) — so one recording can be reused across
// several drinks instead of being uploaded separately to each item. We
// can't know how to embed an arbitrary external link, so that case just
// becomes a plain "watch video" link that opens in a new tab; an actual
// image or video file (uploaded here or linked directly) renders inline.
export default function MediaPreview({ src, alt = '', className = '' }) {
  const kind = getMediaKind(src)
  if (!kind) return null
  if (kind === 'video') return <video src={src} controls className={className} />
  if (kind === 'image') return <img src={src} alt={alt} className={className} />
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
    >
      ▶ Watch video
    </a>
  )
}
