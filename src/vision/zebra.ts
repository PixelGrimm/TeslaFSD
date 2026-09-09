/**
 * Detect zebra / pelican crossing stripes in the mid-road band.
 */
export function detectZebraCrossing(video: HTMLVideoElement): {
  z: number
  width: number
  confidence: number
} | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null

  const w = 240
  const h = 135
  const c = detectZebraCrossing._c
  const ctx = detectZebraCrossing._ctx
  c.width = w
  c.height = h
  ctx.drawImage(video, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  // Mid-distance horizontal band
  const y0 = Math.floor(h * 0.42)
  const y1 = Math.floor(h * 0.68)
  const x0 = Math.floor(w * 0.18)
  const x1 = Math.floor(w * 0.82)

  // Row-wise brightness; look for alternating stripe period
  let bestY = -1
  let bestScore = 0
  for (let y = y0; y < y1; y++) {
    const row: number[] = []
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      row.push((data[i] + data[i + 1] + data[i + 2]) / 3)
    }
    // Count bright↔dark transitions across the row
    let flips = 0
    let prevBright = row[0] > 150
    for (let i = 2; i < row.length; i += 2) {
      const bright = row[i] > 150
      if (bright !== prevBright) {
        flips++
        prevBright = bright
      }
    }
    // Zebra typically 6–16 stripe edges across the road width
    if (flips >= 6 && flips <= 20) {
      const score = flips
      if (score > bestScore) {
        bestScore = score
        bestY = y
      }
    }
  }

  if (bestY < 0 || bestScore < 7) return null

  // Map image y → approximate depth (near bottom = closer)
  const t = (bestY - y0) / Math.max(1, y1 - y0)
  const z = 18 + (1 - t) * 35
  return { z, width: 8 + bestScore * 0.15, confidence: Math.min(1, bestScore / 14) }
}

detectZebraCrossing._c = document.createElement('canvas')
detectZebraCrossing._ctx = detectZebraCrossing._c.getContext('2d', {
  willReadFrequently: true,
})!
