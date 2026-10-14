// Browser-side OCR for the POS report screenshot ("匯入 by 圖檔"). The picture
// never leaves the computer: tesseract.js runs in the browser (it downloads its
// own code and the English language data once, then keeps them cached).
//
// Reading the raw screenshot is unreliable (the table's grid lines swallow
// labels, $ and digits get mangled), so before OCR the picture is
//   1. scaled up 4x (smoothed),
//   2. turned into black text on white,
//   3. stripped of every long horizontal / vertical line (the table borders).
// That alone took the test reports from "labels missing" to "all labels read".

const SCALE = 4
const MAX_SIDE = 5200 // keep the canvas (and memory) sane for big screenshots
const DARK = 140 // gray level below which a pixel counts as ink
const MIN_LINE = 25 // px (at 1x) a dark run must reach to count as a table line

// RGBA ImageData-like object -> same object, black ink on white, long lines removed.
// `scale` = how much the picture was enlarged (line length is measured at 1x).
export function binarizeAndStripLines(img, scale = SCALE) {
  const { data, width: w, height: h } = img
  const ink = new Uint8Array(w * h)
  for (let i = 0, p = 0; p < ink.length; i += 4, p++) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    ink[p] = gray < DARK ? 1 : 0
  }
  const minRun = Math.round(MIN_LINE * scale)
  const strip = (len, lines, at) => {
    // `at(line, k)` -> index of the k-th pixel of that line
    for (let l = 0; l < lines; l++) {
      let start = -1
      for (let k = 0; k <= len; k++) {
        const on = k < len && ink[at(l, k)] === 1
        if (on && start < 0) start = k
        if (!on && start >= 0) {
          if (k - start >= minRun) for (let j = start; j < k; j++) ink[at(l, j)] = 2 // mark, remove after both passes
          start = -1
        }
      }
    }
  }
  strip(w, h, (y, x) => y * w + x) // horizontal runs
  strip(h, w, (x, y) => y * w + x) // vertical runs
  for (let i = 0, p = 0; p < ink.length; i += 4, p++) {
    const v = ink[p] === 1 ? 0 : 255
    data[i] = data[i + 1] = data[i + 2] = v
    data[i + 3] = 255
  }
  return img
}

async function toPreparedCanvas(file) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(SCALE, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  binarizeAndStripLines(img, scale)
  ctx.putImageData(img, 0, 0)
  return canvas
}

// file (image Blob) -> the recognised text. onProgress(0..1) is called while reading.
export async function ocrReportImage(file, onProgress) {
  const canvas = await toPreparedCanvas(file)
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') onProgress?.(m.progress)
    },
  })
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' }) // one uniform block of text
    const { data } = await worker.recognize(canvas)
    return data.text
  } finally {
    await worker.terminate()
  }
}
