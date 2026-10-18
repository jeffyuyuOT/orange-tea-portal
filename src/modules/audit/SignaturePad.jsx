import { useEffect, useRef } from 'react'

const W = 640
const H = 200

// Finger / mouse / stylus signature box. Emits a PNG data URL on every
// stroke end (null once cleared). `value` is only used to redraw a saved
// signature on mount (e.g. resuming a draft) — the canvas itself is the
// source of truth while it's on screen.
export default function SignaturePad({ value, onChange, disabled = false }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)

  function ctx2d() {
    return canvasRef.current.getContext('2d')
  }

  function blank() {
    const ctx = ctx2d()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
  }

  useEffect(() => {
    blank()
    if (value) {
      const img = new Image()
      img.onload = () => ctx2d().drawImage(img, 0, 0, W, H)
      img.src = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pos(e) {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height }
  }

  function style(ctx) {
    ctx.strokeStyle = '#111827'
    ctx.fillStyle = '#111827'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  function down(e) {
    if (disabled) return
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    drawing.current = true
    const p = pos(e)
    last.current = p
    const ctx = ctx2d()
    style(ctx)
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.25, 0, Math.PI * 2)
    ctx.fill()
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const p = pos(e)
    const ctx = ctx2d()
    style(ctx)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }

  function up() {
    if (!drawing.current) return
    drawing.current = false
    onChange?.(canvasRef.current.toDataURL('image/png'))
  }

  function clear() {
    blank()
    onChange?.(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ aspectRatio: `${W} / ${H}` }}
        className="w-full max-w-md touch-none rounded-lg border border-brand-200 bg-white"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="mt-1 flex max-w-md items-center justify-between text-xs text-gray-400">
        <span>Sign inside the box above</span>
        <button type="button" onClick={clear} className="font-medium text-brand-600 hover:text-brand-800">
          Clear
        </button>
      </div>
    </div>
  )
}
