/**
 * Estimate forward ego motion from camera.
 * Rejects iPad tilt/pan (which previously spun the wheels).
 */
export class EgoMotionEstimator {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private prev: Uint8ClampedArray | null = null
  private speedMps = 0
  private readonly w = 160
  private readonly h = 90

  private tiltEnergy = 0
  private lastBeta: number | null = null
  private lastGamma: number | null = null
  private orientationHandler: ((e: DeviceOrientationEvent) => void) | null = null
  private motionHandler: ((e: DeviceMotionEvent) => void) | null = null
  private linearAccel = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.w
    this.canvas.height = this.h
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D context unavailable')
    this.ctx = ctx
  }

  startDeviceMotion() {
    if (!this.orientationHandler) {
      this.orientationHandler = (e: DeviceOrientationEvent) => {
        const beta = e.beta ?? 0
        const gamma = e.gamma ?? 0
        if (this.lastBeta != null && this.lastGamma != null) {
          const dPitch = Math.abs(beta - this.lastBeta)
          const dRoll = Math.abs(gamma - this.lastGamma)
          // Handheld camera tilt — suppress optical speed while this is high.
          if (dPitch > 0.35 || dRoll > 0.35) {
            this.tiltEnergy = Math.min(1, this.tiltEnergy + 0.45)
          } else {
            this.tiltEnergy = Math.max(0, this.tiltEnergy - 0.08)
          }
        }
        this.lastBeta = beta
        this.lastGamma = gamma
      }
      window.addEventListener('deviceorientation', this.orientationHandler)
    }

    if (!this.motionHandler) {
      this.motionHandler = (e: DeviceMotionEvent) => {
        // Use linear acceleration only (NOT including gravity — tilting moves gravity axes).
        const ax = e.acceleration?.x ?? 0
        const ay = e.acceleration?.y ?? 0
        const az = e.acceleration?.z ?? 0
        const mag = Math.sqrt(ax * ax + ay * ay + az * az)
        this.linearAccel = mag > 0.6 ? Math.min(mag, 8) : 0
      }
      window.addEventListener('devicemotion', this.motionHandler)
    }
  }

  stopDeviceMotion() {
    if (this.orientationHandler) {
      window.removeEventListener('deviceorientation', this.orientationHandler)
      this.orientationHandler = null
    }
    if (this.motionHandler) {
      window.removeEventListener('devicemotion', this.motionHandler)
      this.motionHandler = null
    }
  }

  /** Returns smoothed speed (m/s). */
  update(video: HTMLVideoElement, dtSec: number): number {
    if (video.readyState < 2 || video.videoWidth === 0) return this.speedMps

    this.ctx.drawImage(video, 0, 0, this.w, this.h)
    const { data } = this.ctx.getImageData(0, 0, this.w, this.h)
    const gray = new Uint8ClampedArray(this.w * this.h)
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0
    }

    if (this.prev && dtSec > 0.01 && dtSec < 0.5) {
      const lower = regionDiff(gray, this.prev, this.w, this.h, 0.55, 1.0, 0.2, 0.8)
      const upper = regionDiff(gray, this.prev, this.w, this.h, 0.05, 0.4, 0.15, 0.85)
      const { dx, dy } = estimateShift(gray, this.prev, this.w, this.h)

      // Camera tilt/pan ≈ uniform motion across the frame (upper ≈ lower).
      // Real driving ≈ stronger change in the near road (lower) than the sky/horizon.
      const parallaxRatio = upper > 0.1 ? lower / upper : lower > 6 ? 2.5 : 0
      const isGlobalTilt =
        this.tiltEnergy > 0.4 ||
        (parallaxRatio < 1.15 && Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) >= 1.5)

      let optical = 0
      if (!isGlobalTilt && lower > 7 && parallaxRatio >= 1.15) {
        optical = Math.min(32, ((lower - 7) / 40) * 18)
      }

      const accelHint = this.linearAccel > 1.0 && this.tiltEnergy < 0.3 ? this.linearAccel * 0.55 : 0
      const measured = Math.max(optical, accelHint)

      const alpha = measured < this.speedMps ? 0.4 : 0.12
      this.speedMps += (measured - this.speedMps) * alpha
      if (this.speedMps < 0.45 || this.tiltEnergy > 0.55) this.speedMps = 0
    }

    this.prev = gray
    return this.speedMps
  }

  reset() {
    this.prev = null
    this.speedMps = 0
    this.tiltEnergy = 0
    this.lastBeta = null
    this.lastGamma = null
  }
}

function regionDiff(
  cur: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  w: number,
  h: number,
  y0n: number,
  y1n: number,
  x0n: number,
  x1n: number,
): number {
  const y0 = Math.floor(h * y0n)
  const y1 = Math.floor(h * y1n)
  const x0 = Math.floor(w * x0n)
  const x1 = Math.floor(w * x1n)
  let sum = 0
  let count = 0
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const idx = y * w + x
      sum += Math.abs(cur[idx] - prev[idx])
      count++
    }
  }
  return count ? sum / count : 0
}

/** Coarse best-shift in a small search window (lower ROI). */
function estimateShift(
  cur: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  w: number,
  h: number,
): { dx: number; dy: number } {
  const y0 = Math.floor(h * 0.55)
  const y1 = h - 4
  const x0 = Math.floor(w * 0.3)
  const x1 = Math.floor(w * 0.7)
  let best = Infinity
  let bestDx = 0
  let bestDy = 0

  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      let err = 0
      let n = 0
      for (let y = y0; y < y1; y += 3) {
        for (let x = x0; x < x1; x += 3) {
          const yy = y + dy
          const xx = x + dx
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue
          err += Math.abs(cur[y * w + x] - prev[yy * w + xx])
          n++
        }
      }
      const mean = n ? err / n : Infinity
      if (mean < best) {
        best = mean
        bestDx = dx
        bestDy = dy
      }
    }
  }
  return { dx: bestDx, dy: bestDy }
}
