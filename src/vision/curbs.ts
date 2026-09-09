import type { CurbPoint, CurbState } from './curbTypes'

const MIN_HALF = 2.6
const MAX_HALF = 5.5
const DEFAULT_HALF = 3.2

function parallelCurbs(half: number): CurbState {
  const left: CurbPoint[] = []
  const right: CurbPoint[] = []
  for (let z = 3; z <= 48; z += 2.5) {
    left.push({ x: -half, z })
    right.push({ x: half, z })
  }
  return { left, right, roadHalfWidth: half }
}

/**
 * Stable curb model: almost-parallel left/right edges.
 * Camera only slowly adjusts road half-width — no wild polylines.
 */
export class CurbDetector {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private readonly w = 200
  private readonly h = 112
  private half = DEFAULT_HALF
  private targetHalf = DEFAULT_HALF
  private stableFrames = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.w
    this.canvas.height = this.h
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D context unavailable')
    this.ctx = ctx
  }

  detect(video: HTMLVideoElement): CurbState {
    if (video.readyState < 2 || video.videoWidth === 0) {
      return parallelCurbs(this.half)
    }

    this.ctx.drawImage(video, 0, 0, this.w, this.h)
    const { data } = this.ctx.getImageData(0, 0, this.w, this.h)

    // Only sample the near band (bottom) — far rows caused angled glitch bars.
    const samples: number[] = []
    for (const yn of [0.88, 0.82, 0.76]) {
      const y = Math.min(this.h - 2, Math.floor(this.h * yn))
      const mid = Math.floor(this.w * 0.5)
      const z = 5 + (0.9 - yn) * 20

      const leftPx = walkEdge(data, this.w, y, mid, -1)
      const rightPx = walkEdge(data, this.w, y, mid, 1)
      if (leftPx == null || rightPx == null) continue

      const xL = Math.abs(pixelToLateral(leftPx, this.w, z))
      const xR = Math.abs(pixelToLateral(rightPx, this.w, z))

      // Reject absurd / asymmetric readings (person, furniture, reflections).
      if (xL < MIN_HALF || xR < MIN_HALF) continue
      if (xL > MAX_HALF + 1.5 || xR > MAX_HALF + 1.5) continue
      if (Math.abs(xL - xR) > 2.2) continue

      samples.push((xL + xR) / 2)
    }

    if (samples.length >= 2) {
      samples.sort((a, b) => a - b)
      const median = samples[Math.floor(samples.length / 2)]
      const clamped = clamp(median, MIN_HALF, MAX_HALF)

      // Require agreement before moving the target.
      if (Math.abs(clamped - this.targetHalf) < 0.35) {
        this.stableFrames++
      } else if (Math.abs(clamped - this.half) < 0.9) {
        this.stableFrames = Math.max(0, this.stableFrames - 1)
        if (this.stableFrames < 4) {
          this.targetHalf = this.targetHalf * 0.85 + clamped * 0.15
        }
      } else {
        // Large jump — ignore (glitch).
        this.stableFrames = 0
      }

      if (this.stableFrames >= 3) {
        this.targetHalf = this.targetHalf * 0.7 + clamped * 0.3
      }
    } else {
      this.stableFrames = Math.max(0, this.stableFrames - 1)
    }

    // Very slow ease toward target so curbs don't jitter frame-to-frame.
    this.half += (this.targetHalf - this.half) * 0.04
    if (Math.abs(this.half - this.targetHalf) < 0.02) this.half = this.targetHalf

    return parallelCurbs(this.half)
  }
}

function walkEdge(
  data: Uint8ClampedArray,
  w: number,
  y: number,
  startX: number,
  dir: -1 | 1,
): number | null {
  let lastRoad = startX
  let nonRoadRun = 0

  for (let x = startX; x > 6 && x < w - 6; x += dir) {
    const i = (y * w + x) * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (isRoadPixel(r, g, b)) {
      lastRoad = x
      nonRoadRun = 0
    } else {
      nonRoadRun++
      if (nonRoadRun >= 4) return lastRoad
    }
  }
  return lastRoad !== startX ? lastRoad : null
}

function isRoadPixel(r: number, g: number, b: number): boolean {
  const bright = (r + g + b) / 3
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sat = max === 0 ? 0 : (max - min) / max

  if (g > r + 15 && g > b + 10 && g > 55) return false
  if (bright > 185 && sat < 0.18) return false
  if (bright < 30) return false
  // Skin / person in frame — treat as non-road so we don't walk through them as curb.
  if (r > 90 && g > 60 && b > 45 && r > b + 15 && r > g + 5 && sat > 0.15 && bright < 200) {
    return false
  }

  return bright > 45 && bright < 165 && sat < 0.32
}

function pixelToLateral(px: number, w: number, z: number): number {
  const norm = px / w - 0.5
  return norm * 2 * z * Math.tan((70 * Math.PI) / 360)
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}
