import { forwardRef } from 'react'

// A bar chart of 營業額 per hour, drawn as a plain SVG with literal colours so it
// can be turned into a PNG (copy / download for sending to a manager) exactly as
// it looks here. One series, so no legend: the title says what it is.
const W = 720
const H = 360
const M = { l: 60, r: 20, t: 78, b: 46 }
const INK = '#1f2937'
const MUTED = '#6b7280'
const GRID = '#e5e7eb'
const BAR = '#f97316'
const FONT = "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif"

const money0 = (n) => Math.round(n).toLocaleString('en-AU')

// Axis steps of 1 / 2 / 5 × 10^n, at most 5 intervals up to the data maximum.
function niceAxis(max) {
  if (!(max > 0)) return { top: 4, step: 1, n: 4 }
  const raw = max / 5
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].find((m) => m * pow >= raw) * pow
  const n = Math.ceil(max / step - 1e-9)
  return { top: step * n, step, n }
}

const HourChart = forwardRef(function HourChart({ title, subtitle, hours, values }, ref) {
  const total = hours.reduce((s, h) => s + (values[h] ?? 0), 0)
  const max = Math.max(0, ...hours.map((h) => values[h] ?? 0))
  const { top, step, n } = niceAxis(max)
  const plotW = W - M.l - M.r
  const plotH = H - M.t - M.b
  const slot = hours.length ? plotW / hours.length : plotW
  const barW = Math.min(44, slot * 0.62)
  const y = (v) => M.t + plotH - (v / top) * plotH
  const peak = max > 0 ? hours.find((h) => (values[h] ?? 0) === max) : null

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={`${title} 每小時營業額`}
      fontFamily={FONT}
      style={{ display: 'block', background: '#ffffff' }}
    >
      <rect width={W} height={H} fill="#ffffff" />
      <text x={M.l} y={28} fontSize="16" fontWeight="600" fill={INK}>
        {title}
      </text>
      {subtitle && (
        <text x={M.l} y={48} fontSize="12" fill={MUTED}>
          {subtitle}
        </text>
      )}
      <text x={W - M.r} y={28} fontSize="16" fontWeight="600" fill={INK} textAnchor="end">
        合計 ${money0(total)}
      </text>
      {peak !== null && (
        <text x={W - M.r} y={48} fontSize="12" fill={MUTED} textAnchor="end">
          最高 {peak}:00（${money0(max)}）
        </text>
      )}

      {Array.from({ length: n + 1 }, (_, i) => i).map((i) => {
        const v = step * i
        return (
          <g key={i}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={i === 0 ? 1.5 : 1} />
            <text x={M.l - 8} y={y(v) + 4} fontSize="11" fill={MUTED} textAnchor="end">
              {money0(v)}
            </text>
          </g>
        )
      })}

      {hours.map((h, i) => {
        const v = values[h] ?? 0
        const cx = M.l + slot * i + slot / 2
        const bh = (v / top) * plotH
        return (
          <g key={h}>
            {v > 0 && (
              <>
                <path
                  d={`M${cx - barW / 2},${M.t + plotH} V${y(v) + Math.min(4, bh)} Q${cx - barW / 2},${y(v)} ${cx - barW / 2 + Math.min(4, barW / 2)},${y(v)} H${cx + barW / 2 - Math.min(4, barW / 2)} Q${cx + barW / 2},${y(v)} ${cx + barW / 2},${y(v) + Math.min(4, bh)} V${M.t + plotH} Z`}
                  fill={BAR}
                />
                <text x={cx} y={y(v) - 6} fontSize="11" fontWeight="600" fill={INK} textAnchor="middle">
                  {money0(v)}
                </text>
              </>
            )}
            <text x={cx} y={H - M.b + 18} fontSize="11" fill={MUTED} textAnchor="middle">
              {h}:00
            </text>
          </g>
        )
      })}
    </svg>
  )
})

export default HourChart

// SVG element -> PNG Blob (2× for a sharp image when pasted).
export async function svgToPng(svg, scale = 2) {
  const xml = new XMLSerializer().serializeToString(svg)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('無法產生圖片'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = W * scale
    canvas.height = H * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('無法產生圖片'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}
