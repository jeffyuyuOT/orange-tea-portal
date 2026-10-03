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
export function cameraAccessErrorMessage(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' || err?.name === 'SecurityError') {
    return "Camera access is blocked for this site. Tap the lock/info icon next to the address bar → Permissions (or Site settings) → Camera → Allow, then reload this page. If that doesn't show a Camera option, check your phone's Settings > Apps > (your browser, e.g. Chrome/Samsung Internet) > Permissions > Camera is turned on."
  }
  if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
    return 'No camera was found on this device.'
  }
  if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
    return 'The camera is already in use by another app — close it and try again.'
  }
  return err?.message || 'Could not access the camera.'
}
