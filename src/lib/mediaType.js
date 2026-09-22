const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'])

function extensionOf(path) {
  const clean = path.split('?')[0].split('#')[0]
  return clean.split('.').pop()?.toLowerCase()
}

// Formula Database's Method steps and Notes store a plain URL for whatever
// was attached — either a file uploaded to our own Supabase Storage bucket
// (always has a real extension, since we keep the original filename), or a
// link the admin pasted to a video that already lives somewhere else (a
// shared training-video repository, YouTube, Google Drive, etc.) so the
// same recording can be reused across multiple drinks instead of being
// re-uploaded per item. This tells the three apart so the right thing gets
// rendered wherever the field is shown (Edit Item's own thumbnails, the
// live Preview panel, and the staff-facing Formula page):
//   'image' — show it with <img>
//   'video' — a direct video file — show it with <video controls>
//   'link'  — no recognizable media extension — we can't embed/play it
//             ourselves, so show a plain clickable "watch video" link that
//             opens it in a new tab instead
export function getMediaKind(path) {
  if (!path) return null
  const ext = extensionOf(path)
  if (ext && VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (ext && IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'link'
}

export function isVideoPath(path) {
  return getMediaKind(path) === 'video'
}
