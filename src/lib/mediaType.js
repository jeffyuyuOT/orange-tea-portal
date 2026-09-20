const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'])

// Formula Database's Method steps and Notes store a plain storage path/URL
// for whatever was uploaded — this tells whether that file is a video
// (an actual filming of how something is made) instead of a photo, so the
// same field/upload button can hold either and the right tag (<video> vs
// <img>) gets used wherever it's shown (Edit Item's own thumbnails, the
// live Preview panel, and the staff-facing Formula page).
export function isVideoPath(path) {
  if (!path) return false
  const clean = path.split('?')[0].split('#')[0]
  const ext = clean.split('.').pop()?.toLowerCase()
  return !!ext && VIDEO_EXTENSIONS.has(ext)
}
