import type { LaneMark, LaneState } from '../world/types'

const EGO_HALF = 1.8
const LANE_W = EGO_HALF * 2

export type OverlayLaneLine = {
  x: number
  color: 'white' | 'yellow'
  style: 'solid' | 'dashed'
}

/**
 * Camera → Tesla-style lane layout.
 * Perspective-aware (works when iPad isn't perfectly parallel to the road)
 * + animated merges when lane count drops.
 */
export class LaneDetector {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private readonly w = 320
  private readonly h = 180

  private sameVotes = [0, 0, 0, 0, 0]
  private oncomingVotes = [0, 0, 0, 0]
  private sameLanes = 2
  private oncomingLanes = 0
  private yellowVotes = 0
  private hasYellow = false
  private egoLaneIndex = 0

  /** Estimated vanishing-point x in normalized coords (handles roll / off-center aim). */
  private vpX = 0.5
  private rollBias = 0 // shifts sample band laterally

  private smoothWhite: number[] = []
  private smoothYellow: number[] = []
  private lastOverlayLines: OverlayLaneLine[] = []
  private readonly bandTop = 0.55
  private readonly bandBottom = 0.94

  private orientHandler: ((e: DeviceOrientationEvent) => void) | null = null

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.w
    this.canvas.height = this.h
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D context unavailable')
    this.ctx = ctx
  }

  startOrientationAssist() {
    if (this.orientHandler) return
    this.orientHandler = (e: DeviceOrientationEvent) => {
      // Landscape iPad: gamma≈roll when mounted facing road
      const g = e.gamma ?? 0
      const b = e.beta ?? 0
      // Soft bias so a slightly cocked tablet still finds paint
      this.rollBias = clamp(g / 45, -0.12, 0.12)
      // Pitch shifts which band is "near road"
      void b
    }
    window.addEventListener('deviceorientation', this.orientHandler)
  }

  stopOrientationAssist() {
    if (!this.orientHandler) return
    window.removeEventListener('deviceorientation', this.orientHandler)
    this.orientHandler = null
  }

  detect(video: HTMLVideoElement): LaneState {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      this.sample(video)
    }
    return buildLayout(
      this.sameLanes,
      this.oncomingLanes,
      this.hasYellow,
      this.egoLaneIndex,
    )
  }

  getOverlayPeaks(): {
    whitePeaks: number[]
    yellowPeaks: number[]
    lines: OverlayLaneLine[]
    bandTop: number
    bandBottom: number
    hasYellow: boolean
    vpX: number
  } {
    return {
      whitePeaks: this.smoothWhite,
      yellowPeaks: this.smoothYellow,
      lines: this.lastOverlayLines,
      bandTop: this.bandTop,
      bandBottom: this.bandBottom,
      hasYellow: this.hasYellow,
      vpX: this.vpX,
    }
  }

  private sample(video: HTMLVideoElement) {
    this.ctx.drawImage(video, 0, 0, this.w, this.h)
    const { data } = this.ctx.getImageData(0, 0, this.w, this.h)

    const y0 = Math.floor(this.h * this.bandTop)
    const y1 = Math.floor(this.h * this.bandBottom)
    const rows = Math.max(1, y1 - y0)

    let meanBright = 0
    for (let y = y0; y < y1; y += 2) {
      for (let x = 0; x < this.w; x += 2) {
        const i = (y * this.w + x) * 4
        meanBright += (data[i] + data[i + 1] + data[i + 2]) / 3
      }
    }
    meanBright /= Math.max(1, (rows / 2) * (this.w / 2))
    const night = meanBright < 95

    // Multi-row peaks → project to bottom reference (perspective / tilt tolerant)
    const rowFracs = [0.62, 0.72, 0.82, 0.9]
    const rowPeaks: { y: number; xs: number[] }[] = []
    const yellowRowPeaks: { y: number; xs: number[] }[] = []

    for (const frac of rowFracs) {
      const y = Math.floor(this.h * frac)
      const { white, yellow } = scoreRow(data, this.w, y, night, this.rollBias)
      rowPeaks.push({
        y,
        xs: findPeaks(white, night ? 8 : 12, 16, 6),
      })
      yellowRowPeaks.push({
        y,
        xs: findPeaks(yellow, night ? 12 : 16, 24, 2),
      })
    }

    // Refine vanishing point from white peak chains
    this.vpX = estimateVanishingX(rowPeaks, this.w, this.h, this.vpX)

    const yRef = Math.floor(this.h * 0.9)
    const vpY = this.h * 0.32
    const whiteProjected = projectPeaksToRow(rowPeaks, this.vpX * this.w, vpY, yRef)
    const yellowProjected = projectPeaksToRow(
      yellowRowPeaks,
      this.vpX * this.w,
      vpY,
      yRef,
    ).filter((x) => x < this.w * (0.45 + this.rollBias))

    const whitePeaksPx = clusterProjected(whiteProjected, 20, 5)
    const yellowPeaksPx = clusterProjected(yellowProjected, 26, 2)

    const hasYellowNow = yellowPeaksPx.length > 0

    this.smoothWhite = softSmoothPeaks(
      this.smoothWhite,
      whitePeaksPx.map((x) => x / this.w),
      0.38,
    )
    this.smoothYellow = softSmoothPeaks(
      this.smoothYellow,
      hasYellowNow ? yellowPeaksPx.map((x) => x / this.w) : [],
      0.4,
    )
    if (!hasYellowNow) this.smoothYellow = []

    if (hasYellowNow) this.yellowVotes = Math.min(30, this.yellowVotes + 1)
    else this.yellowVotes = Math.max(0, this.yellowVotes - 2)
    this.hasYellow = this.yellowVotes >= 8

    const yellowCutPx =
      this.hasYellow && this.smoothYellow.length
        ? Math.min(...this.smoothYellow) * this.w
        : null

    const whiteForCount = this.smoothWhite.map((x) => x * this.w)
    const samePeaks =
      yellowCutPx != null
        ? whiteForCount.filter((p) => p >= yellowCutPx + 16)
        : whiteForCount
    const oncomingPeaks =
      yellowCutPx != null ? whiteForCount.filter((p) => p < yellowCutPx - 14) : []

    const hasOncomingPaint = oncomingPeaks.length >= 2
    const boundaryPeaks =
      yellowCutPx != null ? [yellowCutPx, ...samePeaks] : samePeaks
    const observedSame = clamp(estimateLaneCount(boundaryPeaks, this.w), 1, 4)

    // Asymmetric voting: easier to gain a lane, harder to lose (prevents flicker)
    this.commitVotesAsym(this.sameVotes, observedSame, this.sameLanes, (n) => {
      this.sameLanes = n
    })

    if (this.hasYellow && hasOncomingPaint) {
      const observedOncoming = clamp(estimateLaneCount(oncomingPeaks, this.w), 1, 2)
      this.commitVotesAsym(this.oncomingVotes, Math.max(1, observedOncoming), this.oncomingLanes, (n) => {
        this.oncomingLanes = Math.max(1, n)
      })
    } else {
      this.oncomingLanes = 0
      this.oncomingVotes.fill(0)
    }

    // Ego lane from image center relative to VP-corrected mid
    const mid = this.vpX * this.w
    this.egoLaneIndex = pickEgoLane(boundaryPeaks, this.sameLanes, mid)

    this.lastOverlayLines = buildOverlayLines(
      this.smoothWhite,
      this.smoothYellow,
      this.hasYellow,
      this.vpX,
    )
  }

  private commitVotesAsym(
    votes: number[],
    observed: number,
    current: number,
    apply: (n: number) => void,
  ) {
    const idx = clamp(observed, 0, votes.length - 1)
    // Losing a lane needs stronger evidence
    const gain = observed >= current ? 1.5 : 0.85
    votes[idx] += gain
    for (let i = 0; i < votes.length; i++) {
      if (i !== idx) votes[i] = Math.max(0, votes[i] - (observed < current ? 0.25 : 0.4))
    }
    const need = observed < current ? 9 : 5.5
    if (votes[idx] > need) {
      apply(idx)
      for (let i = 0; i < votes.length; i++) votes[i] = 0
      votes[idx] = 2.5
    }
  }
}

/**
 * Smoothly animates mark positions and plays a converge animation
 * when the lane count drops (4→3 merge etc.).
 */
export class LaneLayoutAnimator {
  private marks: LaneMark[] = []
  private sameLanes = 2
  private oncomingLanes = 0
  private hasYellow = false
  private egoLaneIndex = 0
  private mergeT = 1 // 1 = idle, 0..1 during merge

  update(target: LaneState, dt: number): LaneState {
    const targetSame = target.sameDirectionLanes
    const dropping = targetSame < this.sameLanes

    if (dropping && this.mergeT >= 1) {
      // Start merge: keep old layout and converge the disappearing edge
      this.mergeT = 0
    } else if (targetSame > this.sameLanes) {
      // Instantly accept new lane (split / reveal)
      this.sameLanes = targetSame
      this.mergeT = 1
    }

    if (this.mergeT < 1) {
      this.mergeT = Math.min(1, this.mergeT + dt / 1.35)
      const from = this.sameLanes
      const to = targetSame
      this.marks = blendMergeLayout(
        from,
        to,
        this.mergeT,
        target.oncomingLanes,
        target.dividerX != null || this.hasYellow,
        this.egoLaneIndex,
      )
      if (this.mergeT >= 1) {
        this.sameLanes = to
        this.oncomingLanes = target.oncomingLanes
        this.hasYellow = target.dividerX != null || target.marks.some((m) => m.kind.includes('yellow'))
        this.egoLaneIndex = clamp(
          Math.round(
            (-(target.marks[0]?.x ?? -EGO_HALF) - EGO_HALF) / LANE_W,
          ),
          0,
          Math.max(0, to - 1),
        )
        this.marks = target.marks.map((m) => ({ ...m, xFar: m.x, opacity: 1 }))
      }
    } else {
      this.sameLanes = targetSame
      this.oncomingLanes = target.oncomingLanes
      this.hasYellow =
        target.dividerX != null || target.marks.some((m) => m.kind.includes('yellow'))
      // Softly lerp mark x toward target
      this.marks = lerpMarks(this.marks, target.marks, Math.min(1, dt * 4))
    }

    return {
      sameDirectionLanes: this.mergeT < 1 ? Math.max(targetSame, this.sameLanes) : this.sameLanes,
      oncomingLanes: this.oncomingLanes,
      marks: this.marks.map((m) => ({ ...m })),
      egoLaneHalfWidth: EGO_HALF,
      dividerX: target.dividerX,
    }
  }
}

function blendMergeLayout(
  fromLanes: number,
  toLanes: number,
  t: number,
  oncoming: number,
  hasYellow: boolean,
  egoIdx: number,
): LaneMark[] {
  const from = buildLayout(fromLanes, oncoming, hasYellow, egoIdx).marks
  const to = buildLayout(toLanes, oncoming, hasYellow, egoIdx).marks
  const ease = t * t * (3 - 2 * t)
  const farT = Math.min(1, ease * 1.4)
  const nearT = Math.max(0, (ease - 0.2) / 0.8)

  const out: LaneMark[] = []
  const claimedFrom = new Set<number>()

  // Pair each target mark with nearest source
  for (const b of to) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < from.length; i++) {
      if (claimedFrom.has(i)) continue
      const d = Math.abs(from[i].x - b.x)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    const a = best >= 0 ? from[best] : b
    if (best >= 0) claimedFrom.add(best)
    out.push({
      kind: b.kind,
      x: a.x + (b.x - a.x) * nearT,
      xFar: a.x + (b.x - a.x) * farT,
      opacity: 1,
    })
  }

  // Extra source marks (disappearing lane edge) converge into nearest survivor
  for (let i = 0; i < from.length; i++) {
    if (claimedFrom.has(i)) continue
    const a = from[i]
    const nearest = to.reduce((best, m) =>
      Math.abs(m.x - a.x) < Math.abs(best.x - a.x) ? m : best,
    )
    out.push({
      kind: 'dashed_white',
      x: a.x + (nearest.x - a.x) * nearT,
      xFar: a.x + (nearest.x - a.x) * Math.min(1, farT + 0.2),
      opacity: Math.max(0, 1 - ease),
    })
  }

  return out.sort((a, b) => a.x - b.x)
}

function lerpMarks(prev: LaneMark[], target: LaneMark[], a: number): LaneMark[] {
  if (!prev.length) return target.map((m) => ({ ...m, xFar: m.x, opacity: 1 }))
  const out: LaneMark[] = []
  const used = new Set<number>()
  for (const p of prev) {
    let best = -1
    let bestD = 2.8
    for (let i = 0; i < target.length; i++) {
      if (used.has(i)) continue
      const d = Math.abs(target[i].x - p.x)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) {
      used.add(best)
      const t = target[best]
      const x = p.x + (t.x - p.x) * a
      out.push({ kind: t.kind, x, xFar: x, opacity: 1 })
    }
  }
  for (let i = 0; i < target.length; i++) {
    if (used.has(i)) continue
    out.push({ ...target[i], xFar: target[i].x, opacity: 1 })
  }
  return out.sort((m, n) => m.x - n.x)
}

function scoreRow(
  data: Uint8ClampedArray,
  w: number,
  y: number,
  night: boolean,
  rollBias: number,
): { white: Float32Array; yellow: Float32Array } {
  const white = new Float32Array(w)
  const yellow = new Float32Array(w)
  const y0 = Math.max(1, y - 2)
  const y1 = Math.min(Math.floor(data.length / (w * 4)) - 1, y + 2)
  const xShift = Math.round(rollBias * w)

  for (let yy = y0; yy <= y1; yy++) {
    for (let x = 3; x < w - 3; x++) {
      const sx = clamp(x + xShift, 3, w - 4)
      const i = (yy * w + sx) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const bright = (r + g + b) / 3

      let neigh = 0
      for (const dx of [-12, -7, 7, 12]) {
        const ni = (yy * w + clamp(sx + dx, 0, w - 1)) * 4
        neigh += (data[ni] + data[ni + 1] + data[ni + 2]) / 3
      }
      neigh /= 4
      const contrast = bright - neigh
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const sat = max === 0 ? 0 : (max - min) / max

      const looksYellow =
        r > g + 6 &&
        g > b + 10 &&
        r - b > (night ? 42 : 55) &&
        sat > (night ? 0.24 : 0.34) &&
        sat < 0.9 &&
        r > (night ? 90 : 120) &&
        bright < 215

      const whiteThresh = night ? 45 : 88
      const contrastThresh = night ? 12 : 17

      if (
        !looksYellow &&
        bright > whiteThresh &&
        contrast > contrastThresh &&
        sat < 0.38 &&
        Math.abs(r - g) < 36
      ) {
        white[x] += 0.5 + Math.min(2.2, contrast / 26)
      }

      if (looksYellow && x < w * 0.58 && contrast > (night ? 8 : 12)) {
        yellow[x] += 0.65 + Math.min(2, contrast / 26)
      }
    }
  }
  return { white, yellow }
}

function estimateVanishingX(
  rows: { y: number; xs: number[] }[],
  w: number,
  h: number,
  prev: number,
): number {
  // Pair peaks between adjacent rows and extrapolate to horizon
  const vpSamples: number[] = []
  for (let r = 0; r < rows.length - 1; r++) {
    const a = rows[r]
    const b = rows[r + 1]
    for (const xa of a.xs) {
      let best: number | null = null
      let bestD = 40
      for (const xb of b.xs) {
        const d = Math.abs(xb - xa)
        if (d < bestD) {
          bestD = d
          best = xb
        }
      }
      if (best == null) continue
      // Line through (xa,a.y) and (best,b.y) → x at y=vpY
      const vpY = h * 0.3
      const t = (vpY - a.y) / (b.y - a.y)
      const xVp = xa + (best - xa) * t
      if (xVp > w * 0.2 && xVp < w * 0.8) vpSamples.push(xVp / w)
    }
  }
  if (!vpSamples.length) return prev * 0.9 + 0.5 * 0.1
  vpSamples.sort((a, b) => a - b)
  const med = vpSamples[Math.floor(vpSamples.length / 2)]
  return prev * 0.75 + med * 0.25
}

function projectPeaksToRow(
  rows: { y: number; xs: number[] }[],
  vpX: number,
  vpY: number,
  yRef: number,
): number[] {
  const out: number[] = []
  for (const row of rows) {
    const denom = row.y - vpY
    if (Math.abs(denom) < 1) continue
    const scale = (yRef - vpY) / denom
    for (const x of row.xs) {
      out.push(vpX + (x - vpX) * scale)
    }
  }
  return out
}

function clusterProjected(xs: number[], minGap: number, maxKeep: number): number[] {
  if (!xs.length) return []
  const sorted = [...xs].sort((a, b) => a - b)
  const clusters: { x: number; n: number }[] = []
  for (const x of sorted) {
    const hit = clusters.find((c) => Math.abs(c.x - x) <= minGap)
    if (hit) {
      hit.x = (hit.x * hit.n + x) / (hit.n + 1)
      hit.n++
    } else {
      clusters.push({ x, n: 1 })
    }
  }
  return clusters
    .filter((c) => c.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, maxKeep)
    .map((c) => Math.round(c.x))
    .sort((a, b) => a - b)
}

function softSmoothPeaks(prev: number[], next: number[], alpha: number): number[] {
  if (!next.length) return prev.slice(0, Math.min(prev.length, 4))
  if (!prev.length) return next
  const out: number[] = []
  const used = new Set<number>()
  for (const p of prev) {
    let best = -1
    let bestD = 0.08
    for (let i = 0; i < next.length; i++) {
      if (used.has(i)) continue
      const d = Math.abs(next[i] - p)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) {
      used.add(best)
      out.push(p * (1 - alpha) + next[best] * alpha)
    }
  }
  for (let i = 0; i < next.length; i++) {
    if (!used.has(i)) out.push(next[i])
  }
  return out.sort((a, b) => a - b).slice(0, 6)
}

function buildOverlayLines(
  white: number[],
  yellow: number[],
  hasYellow: boolean,
  vpX: number,
): OverlayLaneLine[] {
  const lines: OverlayLaneLine[] = []
  const sorted = [...white].sort((a, b) => a - b)
  void vpX

  if (hasYellow && yellow.length) {
    const yx = Math.min(...yellow)
    lines.push({ x: yx, color: 'yellow', style: 'solid' })
    const filtered = sorted.filter((x) => Math.abs(x - yx) > 0.04)
    filtered.forEach((x, i) => {
      lines.push({
        x,
        color: 'white',
        style: i === filtered.length - 1 ? 'solid' : 'dashed',
      })
    })
  } else {
    sorted.forEach((x, i) => {
      const isEdge = i === 0 || i === sorted.length - 1
      lines.push({ x, color: 'white', style: isEdge ? 'solid' : 'dashed' })
    })
  }
  return lines.slice(0, 6)
}

function buildLayout(
  sameLanes: number,
  oncomingLanes: number,
  hasYellow: boolean,
  egoLaneIndex: number,
): LaneState {
  const marks: LaneMark[] = []
  const half = EGO_HALF
  const egoIdx = clamp(egoLaneIndex, 0, sameLanes - 1)
  const sameLeftEdge = -half - egoIdx * LANE_W
  const sameRightEdge = sameLeftEdge + sameLanes * LANE_W

  if (hasYellow && oncomingLanes > 0) {
    const oncomingLeft = sameLeftEdge - oncomingLanes * LANE_W
    marks.push({ x: oncomingLeft, kind: 'solid_white', xFar: oncomingLeft, opacity: 1 })
    for (let i = 1; i < oncomingLanes; i++) {
      const x = oncomingLeft + LANE_W * i
      marks.push({ x, kind: 'dashed_white', xFar: x, opacity: 1 })
    }
    marks.push({ x: sameLeftEdge, kind: 'double_yellow', xFar: sameLeftEdge, opacity: 1 })
  } else if (hasYellow) {
    marks.push({ x: sameLeftEdge, kind: 'solid_yellow', xFar: sameLeftEdge, opacity: 1 })
  } else {
    marks.push({ x: sameLeftEdge, kind: 'solid_white', xFar: sameLeftEdge, opacity: 1 })
  }

  for (let i = 1; i < sameLanes; i++) {
    const x = sameLeftEdge + LANE_W * i
    marks.push({ x, kind: 'dashed_white', xFar: x, opacity: 1 })
  }
  marks.push({ x: sameRightEdge, kind: 'solid_white', xFar: sameRightEdge, opacity: 1 })

  return {
    sameDirectionLanes: sameLanes,
    oncomingLanes: hasYellow && oncomingLanes > 0 ? oncomingLanes : 0,
    marks,
    egoLaneHalfWidth: half,
    dividerX: hasYellow && oncomingLanes > 0 ? sameLeftEdge : null,
  }
}

function estimateLaneCount(peaks: number[], width: number): number {
  if (peaks.length <= 1) return 1
  const merged: number[] = [peaks[0]]
  for (let i = 1; i < peaks.length; i++) {
    if (peaks[i] - merged[merged.length - 1] < 24) continue
    merged.push(peaks[i])
  }
  if (merged.length <= 1) return 1
  if (merged.length === 2) return 2

  const gaps: number[] = []
  for (let i = 1; i < merged.length; i++) gaps.push(merged[i] - merged[i - 1])
  gaps.sort((a, b) => a - b)
  const medianGap = gaps[Math.floor(gaps.length / 2)] || width * 0.2
  const fromPeaks = merged.length - 1
  const span = merged[merged.length - 1] - merged[0]
  const fromSpan = Math.max(1, Math.round(span / clamp(medianGap, 30, 100)))
  return clamp(Math.min(fromPeaks, fromSpan), 1, 4)
}

function pickEgoLane(peaks: number[], sameLanes: number, mid: number): number {
  if (sameLanes <= 1 || peaks.length < 2) return 0
  const left = peaks[0]
  const right = peaks[peaks.length - 1]
  const t = (mid - left) / Math.max(1, right - left)
  return clamp(Math.floor(t * sameLanes), 0, sameLanes - 1)
}

function findPeaks(
  col: Float32Array,
  minScore: number,
  minGap: number,
  maxPeaks: number,
): number[] {
  const blur = new Float32Array(col.length)
  for (let x = 2; x < col.length - 2; x++) {
    blur[x] = (col[x - 2] + col[x - 1] * 2 + col[x] * 3 + col[x + 1] * 2 + col[x + 2]) / 9
  }
  const scored: { x: number; v: number }[] = []
  for (let x = 4; x < blur.length - 4; x++) {
    const v = blur[x]
    if (v < minScore) continue
    if (v >= blur[x - 1] && v >= blur[x + 1] && v >= blur[x - 2] && v >= blur[x + 2]) {
      scored.push({ x, v })
    }
  }
  scored.sort((a, b) => b.v - a.v)
  const peaks: number[] = []
  for (const p of scored) {
    if (peaks.some((q) => Math.abs(q - p.x) < minGap)) continue
    peaks.push(p.x)
    if (peaks.length >= maxPeaks) break
  }
  return peaks.sort((a, b) => a - b)
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}
