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
  private oncomingSide: -1 | 1 = 1 // UK default: oncoming on the right
  private yellowVotes = 0
  private hasYellow = false
  private hasDivider = false
  private egoLaneIndex = 0

  /** Estimated vanishing-point x in normalized coords (handles roll / off-center aim). */
  private vpX = 0.5
  private rollBias = 0 // shifts sample band laterally

  private smoothWhite: number[] = []
  private smoothYellow: number[] = []
  private lastOverlayLines: OverlayLaneLine[] = []
  /** Shared lateral bend: x(z) += roadCurve * t², t near→far. */
  private roadCurve = 0
  /** Per-boundary world polys from peak chains (left→right), when available. */
  private visionPolys: { z: number; x: number }[][] = []
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
    this.sameLanes = Math.max(2, this.sameLanes)
    const layout = buildLayout(
      this.sameLanes,
      this.oncomingLanes,
      this.hasYellow,
      this.hasDivider,
      this.egoLaneIndex,
      this.oncomingSide,
    )
    return applyCurveToLayout(layout, this.visionPolys, this.roadCurve)
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
        // Lower thresholds so worn UK dashed paint still registers
        xs: findPeaks(white, night ? 4 : 6, 12, 7),
      })
      yellowRowPeaks.push({
        y,
        xs: findPeaks(yellow, night ? 8 : 12, 20, 2),
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

    const whitePeaksPx = clusterProjected(whiteProjected, 16, 6)
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

    const mid = this.vpX * this.w
    const whiteForCount = this.smoothWhite.map((x) => x * this.w)

    // Prefer yellow cut; else only split dual carriage with strong evidence.
    // A normal 2-lane same-direction road has ~3 paint peaks and must NOT
    // be treated as 1 same + oncoming (that collapses the HUD to "lanes 1").
    let cutPx: number | null =
      this.hasYellow && this.smoothYellow.length
        ? Math.min(...this.smoothYellow) * this.w
        : null

    if (cutPx == null && whiteForCount.length >= 5) {
      cutPx = findCenterCut(whiteForCount, mid)
    }

    let samePeaks: number[]
    let oncomingPeaks: number[]
    let bidirectional = false

    if (cutPx != null && this.hasYellow) {
      bidirectional = true
      this.hasDivider = true
      const leftPeaks = whiteForCount.filter((p) => p < cutPx - 8)
      const rightPeaks = whiteForCount.filter((p) => p > cutPx + 8)
      this.oncomingSide = -1
      samePeaks = rightPeaks.length ? rightPeaks : whiteForCount.filter((p) => p >= cutPx - 4)
      oncomingPeaks = leftPeaks
    } else if (cutPx != null && whiteForCount.length >= 5) {
      const leftPeaks = whiteForCount.filter((p) => p < cutPx - 8)
      const rightPeaks = whiteForCount.filter((p) => p > cutPx + 8)
      // UK dual carriage: need real structure on both sides (not just two kerbs)
      if (leftPeaks.length >= 2 && rightPeaks.length >= 2) {
        bidirectional = true
        this.hasDivider = true
        this.oncomingSide = 1
        samePeaks = leftPeaks
        oncomingPeaks = rightPeaks
      } else {
        this.hasDivider = false
        samePeaks = whiteForCount
        oncomingPeaks = []
      }
    } else {
      this.hasDivider = false
      samePeaks = whiteForCount
      oncomingPeaks = []
    }

    const boundaryPeaks =
      cutPx != null && this.hasYellow ? [cutPx, ...samePeaks] : samePeaks
    // Urban prior: always at least 2 same-direction lanes (never collapse to 1).
    // 1 peak / no paint → still show dual lane; 3+ peaks → 2 or 3.
    let observedSame = clamp(estimateLaneCount(boundaryPeaks, this.w), 2, 3)

    if (!bidirectional && whiteForCount.length >= 2) {
      const span = Math.max(...whiteForCount) - Math.min(...whiteForCount)
      if (span > this.w * 0.16) observedSame = Math.max(observedSame, 2)
      // Three well-spaced marks → two lanes (L | dash | R)
      if (whiteForCount.length >= 3) observedSame = Math.max(observedSame, 2)
    }
    if (
      bidirectional &&
      !this.hasYellow &&
      samePeaks.length >= 2 &&
      oncomingPeaks.length >= 2
    ) {
      observedSame = 2
    }

    this.commitVotesAsym(this.sameVotes, observedSame, this.sameLanes, (n) => {
      this.sameLanes = Math.max(2, n)
    })
    // Snap up to 2 immediately — demotion to 1 is disabled
    if (this.sameLanes < 2) {
      this.sameLanes = 2
      this.sameVotes.fill(0)
      this.sameVotes[2] = 3
    }
    // Promote 2→2 stickiness; promote to 3 only via votes
    if (observedSame === 2 && this.sameLanes === 2) {
      this.sameVotes[2] = Math.min(12, this.sameVotes[2] + 0.5)
    }

    if (bidirectional && oncomingPeaks.length >= 1) {
      let observedOncoming = clamp(
        Math.max(1, estimateLaneCount([cutPx!, ...oncomingPeaks], this.w)),
        1,
        2,
      )
      if (!this.hasYellow && oncomingPeaks.length >= 2) observedOncoming = 2
      this.commitVotesAsym(
        this.oncomingVotes,
        observedOncoming,
        this.oncomingLanes,
        (n) => {
          this.oncomingLanes = Math.max(1, n)
        },
      )
      if (this.oncomingLanes < 1) this.oncomingLanes = Math.max(1, observedOncoming)
    } else if (!this.hasYellow && !bidirectional) {
      for (let i = 0; i < this.oncomingVotes.length; i++) {
        this.oncomingVotes[i] = Math.max(0, this.oncomingVotes[i] - 0.5)
      }
      if (this.oncomingVotes.every((v) => v < 1)) this.oncomingLanes = 0
    }

    this.egoLaneIndex = pickEgoLane(boundaryPeaks, this.sameLanes, mid)

    // Curved geometry: link multi-row peaks → world polys + shared roadCurve
    const { polys, curve } = buildVisionPolys(
      rowPeaks,
      yellowRowPeaks,
      this.vpX,
      this.w,
      this.h,
    )
    this.visionPolys = polys
    // Heavy damp + clamp so curve never yanks marks around
    const nextCurve = clamp(curve, -3, 3)
    this.roadCurve = this.roadCurve * 0.9 + nextCurve * 0.1

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
    const need = observed < current ? 18 : 3.5
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
  private oncomingSide: -1 | 1 = 1
  private egoLaneIndex = 0
  private mergeT = 1
  private dividerX: number | null = null

  update(target: LaneState, dt: number): LaneState {
    // Never animate down to a single same-direction lane
    const targetSame = Math.max(2, target.sameDirectionLanes)
    const dropping = targetSame < this.sameLanes && this.sameLanes > 2

    if (dropping && this.mergeT >= 1) {
      this.mergeT = 0
    } else if (targetSame > this.sameLanes) {
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
        target.dividerX != null,
        target.marks.some((m) => m.kind.includes('yellow')),
        this.egoLaneIndex,
        target.oncomingSide,
      )
      if (this.mergeT >= 1) {
        this.sameLanes = to
        this.oncomingLanes = target.oncomingLanes
        this.oncomingSide = target.oncomingSide
        this.dividerX = target.dividerX
        this.marks = target.marks.map((m) => ({
          ...m,
          xFar: m.xFar ?? m.x,
          opacity: 1,
          poly: m.poly ? m.poly.map((p) => ({ ...p })) : rebuildPoly(m.x, m.xFar ?? m.x),
        }))
      }
    } else {
      this.sameLanes = targetSame
      this.oncomingLanes = target.oncomingLanes
      this.oncomingSide = target.oncomingSide
      this.dividerX = target.dividerX
      // Slow lerp + rebuild clean polys (never carry jagged vision chains)
      this.marks = lerpMarks(this.marks, target.marks, Math.min(1, dt * 1.6)).map((m) => {
        const xFar = m.xFar ?? m.x
        // Cap far-end wander so marks stay roughly parallel
        const cappedFar = m.x + clamp(xFar - m.x, -1.2, 1.2)
        return {
          ...m,
          xFar: cappedFar,
          poly: rebuildPoly(m.x, cappedFar, 0),
        }
      })
    }

    return {
      sameDirectionLanes: Math.max(
        2,
        this.mergeT < 1 ? Math.max(targetSame, this.sameLanes) : this.sameLanes,
      ),
      oncomingLanes: this.oncomingLanes,
      oncomingSide: this.oncomingSide,
      marks: this.marks.map((m) => ({ ...m })),
      egoLaneHalfWidth: EGO_HALF,
      dividerX: this.dividerX,
    }
  }
}

function blendMergeLayout(
  fromLanes: number,
  toLanes: number,
  t: number,
  oncoming: number,
  hasDivider: boolean,
  hasYellow: boolean,
  egoIdx: number,
  oncomingSide: -1 | 1,
): LaneMark[] {
  const from = buildLayout(fromLanes, oncoming, hasYellow, hasDivider, egoIdx, oncomingSide).marks
  const to = buildLayout(toLanes, oncoming, hasYellow, hasDivider, egoIdx, oncomingSide).marks
  const ease = t * t * (3 - 2 * t)
  const farT = Math.min(1, ease * 1.4)
  const nearT = Math.max(0, (ease - 0.2) / 0.8)

  const out: LaneMark[] = []
  const claimedFrom = new Set<number>()

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
    const x = a.x + (b.x - a.x) * nearT
    const xFar = a.x + (b.x - a.x) * farT
    out.push({
      kind: b.kind,
      x,
      xFar,
      opacity: 1,
      poly: rebuildPoly(x, xFar),
    })
  }

  for (let i = 0; i < from.length; i++) {
    if (claimedFrom.has(i)) continue
    const a = from[i]
    const nearest = to.reduce((best, m) =>
      Math.abs(m.x - a.x) < Math.abs(best.x - a.x) ? m : best,
    )
    const x = a.x + (nearest.x - a.x) * nearT
    const xFar = a.x + (nearest.x - a.x) * Math.min(1, farT + 0.2)
    out.push({
      kind: 'dashed_white',
      x,
      xFar,
      opacity: Math.max(0, 1 - ease),
      poly: rebuildPoly(x, xFar),
    })
  }

  return out.sort((a, b) => a.x - b.x)
}

function lerpMarks(prev: LaneMark[], target: LaneMark[], a: number): LaneMark[] {
  if (!prev.length) {
    return target.map((m) => ({
      ...m,
      xFar: m.xFar ?? m.x,
      opacity: 1,
      poly: m.poly ? m.poly.map((p) => ({ ...p })) : rebuildPoly(m.x, m.xFar ?? m.x),
    }))
  }
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
      const xFarT = t.xFar ?? t.x
      const xFarP = p.xFar ?? p.x
      const xFar = xFarP + (xFarT - xFarP) * a
      out.push({
        kind: t.kind,
        x,
        xFar,
        opacity: 1,
        poly: lerpPoly(p.poly, t.poly, a, x, xFar),
      })
    }
  }
  for (let i = 0; i < target.length; i++) {
    if (used.has(i)) continue
    const m = target[i]
    out.push({
      ...m,
      xFar: m.xFar ?? m.x,
      opacity: 1,
      poly: m.poly ? m.poly.map((p) => ({ ...p })) : rebuildPoly(m.x, m.xFar ?? m.x),
    })
  }
  return out.sort((m, n) => m.x - n.x)
}

function lerpPoly(
  prev: { z: number; x: number }[] | undefined,
  target: { z: number; x: number }[] | undefined,
  a: number,
  xNear: number,
  xFar: number,
): { z: number; x: number }[] {
  const fallback = rebuildPoly(xNear, xFar)
  const A = prev && prev.length >= 2 ? prev : fallback
  const B = target && target.length >= 2 ? target : fallback
  return POLY_Z.map((z) => {
    const xa = samplePolyX(A, z, xNear)
    const xb = samplePolyX(B, z, xFar)
    return { z, x: xa + (xb - xa) * a }
  })
}

const POLY_Z = [6, 25, 45, 70, 95, 120]

function rebuildPoly(
  xNear: number,
  xFar: number,
  curve = 0,
): { z: number; x: number }[] {
  const z0 = POLY_Z[0]
  const z1 = POLY_Z[POLY_Z.length - 1]
  return POLY_Z.map((z) => {
    const t = (z - z0) / (z1 - z0)
    return { z, x: xNear + (xFar - xNear) * t + curve * t * t }
  })
}

function samplePolyX(
  poly: { z: number; x: number }[],
  z: number,
  fallbackX: number,
): number {
  if (!poly.length) return fallbackX
  if (z <= poly[0].z) return poly[0].x
  if (z >= poly[poly.length - 1].z) return poly[poly.length - 1].x
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]
    const b = poly[i + 1]
    if (z >= a.z && z <= b.z) {
      const t = (z - a.z) / Math.max(1e-6, b.z - a.z)
      return a.x + (b.x - a.x) * t
    }
  }
  return fallbackX
}

/** Attach a gentle shared curve onto nominal layout marks.
 * Raw vision chains are too noisy for 3D (caused lines to jump/shatter) —
 * only borrow a capped global bend, never per-peak polylines.
 */
function applyCurveToLayout(
  layout: LaneState,
  _visionPolys: { z: number; x: number }[][],
  roadCurve: number,
): LaneState {
  const curve = clamp(roadCurve, -2.5, 2.5) * 0.35
  const marks = layout.marks.map((m) => {
    const xFar = m.xFar ?? m.x
    // Keep near/far almost parallel; tiny shared bend only
    const poly = rebuildPoly(m.x, xFar + curve * 0.15, curve)
    return {
      ...m,
      x: poly[0].x,
      xFar: poly[poly.length - 1].x,
      poly,
    }
  })
  return { ...layout, marks }
}

/**
 * Link row peaks into chains, convert to world (x,z), fit/sample polys,
 * and estimate a shared roadCurve.
 */
function buildVisionPolys(
  whiteRows: { y: number; xs: number[] }[],
  yellowRows: { y: number; xs: number[] }[],
  vpX: number,
  w: number,
  h: number,
): { polys: { z: number; x: number }[][]; curve: number } {
  const chains = [
    ...linkPeakChains(yellowRows),
    ...linkPeakChains(whiteRows),
  ]

  const yRef = Math.floor(h * 0.9)
  const vpY = h * 0.32
  const refGaps: number[] = []
  const bottom = whiteRows[whiteRows.length - 1]
  if (bottom && bottom.xs.length >= 2) {
    for (let i = 1; i < bottom.xs.length; i++) {
      refGaps.push(bottom.xs[i] - bottom.xs[i - 1])
    }
  }
  refGaps.sort((a, b) => a - b)
  const medianGap =
    refGaps.length > 0 ? refGaps[Math.floor(refGaps.length / 2)] : w * 0.18
  const mPerPxRef = LANE_W / clamp(medianGap, 22, w * 0.45)

  const polys: { z: number; x: number }[][] = []
  const curves: number[] = []

  for (const chain of chains) {
    if (chain.length < 2) continue
    const worldPts: { z: number; x: number }[] = []
    for (const p of chain) {
      const z = imageYToZ(p.y, h)
      const scale = (yRef - vpY) / Math.max(8, p.y - vpY)
      const mPerPx = mPerPxRef * scale
      const x = (p.x - vpX * w) * mPerPx
      worldPts.push({ z, x })
    }
    // Near → far (increasing z)
    worldPts.sort((a, b) => a.z - b.z)
    const poly = fitPolyQuadratic(worldPts)
    if (poly.length >= 2) {
      polys.push(poly)
      // Curvature from mid-point residual vs straight chord
      const mid = poly[Math.floor(poly.length / 2)]
      const last = poly[poly.length - 1]
      const midT = (mid.z - poly[0].z) / Math.max(1, last.z - poly[0].z)
      const straightMid = poly[0].x + (last.x - poly[0].x) * midT
      curves.push((mid.x - straightMid) / Math.max(0.08, midT * midT))
    }
  }

  polys.sort((a, b) => a[0].x - b[0].x)
  let curve = 0
  if (curves.length) {
    curves.sort((a, b) => a - b)
    curve = clamp(curves[Math.floor(curves.length / 2)], -8, 8)
  }
  return { polys, curve }
}

/** Walk bottom→top linking nearest peaks within a gap. */
function linkPeakChains(
  rows: { y: number; xs: number[] }[],
): { x: number; y: number }[][] {
  if (!rows.length) return []
  // rows ordered far→near in sample; reverse so index 0 = nearest
  const ordered = [...rows].sort((a, b) => b.y - a.y)
  const near = ordered[0]
  const chains: { x: number; y: number }[][] = near.xs.map((x) => [{ x, y: near.y }])

  for (let r = 1; r < ordered.length; r++) {
    const row = ordered[r]
    const used = new Set<number>()
    for (const chain of chains) {
      const tip = chain[chain.length - 1]
      let best = -1
      let bestD = 36
      for (let i = 0; i < row.xs.length; i++) {
        if (used.has(i)) continue
        const d = Math.abs(row.xs[i] - tip.x)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      if (best >= 0) {
        used.add(best)
        chain.push({ x: row.xs[best], y: row.y })
      }
    }
  }
  return chains.filter((c) => c.length >= 2)
}

/** Inverse-depth heuristic: bottom ≈ 10m, band top ≈ 75m. */
function imageYToZ(y: number, h: number): number {
  const yN = y / h
  const yNear = 0.94
  const yFar = 0.55
  const invNear = 1 / 10
  const invFar = 1 / 75
  const t = clamp((yNear - yN) / (yNear - yFar), 0, 1)
  return 1 / (invNear + (invFar - invNear) * t)
}

/** Least-squares quadratic x(z)=a+b z+c z², then sample POLY_Z. */
function fitPolyQuadratic(
  pts: { z: number; x: number }[],
): { z: number; x: number }[] {
  if (pts.length < 2) return []
  if (pts.length === 2) {
    return rebuildPoly(pts[0].x, pts[1].x, 0).map((p) => ({
      z: p.z,
      x: samplePolyX(
        [
          { z: pts[0].z, x: pts[0].x },
          { z: pts[1].z, x: pts[1].x },
        ],
        p.z,
        pts[0].x,
      ),
    }))
  }

  // Use up to 4 points spread along the chain
  const picked: { z: number; x: number }[] = []
  const n = Math.min(4, pts.length)
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (pts.length - 1)) / Math.max(1, n - 1))
    picked.push(pts[idx])
  }

  // Solve normal equations for [a,b,c]
  let s0 = 0,
    s1 = 0,
    s2 = 0,
    s3 = 0,
    s4 = 0
  let sx = 0,
    sxz = 0,
    sxz2 = 0
  for (const p of picked) {
    const z = p.z
    const z2 = z * z
    s0++
    s1 += z
    s2 += z2
    s3 += z2 * z
    s4 += z2 * z2
    sx += p.x
    sxz += p.x * z
    sxz2 += p.x * z2
  }

  // 3x3 solve via Cramer's / elimination
  const det =
    s0 * (s2 * s4 - s3 * s3) -
    s1 * (s1 * s4 - s3 * s2) +
    s2 * (s1 * s3 - s2 * s2)
  let a = picked[0].x
  let b = 0
  let c = 0
  if (Math.abs(det) > 1e-6) {
    a =
      (sx * (s2 * s4 - s3 * s3) -
        s1 * (sxz * s4 - s3 * sxz2) +
        s2 * (sxz * s3 - s2 * sxz2)) /
      det
    b =
      (s0 * (sxz * s4 - s3 * sxz2) -
        sx * (s1 * s4 - s3 * s2) +
        s2 * (s1 * sxz2 - sxz * s2)) /
      det
    c =
      (s0 * (s2 * sxz2 - sxz * s3) -
        s1 * (s1 * sxz2 - sxz * s2) +
        sx * (s1 * s3 - s2 * s2)) /
      det
  } else {
    // Fallback: linear
    const z0 = picked[0].z
    const z1 = picked[picked.length - 1].z
    b = (picked[picked.length - 1].x - picked[0].x) / Math.max(1, z1 - z0)
    a = picked[0].x - b * z0
    c = 0
  }

  return POLY_Z.map((z) => ({ z, x: a + b * z + c * z * z }))
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

  // Local row mean for adaptive asphalt threshold
  let rowMean = 0
  let rowN = 0
  for (let x = 4; x < w - 4; x += 2) {
    const i = (y * w + x) * 4
    rowMean += (data[i] + data[i + 1] + data[i + 2]) / 3
    rowN++
  }
  rowMean /= Math.max(1, rowN)

  for (let yy = y0; yy <= y1; yy++) {
    for (let x = 3; x < w - 3; x++) {
      const sx = clamp(x + xShift, 3, w - 4)
      const i = (yy * w + sx) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const bright = (r + g + b) / 3

      let neigh = 0
      for (const dx of [-14, -8, -5, 5, 8, 14]) {
        const ni = (yy * w + clamp(sx + dx, 0, w - 1)) * 4
        neigh += (data[ni] + data[ni + 1] + data[ni + 2]) / 3
      }
      neigh /= 6
      const contrast = bright - neigh
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const sat = max === 0 ? 0 : (max - min) / max

      const looksYellow =
        r > g + 6 &&
        g > b + 10 &&
        r - b > (night ? 42 : 50) &&
        sat > (night ? 0.22 : 0.28) &&
        sat < 0.9 &&
        r > (night ? 85 : 110) &&
        bright < 220

      // Adaptive: paint is brighter than local asphalt, not an absolute white
      const whiteThresh = night ? 40 : Math.max(70, rowMean + 12)
      const contrastThresh = night ? 8 : 10

      if (
        !looksYellow &&
        bright > whiteThresh &&
        contrast > contrastThresh &&
        sat < 0.45 &&
        Math.abs(r - g) < 42
      ) {
        white[x] += 0.55 + Math.min(2.4, contrast / 22)
      }

      // Edge ridge: strong horizontal gradient often marks lane paint
      const iL = (yy * w + clamp(sx - 3, 0, w - 1)) * 4
      const iR = (yy * w + clamp(sx + 3, 0, w - 1)) * 4
      const bL = (data[iL] + data[iL + 1] + data[iL + 2]) / 3
      const bR = (data[iR] + data[iR + 1] + data[iR + 2]) / 3
      const edge = Math.abs(bL - bR)
      if (!looksYellow && bright > rowMean + 8 && edge > (night ? 18 : 22) && sat < 0.4) {
        white[x] += 0.35
      }

      if (looksYellow && x < w * 0.58 && contrast > (night ? 6 : 9)) {
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
    .filter((c) => c.n >= 1)
    .sort((a, b) => b.n - a.n)
    .slice(0, maxKeep)
    .map((c) => Math.round(c.x))
    .sort((a, b) => a - b)
}

function softSmoothPeaks(prev: number[], next: number[], alpha: number): number[] {
  if (!next.length) {
    // Hold previous briefly instead of dropping to empty (prevents mark thrash)
    return prev.slice(0, Math.min(prev.length, 6))
  }
  if (!prev.length) return next
  const out: number[] = []
  const used = new Set<number>()
  for (const p of prev) {
    let best = -1
    let bestD = 0.06
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
      // Slow blend — peaks shouldn't jump frame to frame
      const blended = p * (1 - alpha * 0.55) + next[best] * (alpha * 0.55)
      out.push(blended)
    } else {
      // Keep unmatched previous peak fading toward nearest next / stay
      out.push(p)
    }
  }
  for (let i = 0; i < next.length; i++) {
    if (!used.has(i)) {
      // New peaks need to appear near an existing one or slowly
      out.push(next[i])
    }
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
  hasDivider: boolean,
  egoLaneIndex: number,
  oncomingSide: -1 | 1 = 1,
): LaneState {
  const marks: LaneMark[] = []
  const half = EGO_HALF
  const egoIdx = clamp(egoLaneIndex, 0, sameLanes - 1)
  const sameLeftEdge = -half - egoIdx * LANE_W
  const sameRightEdge = sameLeftEdge + sameLanes * LANE_W
  const showOncoming = hasDivider && oncomingLanes > 0

  const pushMark = (x: number, kind: LaneMark['kind']) => {
    marks.push({ x, kind, xFar: x, opacity: 1 })
  }

  if (showOncoming && oncomingSide < 0) {
    // US-style: oncoming left of divider
    const oncomingLeft = sameLeftEdge - oncomingLanes * LANE_W
    pushMark(oncomingLeft, 'solid_white')
    for (let i = 1; i < oncomingLanes; i++) {
      pushMark(oncomingLeft + LANE_W * i, 'dashed_white')
    }
    pushMark(sameLeftEdge, hasYellow ? 'double_yellow' : 'solid_white')
  } else if (hasYellow && !showOncoming) {
    pushMark(sameLeftEdge, 'solid_yellow')
  } else {
    pushMark(sameLeftEdge, 'solid_white')
  }

  for (let i = 1; i < sameLanes; i++) {
    pushMark(sameLeftEdge + LANE_W * i, 'dashed_white')
  }

  if (showOncoming && oncomingSide > 0) {
    // UK-style: divider then oncoming to the right
    pushMark(sameRightEdge, hasYellow ? 'double_yellow' : 'solid_white')
    for (let i = 1; i < oncomingLanes; i++) {
      pushMark(sameRightEdge + LANE_W * i, 'dashed_white')
    }
    pushMark(sameRightEdge + LANE_W * oncomingLanes, 'solid_white')
  } else {
    pushMark(sameRightEdge, 'solid_white')
  }

  const dividerX = showOncoming
    ? oncomingSide > 0
      ? sameRightEdge
      : sameLeftEdge
    : null

  return {
    sameDirectionLanes: sameLanes,
    oncomingLanes: showOncoming ? oncomingLanes : 0,
    oncomingSide,
    marks,
    egoLaneHalfWidth: half,
    dividerX,
  }
}

/** Largest gap near image center → dual-carriage divider. */
function findCenterCut(peaks: number[], mid: number): number | null {
  if (peaks.length < 2) return null
  const sorted = [...peaks].sort((a, b) => a - b)
  let bestGap = 0
  let bestCut: number | null = null
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    const cut = (sorted[i] + sorted[i - 1]) / 2
    const centerBias = 1 - Math.min(1, Math.abs(cut - mid) / (mid * 0.7))
    const score = gap * (0.55 + centerBias)
    if (score > bestGap && gap > 14) {
      bestGap = score
      bestCut = cut
    }
  }
  return bestCut
}

function estimateLaneCount(peaks: number[], width: number): number {
  if (peaks.length <= 1) return 2 // urban floor — never report a single lane
  const merged: number[] = [peaks[0]]
  for (let i = 1; i < peaks.length; i++) {
    if (peaks[i] - merged[merged.length - 1] < 18) continue
    merged.push(peaks[i])
  }
  if (merged.length <= 1) return 2
  if (merged.length === 2) {
    const gap = merged[1] - merged[0]
    // Wide gap between two edges ≈ two lanes even without a visible dash
    return gap > width * 0.14 ? 2 : 2
  }

  const gaps: number[] = []
  for (let i = 1; i < merged.length; i++) gaps.push(merged[i] - merged[i - 1])
  gaps.sort((a, b) => a - b)
  const medianGap = gaps[Math.floor(gaps.length / 2)] || width * 0.2
  const fromPeaks = merged.length - 1
  const span = merged[merged.length - 1] - merged[0]
  const fromSpan = Math.max(2, Math.round(span / clamp(medianGap, 28, 100)))
  return clamp(Math.min(fromPeaks, fromSpan), 2, 4)
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
