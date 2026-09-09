export type SpeedLimitValue = number | 'national'

const LIMITS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120]

export interface SpeedLimitDetection {
  value: SpeedLimitValue
  /** Normalized bbox center x in image [0,1]. */
  imageX: number
  imageY: number
  /** Normalized bbox height (proxy for distance). */
  imageH: number
  imageW: number
  /** Normalized bbox for PiP lock overlay. */
  box: { x: number; y: number; width: number; height: number }
  /** -1 left side of frame, +1 right. */
  side: -1 | 1
  locked: boolean
}

/**
 * Lightweight speed-limit reader: circular EU numeric, US white rects,
 * and UK national speed limit (white disc + black diagonal bar).
 * HUD value persists until a different sign is confirmed.
 */
export class SpeedLimitDetector {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private readonly w = 320
  private readonly h = 180
  private templates: Map<string, Float32Array> | null = null
  /** Last confirmed limit for the HUD — never cleared on miss. */
  private hudValue: SpeedLimitValue | null = null
  private value: SpeedLimitValue | null = null
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

  /** Persisted HUD reading (numeric or national). */
  getHudValue(): SpeedLimitValue | null {
    return this.hudValue
  }

  /** Stable reading with image position for 3D / overlay, or null if unlocked. */
  detect(video: HTMLVideoElement): SpeedLimitDetection | null {
    if (video.readyState < 2 || video.videoWidth === 0) {
      return this.hits >= 2 ? this.lastDet : null
    }

    if (!this.templates) this.templates = buildDigitTemplates()

    this.ctx.drawImage(video, 0, 0, this.w, this.h)
    const { data } = this.ctx.getImageData(0, 0, this.w, this.h)

    // 1) Numeric EU/UK red-ring signs first (never let NSL false-positives win)
    let bestNumeric: { value: number; score: number; box: Box } | null = null
    const candidates = [
      ...findRedCircles(data, this.w, this.h),
      ...findWhiteRects(data, this.w, this.h),
    ]
    for (const c of candidates) {
      const reading = readDigitsInBox(this.ctx, c, this.templates)
      if (reading == null) continue
      if (!LIMITS.includes(reading.value)) continue
      if (reading.score > (bestNumeric?.score ?? 0)) {
        bestNumeric = { value: reading.value, score: reading.score, box: c }
      }
    }

    let best: { value: SpeedLimitValue; score: number; box: Box } | null = null
    if (bestNumeric != null && bestNumeric.score >= 0.32) {
      best = bestNumeric
    } else {
      // 2) UK national (derestriction) only when no credible numeric sign
      const national = findNationalLimitSigns(data, this.w, this.h)
      for (const c of national) {
        if (c.score > (best?.score ?? 0) && c.score >= 0.62) {
          best = { value: 'national', score: c.score, box: c.box }
        }
      }
    }

    if (best != null && best.score > 0.32) {
      const box = {
        x: best.box.x / this.w,
        y: best.box.y / this.h,
        width: best.box.w / this.w,
        height: best.box.h / this.h,
      }
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      const det: SpeedLimitDetection = {
        value: best.value,
        imageX: cx,
        imageY: cy,
        imageH: box.height,
        imageW: box.width,
        box,
        side: cx < 0.5 ? -1 : 1,
        locked: false,
      }
      if (best.value === this.value && this.lastDet) {
        this.hits = Math.min(16, this.hits + 1)
        this.lastDet = {
          ...det,
          imageX: this.lastDet.imageX * 0.65 + det.imageX * 0.35,
          imageY: this.lastDet.imageY * 0.65 + det.imageY * 0.35,
          imageH: this.lastDet.imageH * 0.65 + det.imageH * 0.35,
          imageW: this.lastDet.imageW * 0.65 + det.imageW * 0.35,
          box: {
            x: this.lastDet.box.x * 0.65 + det.box.x * 0.35,
            y: this.lastDet.box.y * 0.65 + det.box.y * 0.35,
            width: this.lastDet.box.width * 0.65 + det.box.width * 0.35,
            height: this.lastDet.box.height * 0.65 + det.box.height * 0.35,
          },
          side: det.imageX < 0.48 ? -1 : det.imageX > 0.52 ? 1 : this.lastDet.side,
          locked: this.hits >= 2,
        }
      } else {
        this.hits = 1
        this.value = best.value
        this.lastDet = det
      }
      if (this.hits >= 2) {
        this.hudValue = best.value
        this.value = best.value
      }
      this.miss = 0
    } else {
      this.miss++
      if (this.miss > 40) {
        this.lastDet = null
        this.hits = 0
        this.value = null
        // hudValue intentionally kept
      } else if (this.lastDet && this.hits >= 2) {
        this.lastDet = { ...this.lastDet, locked: true }
      }
    }

    if (this.hits >= 2 && this.lastDet) {
      return { ...this.lastDet, locked: true }
    }
    return this.hits >= 1 && this.lastDet ? this.lastDet : null
  }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** UK national speed limit: white disc + black diagonal bar, little/no red ring. */
function findNationalLimitSigns(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): Array<{ box: Box; score: number }> {
  const heat = new Float32Array(w * h)
  for (let y = 0; y < h * 0.78; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const bright = (r + g + b) / 3
      const sat = Math.max(r, g, b) - Math.min(r, g, b)
      // Bright, low-saturation disc (not a red-ring numeric sign interior only)
      if (bright > 175 && sat < 45) heat[y * w + x] = 1
    }
  }

  const out: Array<{ box: Box; score: number }> = []
  const visited = new Uint8Array(w * h)
  for (let y = 2; y < h * 0.78; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const idx = y * w + x
      if (!heat[idx] || visited[idx]) continue
      const blob = flood(heat, visited, w, h, x, y)
      if (blob.count < 55 || blob.count > 4500) continue
      const bw = blob.maxX - blob.minX
      const bh = blob.maxY - blob.minY
      if (bw < 16 || bh < 16) continue
      const aspect = bw / bh
      if (aspect < 0.75 || aspect > 1.35) continue

      // Reject strong red rings (those are numeric limits)
      let redRing = 0
      let ringN = 0
      const cx = (blob.minX + blob.maxX) / 2
      const cy = (blob.minY + blob.maxY) / 2
      const rad = Math.max(bw, bh) / 2
      for (let a = 0; a < 32; a++) {
        const ang = (a / 32) * Math.PI * 2
        for (const t of [0.88, 0.96]) {
          const px = Math.round(cx + Math.cos(ang) * rad * t)
          const py = Math.round(cy + Math.sin(ang) * rad * t)
          if (px < 0 || py < 0 || px >= w || py >= h) continue
          const i = (py * w + px) * 4
          ringN++
          if (data[i] > 140 && data[i] > data[i + 1] + 35 && data[i] > data[i + 2] + 35) {
            redRing++
          }
        }
      }
      if (ringN && redRing / ringN > 0.12) continue

      const slash = scoreDiagonalSlash(data, w, blob.minX, blob.minY, bw, bh)
      if (slash < 0.58) continue
      out.push({
        box: { x: blob.minX, y: blob.minY, w: bw, h: bh },
        score: 0.5 + slash * 0.45,
      })
    }
  }
  return out.slice(0, 4)
}

/** Score black diagonal bar across a white disc (both / and \). */
function scoreDiagonalSlash(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  bw: number,
  bh: number,
): number {
  const samples = 18
  let darkA = 0
  let darkB = 0
  let brightOff = 0
  let n = 0
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples
    // Main UK orientation: top-left → bottom-right
    const ax = Math.round(x0 + bw * 0.18 + bw * 0.64 * t)
    const ay = Math.round(y0 + bh * 0.18 + bh * 0.64 * t)
    // Alternate: top-right → bottom-left
    const bx = Math.round(x0 + bw * 0.82 - bw * 0.64 * t)
    const by = Math.round(y0 + bh * 0.18 + bh * 0.64 * t)
    // Off-diagonal control points (should stay bright)
    const ox = Math.round(x0 + bw * 0.5 + (i % 2 === 0 ? -1 : 1) * bw * 0.22)
    const oy = Math.round(y0 + bh * (0.25 + t * 0.5))

    const da = inkAt(data, w, ax, ay)
    const db = inkAt(data, w, bx, by)
    const off = inkAt(data, w, ox, oy)
    if (da < 110) darkA++
    if (db < 110) darkB++
    if (off > 160) brightOff++
    n++
  }
  const slash = Math.max(darkA, darkB) / n
  const field = brightOff / n
  return slash * 0.7 + field * 0.3
}

function inkAt(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4
  if (i < 0 || i + 2 >= data.length) return 255
  return (data[i] + data[i + 1] + data[i + 2]) / 3
}

function findRedCircles(data: Uint8ClampedArray, w: number, h: number): Box[] {
  const heat = new Float32Array(w * h)
  for (let y = 0; y < h * 0.82; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      // UK red rings: allow slightly washed / orange daylight
      const redish =
        (r > 125 && r > g + 28 && r > b + 28) ||
        (r > 145 && r >= g && r > b + 20 && g < 120)
      if (redish) heat[y * w + x] = 1
    }
  }

  const boxes: Box[] = []
  const visited = new Uint8Array(w * h)
  for (let y = 2; y < h * 0.82; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const idx = y * w + x
      if (!heat[idx] || visited[idx]) continue
      const blob = flood(heat, visited, w, h, x, y)
      if (blob.count < 28 || blob.count > 5000) continue
      const bw = blob.maxX - blob.minX
      const bh = blob.maxY - blob.minY
      if (bw < 10 || bh < 10) continue
      if (bw > w * 0.4 || bh > h * 0.45) continue
      const aspect = bw / bh
      if (aspect < 0.65 || aspect > 1.45) continue
      // Expand a bit so digit interior is inside the crop
      const pad = Math.max(2, Math.round(Math.min(bw, bh) * 0.08))
      boxes.push({
        x: Math.max(0, blob.minX - pad),
        y: Math.max(0, blob.minY - pad),
        w: Math.min(w - 1, bw + pad * 2),
        h: Math.min(h - 1, bh + pad * 2),
      })
    }
  }
  return dedupeBoxes(boxes).slice(0, 8)
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
  const padX = Math.floor(box.w * 0.14)
  const padY = Math.floor(box.h * 0.14)
  const sx = box.x + padX
  const sy = box.y + padY
  const sw = Math.max(8, box.w - padX * 2)
  const sh = Math.max(8, box.h - padY * 2)

  const regions = [
    { x: sx, y: sy, w: sw, h: sh },
    { x: sx, y: sy + Math.floor(sh * 0.28), w: sw, h: Math.floor(sh * 0.65) },
    { x: sx + Math.floor(sw * 0.08), y: sy + Math.floor(sh * 0.15), w: Math.floor(sw * 0.84), h: Math.floor(sh * 0.7) },
  ]

  let best: { value: number; score: number } | null = null
  for (const r of regions) {
    if (r.w < 6 || r.h < 6) continue
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
    if (!match || match.score < 0.28) return null
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
