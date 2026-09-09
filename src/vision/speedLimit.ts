export type SpeedLimitValue = number | 'national'

const LIMITS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120]
/** Most common UK urban limits — matched as whole-sign templates. */
const UK_COMMON = [20, 30, 40, 50, 60, 70]

export interface SpeedLimitDetection {
  value: SpeedLimitValue
  imageX: number
  imageY: number
  imageH: number
  imageW: number
  box: { x: number; y: number; width: number; height: number }
  side: -1 | 1
  locked: boolean
}

/**
 * EU/UK circular speed-limit reader.
 * Numeric red-ring signs are preferred; national (slash) is fallback only.
 */
export class SpeedLimitDetector {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private readonly w = 480
  private readonly h = 270
  private digitTemplates: Map<string, Float32Array> | null = null
  private wholeTemplates: Map<number, Float32Array> | null = null
  private hudValue: SpeedLimitValue | null = null
  private value: SpeedLimitValue | null = null
  private lastDet: SpeedLimitDetection | null = null
  private hits = 0
  private miss = 0
  private pendingValue: SpeedLimitValue | null = null
  private pendingHits = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.w
    this.canvas.height = this.h
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D context unavailable')
    this.ctx = ctx
  }

  getHudValue(): SpeedLimitValue | null {
    return this.hudValue
  }

  detect(video: HTMLVideoElement): SpeedLimitDetection | null {
    if (video.readyState < 2 || video.videoWidth === 0) {
      return this.hits >= 2 ? this.lastDet : null
    }

    if (!this.digitTemplates) this.digitTemplates = buildDigitTemplates()
    if (!this.wholeTemplates) this.wholeTemplates = buildWholeSignTemplates()

    this.ctx.drawImage(video, 0, 0, this.w, this.h)
    const { data } = this.ctx.getImageData(0, 0, this.w, this.h)

    let bestNumeric: { value: number; score: number; box: Box } | null = null
    const candidates = findRedCircles(data, this.w, this.h)

    for (const c of candidates) {
      // Whole-sign template first (more reliable for 20/30/40)
      const whole = matchWholeSign(this.ctx, c, this.wholeTemplates)
      if (whole && whole.score > (bestNumeric?.score ?? 0)) {
        bestNumeric = { value: whole.value, score: whole.score, box: c }
      }
      const reading = readDigitsInBox(this.ctx, c, this.digitTemplates)
      if (reading && LIMITS.includes(reading.value) && reading.score > (bestNumeric?.score ?? 0)) {
        bestNumeric = { value: reading.value, score: reading.score, box: c }
      }
    }

    let best: { value: SpeedLimitValue; score: number; box: Box } | null = null
    if (bestNumeric != null && bestNumeric.score >= 0.28) {
      best = bestNumeric
    } else {
      const national = findNationalLimitSigns(data, this.w, this.h)
      for (const c of national) {
        if (c.score >= 0.7 && c.score > (best?.score ?? 0)) {
          best = { value: 'national', score: c.score, box: c.box }
        }
      }
    }

    if (best != null) {
      if (best.value === this.pendingValue) this.pendingHits++
      else {
        this.pendingValue = best.value
        this.pendingHits = 1
      }

      // Need 2 agreeing frames before accepting a new reading
      if (this.pendingHits >= 2 || (best.value === this.value && this.hits >= 1)) {
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
          locked: true,
        }

        if (best.value === this.value && this.lastDet) {
          this.hits = Math.min(20, this.hits + 1)
          this.lastDet = {
            ...det,
            imageX: this.lastDet.imageX * 0.6 + det.imageX * 0.4,
            imageY: this.lastDet.imageY * 0.6 + det.imageY * 0.4,
            imageH: this.lastDet.imageH * 0.6 + det.imageH * 0.4,
            imageW: this.lastDet.imageW * 0.6 + det.imageW * 0.4,
            box: {
              x: this.lastDet.box.x * 0.6 + det.box.x * 0.4,
              y: this.lastDet.box.y * 0.6 + det.box.y * 0.4,
              width: this.lastDet.box.width * 0.6 + det.box.width * 0.4,
              height: this.lastDet.box.height * 0.6 + det.box.height * 0.4,
            },
            side: det.side,
            locked: true,
          }
        } else {
          this.hits = 2
          this.value = best.value
          this.lastDet = det
        }
        this.hudValue = best.value
        this.miss = 0
      }
    } else {
      this.pendingHits = Math.max(0, this.pendingHits - 1)
      if (this.pendingHits === 0) this.pendingValue = null
      this.miss++
      if (this.miss > 50) {
        this.lastDet = null
        this.hits = 0
        this.value = null
      } else if (this.lastDet && this.hits >= 2) {
        this.lastDet = { ...this.lastDet, locked: true }
      }
    }

    if (this.hits >= 2 && this.lastDet) return { ...this.lastDet, locked: true }
    return null
  }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

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
      if (bright > 180 && sat < 40) heat[y * w + x] = 1
    }
  }

  const out: Array<{ box: Box; score: number }> = []
  const visited = new Uint8Array(w * h)
  for (let y = 2; y < h * 0.78; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const idx = y * w + x
      if (!heat[idx] || visited[idx]) continue
      const blob = flood(heat, visited, w, h, x, y)
      if (blob.count < 80 || blob.count > 6000) continue
      const bw = blob.maxX - blob.minX
      const bh = blob.maxY - blob.minY
      if (bw < 18 || bh < 18) continue
      const aspect = bw / bh
      if (aspect < 0.75 || aspect > 1.3) continue

      let redRing = 0
      let ringN = 0
      const cx = (blob.minX + blob.maxX) / 2
      const cy = (blob.minY + blob.maxY) / 2
      const rad = Math.max(bw, bh) / 2
      for (let a = 0; a < 36; a++) {
        const ang = (a / 36) * Math.PI * 2
        for (const t of [0.9, 0.97]) {
          const px = Math.round(cx + Math.cos(ang) * rad * t)
          const py = Math.round(cy + Math.sin(ang) * rad * t)
          if (px < 0 || py < 0 || px >= w || py >= h) continue
          const i = (py * w + px) * 4
          ringN++
          if (data[i] > 130 && data[i] > data[i + 1] + 30 && data[i] > data[i + 2] + 30) redRing++
        }
      }
      if (ringN && redRing / ringN > 0.1) continue

      const slash = scoreDiagonalSlash(data, w, blob.minX, blob.minY, bw, bh)
      if (slash < 0.62) continue
      out.push({
        box: { x: blob.minX, y: blob.minY, w: bw, h: bh },
        score: 0.55 + slash * 0.4,
      })
    }
  }
  return out.slice(0, 3)
}

function scoreDiagonalSlash(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  bw: number,
  bh: number,
): number {
  const samples = 20
  let darkA = 0
  let darkB = 0
  let brightOff = 0
  let n = 0
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples
    const ax = Math.round(x0 + bw * 0.18 + bw * 0.64 * t)
    const ay = Math.round(y0 + bh * 0.18 + bh * 0.64 * t)
    const bx = Math.round(x0 + bw * 0.82 - bw * 0.64 * t)
    const by = Math.round(y0 + bh * 0.18 + bh * 0.64 * t)
    const ox = Math.round(x0 + bw * 0.5 + (i % 2 === 0 ? -1 : 1) * bw * 0.25)
    const oy = Math.round(y0 + bh * (0.28 + t * 0.45))
    if (inkAt(data, w, ax, ay) < 100) darkA++
    if (inkAt(data, w, bx, by) < 100) darkB++
    if (inkAt(data, w, ox, oy) > 165) brightOff++
    n++
  }
  return (Math.max(darkA, darkB) / n) * 0.75 + (brightOff / n) * 0.25
}

function inkAt(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4
  if (i < 0 || i + 2 >= data.length) return 255
  return (data[i] + data[i + 1] + data[i + 2]) / 3
}

function findRedCircles(data: Uint8ClampedArray, w: number, h: number): Box[] {
  const heat = new Float32Array(w * h)
  for (let y = 0; y < h * 0.85; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const redish =
        (r > 110 && r > g + 22 && r > b + 22) ||
        (r > 135 && r >= g - 5 && r > b + 15 && g < 140)
      if (redish) heat[y * w + x] = 1
    }
  }

  const boxes: Box[] = []
  const visited = new Uint8Array(w * h)
  for (let y = 2; y < h * 0.85; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const idx = y * w + x
      if (!heat[idx] || visited[idx]) continue
      const blob = flood(heat, visited, w, h, x, y)
      if (blob.count < 22 || blob.count > 9000) continue
      const bw = blob.maxX - blob.minX
      const bh = blob.maxY - blob.minY
      if (bw < 12 || bh < 12) continue
      if (bw > w * 0.42 || bh > h * 0.5) continue
      const aspect = bw / bh
      if (aspect < 0.6 || aspect > 1.5) continue

      // Prefer roadside (left/right thirds) — boost later via order
      const pad = Math.max(2, Math.round(Math.min(bw, bh) * 0.1))
      boxes.push({
        x: Math.max(0, blob.minX - pad),
        y: Math.max(0, blob.minY - pad),
        w: Math.min(w - blob.minX + pad, bw + pad * 2),
        h: Math.min(h - blob.minY + pad, bh + pad * 2),
      })
    }
  }

  // Prefer signs on the sides of the frame (UK roadside)
  boxes.sort((a, b) => {
    const ac = Math.abs(a.x + a.w / 2 - w / 2) / w
    const bc = Math.abs(b.x + b.w / 2 - w / 2) / w
    return bc - ac
  })
  return dedupeBoxes(boxes).slice(0, 10)
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
    if (out.some((o) => overlap(o, b) > 0.45)) continue
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
  const fonts = [
    `bold ${Math.floor(size * 0.88)}px Arial, Helvetica, sans-serif`,
    `900 ${Math.floor(size * 0.9)}px "DM Sans", Arial, sans-serif`,
    `bold ${Math.floor(size * 0.82)}px "Transport", "Highway Gothic", Arial, sans-serif`,
  ]
  for (const d of '0123456789') {
    // Blend multiple font renders into one template
    const acc = new Float32Array(size * size)
    for (const font of fonts) {
      const c = document.createElement('canvas')
      c.width = size
      c.height = size
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#000'
      ctx.font = font
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(d, size / 2, size / 2 + 1)
      const img = ctx.getImageData(0, 0, size, size)
      const v = toInkVector(img)
      for (let i = 0; i < acc.length; i++) acc[i] += v[i]
    }
    for (let i = 0; i < acc.length; i++) acc[i] = acc[i] >= fonts.length * 0.4 ? 1 : 0
    map.set(d, acc)
  }
  return map
}

/** Full-face templates for common UK limits (white disc + red ring + number). */
function buildWholeSignTemplates(): Map<number, Float32Array> {
  const map = new Map<number, Float32Array>()
  const size = 64
  for (const value of UK_COMMON) {
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#e30613'
    ctx.lineWidth = size * 0.12
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - size * 0.07, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#111'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const text = String(value)
    ctx.font = `700 ${text.length > 2 ? size * 0.36 : size * 0.46}px Arial, Helvetica, sans-serif`
    ctx.fillText(text, size / 2, size / 2 + 1)
    map.set(value, toInkVector(ctx.getImageData(0, 0, size, size)))
  }
  return map
}

function toInkVector(img: ImageData): Float32Array {
  const v = new Float32Array(img.width * img.height)
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    const bright = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3
    // Treat red ring as ink too (helps whole-sign match)
    const isRed = img.data[i] > 140 && img.data[i] > img.data[i + 1] + 30
    v[j] = bright < 145 || isRed ? 1 : 0
  }
  return v
}

function matchWholeSign(
  ctx: CanvasRenderingContext2D,
  box: Box,
  templates: Map<number, Float32Array>,
): { value: number; score: number } | null {
  const size = 64
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const cctx = c.getContext('2d')!
  cctx.fillStyle = '#fff'
  cctx.fillRect(0, 0, size, size)
  cctx.drawImage(ctx.canvas, box.x, box.y, box.w, box.h, 2, 2, size - 4, size - 4)
  const vec = toInkVector(cctx.getImageData(0, 0, size, size))

  let bestV = 0
  let bestS = -1
  for (const [value, t] of templates) {
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
      bestV = value
    }
  }
  return bestS >= 0.36 ? { value: bestV, score: bestS } : null
}

function readDigitsInBox(
  ctx: CanvasRenderingContext2D,
  box: Box,
  templates: Map<string, Float32Array>,
): { value: number; score: number } | null {
  const padX = Math.floor(box.w * 0.16)
  const padY = Math.floor(box.h * 0.16)
  const sx = box.x + padX
  const sy = box.y + padY
  const sw = Math.max(8, box.w - padX * 2)
  const sh = Math.max(8, box.h - padY * 2)

  const regions = [
    { x: sx, y: sy, w: sw, h: sh },
    { x: sx, y: sy + Math.floor(sh * 0.22), w: sw, h: Math.floor(sh * 0.7) },
    {
      x: sx + Math.floor(sw * 0.06),
      y: sy + Math.floor(sh * 0.12),
      w: Math.floor(sw * 0.88),
      h: Math.floor(sh * 0.76),
    },
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
  // Adaptive ink threshold
  let sum = 0
  for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
  const mean = sum / (w * h)
  const inkThresh = Math.min(140, mean * 0.72)

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const bright = (data[i] + data[i + 1] + data[i + 2]) / 3
    // Ignore red ring pixels in digit crop
    const isRed = data[i] > 140 && data[i] > data[i + 1] + 35
    if (!isRed && bright < inkThresh) {
      ink[j] = 1
      inkCount++
    }
  }
  if (inkCount < 12) return null

  const col = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[x] += ink[y * w + x]
  }
  const segments: { x0: number; x1: number }[] = []
  let inside = false
  let start = 0
  const thresh = h * 0.06
  for (let x = 0; x < w; x++) {
    if (!inside && col[x] > thresh) {
      inside = true
      start = x
    } else if (inside && col[x] <= thresh) {
      inside = false
      if (x - start >= 2) segments.push({ x0: start, x1: x })
    }
  }
  if (inside && w - start >= 2) segments.push({ x0: start, x1: w })
  if (segments.length < 1 || segments.length > 3) return null

  let text = ''
  let scoreSum = 0
  for (const seg of segments) {
    const digitImg = cropInk(ink, w, h, seg.x0, seg.x1)
    const match = matchDigit(digitImg, templates)
    if (!match || match.score < 0.25) return null
    text += match.digit
    scoreSum += match.score
  }
  const value = Number(text)
  if (!Number.isFinite(value) || !LIMITS.includes(value)) return null
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
