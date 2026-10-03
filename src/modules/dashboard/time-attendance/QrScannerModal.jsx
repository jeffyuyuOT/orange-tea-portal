import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { cameraAccessErrorMessage } from '../../../lib/cameraError'

// Live in-page camera scan — same getUserMedia + <video> approach as
// CameraCaptureModal (staying inside the page/tab, never handing off to a
// native camera app — see that file's comment for why that handoff was a
// problem on mobile). Instead of one manual snapshot, this continuously
// grabs frames onto an offscreen canvas and runs jsQR on them until a code
// decodes, then reports the raw scanned string back to the caller — which
// is responsible for deciding whether it's a valid, fresh Orange Tea QR
// (see src/lib/attendance.js's parseAndValidateQrPayload /
// parseAndValidateStaffIdPayload — this modal is generic between the two,
// the caller just passes the wording that fits which one it's scanning
// for). `title`/`hint` default to the original Clock In/Out wording so the
// existing call site there doesn't need to change.
export default function QrScannerModal({
  onScan,
  onClose,
  title = 'Scan QR Code',
  hint = "Point the camera at the QR code on the store's screen",
}) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const canvasRef = useRef(document.createElement('canvas'))
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser doesn’t support in-page camera access.')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        rafRef.current = requestAnimationFrame(tick)
      })
      .catch((err) => setError(cameraAccessErrorMessage(err)))

    function tick() {
      const video = videoRef.current
      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        const canvas = canvasRef.current
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)
        if (code?.data) {
          onScan(code.data)
          return // caller is expected to close this modal; stop scanning
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <div className="relative">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted className="w-full rounded-lg bg-black" />
          <p className="mt-2 text-center text-xs text-gray-400">{hint}</p>
        </div>
      )}
    </Modal>
  )
}
