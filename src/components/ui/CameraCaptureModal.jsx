import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import Button from './Button'

// A live in-page camera capture — getUserMedia + a <video> preview + a
// canvas snapshot — instead of a plain <input type="file" capture>, which
// hands the whole page off to the OS's native camera app. That handoff is
// what was causing the app to reload after taking a photo: backgrounding
// the browser tab to run the camera app is exactly when mobile Chrome/
// Safari (especially Android, under memory pressure) will kill the tab,
// so it comes back as a fresh reload instead of resuming where you were.
// Staying inside the page — the preview and the Capture button are both
// rendered right here — never leaves the browser tab at all.
export default function CameraCaptureModal({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState('')
  const [captured, setCaptured] = useState(null) // data URL of the still frame, once taken

  useEffect(() => {
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser doesn’t support in-page camera capture.')
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
      })
      .catch((err) => setError(err?.message || 'Could not access the camera.'))
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function takePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    setCaptured(canvas.toDataURL('image/jpeg', 0.9))
  }

  function usePhoto() {
    if (!captured) return
    fetch(captured)
      .then((res) => res.blob())
      .then((blob) => onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Take Photo"
      footer={
        error ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : captured ? (
          <>
            <Button variant="secondary" onClick={() => setCaptured(null)}>
              Retake
            </Button>
            <Button onClick={usePhoto}>Use Photo</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={takePhoto}>Capture</Button>
          </>
        )
      }
    >
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : captured ? (
        <img src={captured} alt="" className="w-full rounded-lg" />
      ) : (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video ref={videoRef} playsInline muted className="w-full rounded-lg bg-black" />
      )}
    </Modal>
  )
}
