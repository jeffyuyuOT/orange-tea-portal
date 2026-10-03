// Jeff, 2026-10-03: Toowong的Angel掃clock in/out的QR code出現
// "Permission denied" — that's the raw getUserMedia() DOMException message
// surfacing straight to the user (both QrScannerModal and CameraCaptureModal
// used to just do `setError(err?.message || '...')`). "Permission denied"
// on its own gives a staff member nothing to act on, so this turns the
// handful of getUserMedia error names into guidance they can actually
// follow — mainly "camera access is blocked for this site, here's how to
// unblock it", since that's by far the most common real-world cause (an
// earlier accidental "Block" tap on the browser's camera prompt, or the
// browser app's own OS-level camera permission being off) rather than
// anything wrong with the portal itself.
//
// Jeff, 2026-10-03 (same-day follow-up): Angel's Samsung S25 Ultra kept
// showing this even after she checked "camera is Allow" everywhere she
// looked, and a different phone on the same account worked fine — a
// device/permission-layering problem, not an account/RLS one. The likely
// gap: this app installs as a standalone PWA (manifest's `display:
// "standalone"`, see vite.config.js — and Jeff specifically built the
// long-press "Scan to Clock In/Out" shortcut for exactly this install),
// which Android gives its OWN separate app identity (its own entry in
// Settings > Apps, its own camera permission) distinct from Chrome/Samsung
// Internet itself. Checking "the browser's" permission while actually
// launching the installed home-screen icon checks the wrong one. Samsung
// One UI also has a separate system-wide Quick Panel "Camera access"
// toggle that silently blocks every app's camera at once, independent of
// any one app's own permission. Added both as explicit checks below so the
// message covers the installed-app case, not just "the browser".
export function cameraAccessErrorMessage(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' || err?.name === 'SecurityError') {
    return "Camera access is blocked. If you're using the OT Portal icon on your home screen, Android treats it as its own app — go to Settings > Apps > \"OT Portal\" (not Chrome/Samsung Internet) > Permissions > Camera → Allow. Also check the Camera access toggle in your phone's quick settings panel (swipe down from the top) isn't switched off — that blocks every app's camera at once on Samsung phones. If you opened this in a regular browser tab instead, tap the lock/info icon next to the address bar → Permissions (or Site settings) → Camera → Allow. Reload the page after changing anything."
  }
  if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
    return 'No camera was found on this device.'
  }
  if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
    return 'The camera is already in use by another app — close it and try again.'
  }
  return err?.message || 'Could not access the camera.'
}
