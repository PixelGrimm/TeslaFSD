const LIMITS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120]

export interface SpeedLimitDetection {
  value: number
  /** Normalized bbox center x in image [0,1]. */
  imageX: number
  /** Normalized bbox height (proxy for distance). */
  imageH: number
  /** -1 left side of frame, +1 right. */
  side: -1 | 1
}

/**
 * Lightweight speed-limit reader: finds circular (EU) or rectangular (US)
 * sign-like blobs, then template-matches interior digits.
 */
export class SpeedLimitDetector {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private readonly w = 320
  private readonly h = 180
  private templates: Map<string, Float32Array> | null = null
  private value: number | null = null
  private lastDet: SpeedLimitDetection | null = null
  private hits = 0
  private miss = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.w
    this.canvas.height = this.h
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D context unavailable')
    this.ctx = ctx
  }

  /** Stable reading with image position, or null. */
  detect(video: HTMLVideoElement): SpeedLimitDetection | null {
    if (video.readyState < 2 || video.videoWidth === 0) {
      return this.hits >= 2 ? this.lastDet : null
    }

    if (!this.templates) this.templates = buildDigitTemplates()

    this.ctx.drawImage(video, 0, 0, this.w, this.h)
    const { data } = this.ctx.getImageData(0, 0, this.w, this.h)

    const candidates = [
      ...findRedCircles(data, this.w, this.h),
      ...findWhiteRects(data, this.w, this.h),
    ]
    let best: { value: number; score: number; box: Box } | null = null

    for (const c of candidates) {
      const reading = readDigitsInBox(this.ctx, c, this.templates)
      if (reading == null) continue
      if (LIMITS.includes(reading.value) && reading.score > (best?.score ?? 0)) {
        best = { value: reading.value, score: reading.score, box: c }
      }
    }

    if (best != null && best.score > 0.42) {
      const cx = (best.box.x + best.box.w / 2) / this.w
      const det: SpeedLimitDetection = {
        value: best.value,
        imageX: cx,
        imageH: best.box.h / this.h,
        side: cx < 0.5 ? -1 : 1,
      }
      if (best.value === this.value && this.lastDet) {
        this.hits = Math.min(12, this.hits + 1)
        // Smooth image position
        this.lastDet = {
          ...det,
          imageX: this.lastDet.imageX * 0.7 + det.imageX * 0.3,
          imageH: this.lastDet.imageH * 0.7 + det.imageH * 0.3,
          side: det.imageX < 0.48 ? -1 : det.imageX > 0.52 ? 1 : this.lastDet.side,
        }
      } else {
        this.hits = 1
        this.value = best.value
        this.lastDet = det
      }
      this.miss = 0
    } else {
      this.miss++
      if (this.miss > 18) {
        this.value = null
        this.lastDet = null
        this.hits = 0
      }
    }

    return this.hits >= 2 ? this.lastDet : null
  }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function findRedCircles(data: Uint8ClampedArray, w: number, h: number): Box[] {
  const heat = new Float32Array(w * h)
  for (let y = 0; y < h * 0.75; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (r > 140 && r > g + 40 && r > b + 40) heat[y * w + x] = 1
    }
  }

  const boxes: Box[] = []
  const visited = new Uint8Array(w * h)
  for (let y = 2; y < h * 0.75; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const idx = y * w + x
      if (!heat[idx] || visited[idx]) continue
      const blob = flood(heat, visited, w, h, x, y)
      if (blob.count < 40 || blob.count > 4000) continue
      const bw = blob.maxX - blob.minX
      const bh = blob.maxY - blob.minY
      if (bw < 14 || bh < 14) continue
      const aspect = bw / bh
      if (aspect < 0.7 || aspect > 1.35) continue
      boxes.push({
        x: blob.minX,
        y: blob.minY,
        w: bw,
        h: bh,
      })
    }
  }
  return boxes.slice(0, 6)
}

function findWhiteRects(data: Uint8ClampedArray, w: number, h: number): Box[] {
  const boxes: Box[] = []
  const step = 4
  for (let y = 4; y < h * 0.65; y += step) {
    for (let x = 4; x < w - 4; x += step) {
      const i = (y * w + x) * 4
      const bright = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (bright < 190) continue
      let x1 = x
      let x2 = x
      let y1 = y
      let y2 = y
      while (x2 < w - 2 && avgBright(data, w, x2 + 1, y) > 185) x2++
      while (x1 > 2 && avgBright(data, w, x1 - 1, y) > 185) x1--
      while (y2 < h * 0.7 && rowWhiteRatio(data, w, x1, x2, y2 + 1) > 0.6) y2++
      while (y1 > 2 && rowWhiteRatio(data, w, x1, x2, y1 - 1) > 0.6) y1--
      const bw = x2 - x1
      const bh = y2 - y1
      if (bw < 20 || bh < 24) continue
      if (bw > w * 0.45 || bh > h * 0.5) continue
      const aspect = bw / bh
      if (aspect < 0.45 || aspect > 1.1) continue
      boxes.push({ x: x1, y: y1, w: bw, h: bh })
      x = x2
    }
  }
  return dedupeBoxes(boxes).slice(0, 5)
}

function avgBright(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4
  return (data[i] + data[i + 1] + data[i + 2]) / 3
}

function rowWhiteRatio(data: Uint8ClampedArray, w: number, x1: number, x2: number, y: number) {
  let n = 0
  let hit = 0
  for (let x = x1; x <= x2; x += 2) {
    n++
    if (avgBright(data, w, x, y) > 185) hit++
  }
  return n ? hit / n : 0
}

function flood(
  heat: Float32Array,
  visited: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
) {
  const stack = [[sx, sy]]
  let minX = sx
  let maxX = sx
  let minY = sy
  let maxY = sy
  let count = 0
  while (stack.length) {
    const [x, y] = stack.pop()!
    const idx = y * w + x
    if (x < 0 || y < 0 || x >= w || y >= h || visited[idx] || !heat[idx]) continue
    visited[idx] = 1
    count++
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }
  return { minX, maxX, minY, maxY, count }
}

function dedupeBoxes(boxes: Box[]): Box[] {
  const out: Box[] = []
  for (const b of boxes) {
    if (out.some((o) => overlap(o, b) > 0.5)) continue
    out.push(b)
  }
  return out
}

function overlap(a: Box, b: Box) {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

function buildDigitTemplates(): Map<string, Float32Array> {
  const map = new Map<string, Float32Array>()
  const size = 32
  for (const d of '0123456789') {
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#000'
    ctx.font = `bold ${Math.floor(size * 0.85)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(d, size / 2, size / 2 + 1)
    const img = ctx.getImageData(0, 0, size, size)
    map.set(d, toInkVector(img))
  }
  return map
}

function toInkVector(img: ImageData): Float32Array {
  const v = new Float32Array(img.width * img.height)
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    const bright = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3
    v[j] = bright < 140 ? 1 : 0
  }
  return v
}

function readDigitsInBox(
  ctx: CanvasRenderingContext2D,
  box: Box,
  templates: Map<string, Float32Array>,
): { value: number; score: number } | null {
  const padX = Math.floor(box.w * 0.18)
  const padY = Math.floor(box.h * 0.18)
  const sx = box.x + padX
  const sy = box.y + padY
  const sw = Math.max(8, box.w - padX * 2)
  const sh = Math.max(8, box.h - padY * 2)

  const regions = [
    { x: sx, y: sy, w: sw, h: sh },
    { x: sx, y: sy + Math.floor(sh * 0.35), w: sw, h: Math.floor(sh * 0.6) },
  ]

  let best: { value: number; score: number } | null = null
  for (const r of regions) {
    const img = ctx.getImageData(r.x, r.y, r.w, r.h)
    const digits = splitAndMatch(img, templates)
    if (!digits) continue
    if (!best || digits.score > best.score) best = digits
  }
  return best
}

function splitAndMatch(
  img: ImageData,
  templates: Map<string, Float32Array>,
): { value: number; score: number } | null {
  const { width: w, height: h, data } = img
  const ink = new Uint8Array(w * h)
  let inkCount = 0
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const bright = (data[i] + data[i + 1] + data[i + 2]) / 3
    if (bright < 130) {
      ink[j] = 1
      inkCount++
    }
  }
  if (inkCount < 20) return null

  const col = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[x] += ink[y * w + x]
  }
  const segments: { x0: number; x1: number }[] = []
  let inside = false
  let start = 0
  const thresh = h * 0.08
  for (let x = 0; x < w; x++) {
    if (!inside && col[x] > thresh) {
      inside = true
      start = x
    } else if (inside && col[x] <= thresh) {
      inside = false
      if (x - start >= 3) segments.push({ x0: start, x1: x })
    }
  }
  if (inside && w - start >= 3) segments.push({ x0: start, x1: w })
  if (segments.length < 1 || segments.length > 3) return null

  let text = ''
  let scoreSum = 0
  for (const seg of segments) {
    const digitImg = cropInk(ink, w, h, seg.x0, seg.x1)
    const match = matchDigit(digitImg, templates)
    if (!match || match.score < 0.35) return null
    text += match.digit
    scoreSum += match.score
  }
  const value = Number(text)
  if (!Number.isFinite(value)) return null
  return { value, score: scoreSum / segments.length }
}

function cropInk(ink: Uint8Array, w: number, h: number, x0: number, x1: number): ImageData {
  const cw = x1 - x0
  const out = new ImageData(cw, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < cw; x++) {
      const on = ink[y * w + (x0 + x)]
      const i = (y * cw + x) * 4
      const v = on ? 0 : 255
      out.data[i] = v
      out.data[i + 1] = v
      out.data[i + 2] = v
      out.data[i + 3] = 255
    }
  }
  return out
}

function matchDigit(
  img: ImageData,
  templates: Map<string, Float32Array>,
): { digit: string; score: number } | null {
  const size = 32
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, size, size)
  const tmp = document.createElement('canvas')
  tmp.width = img.width
  tmp.height = img.height
  tmp.getContext('2d')!.putImageData(img, 0, 0)
  ctx.drawImage(tmp, 2, 2, size - 4, size - 4)
  const vec = toInkVector(ctx.getImageData(0, 0, size, size))

  let bestD = ''
  let bestS = -1
  for (const [d, t] of templates) {
    let dot = 0
    let a2 = 0
    let b2 = 0
    for (let i = 0; i < vec.length; i++) {
      dot += vec[i] * t[i]
      a2 += vec[i] * vec[i]
      b2 += t[i] * t[i]
    }
    const score = a2 > 0 && b2 > 0 ? dot / Math.sqrt(a2 * b2) : 0
    if (score > bestS) {
      bestS = score
      bestD = d
    }
  }
  return bestD ? { digit: bestD, score: bestS } : null
}
