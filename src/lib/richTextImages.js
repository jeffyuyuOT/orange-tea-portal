import { supabase } from './supabaseClient'

// Jeff, 2026-10-02: "公告刪除時一併刪除對應的 storage 檔案" — SimpleRichTextEditor
// inserts an uploaded photo as a plain `<img src="<public storage URL>">`
// tag directly inside content_html (see its insertImage()); there's no
// separate attachments table anywhere, so that HTML string is the ONLY
// record of which storage object(s) a post owns. Deleting the post row
// alone (announcements.delete()) left the actual file sitting in the
// bucket forever — this is what finds and removes it.
//
// Matches Supabase's public-URL shape —
// https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path> —
// without caring which host it's running against, so this works the same
// against the test and production Supabase projects (different
// VITE_SUPABASE_URL per env, same URL shape).
export function extractStorageImagePaths(html, bucket) {
  if (!html) return []
  const re = new RegExp(`/storage/v1/object/public/${bucket}/([^"')\\s<>]+)`, 'g')
  const paths = new Set()
  let match
  while ((match = re.exec(html))) {
    paths.add(decodeURIComponent(match[1]))
  }
  return Array.from(paths)
}

// Best-effort cleanup: called AFTER the caller's own row delete already
// succeeded, and any failure here (storage RLS denying a particular actor,
// a network hiccup, the file already being gone) is swallowed rather than
// surfaced — an orphaned file is a minor miss, not a reason to make the
// user's delete/retract look like it failed when the post itself is
// already gone.
export async function deleteStorageImages(html, bucket = 'documents') {
  const paths = extractStorageImagePaths(html, bucket)
  if (!paths.length) return
  try {
    await supabase.storage.from(bucket).remove(paths)
  } catch {
    // best-effort — see comment above
  }
}
