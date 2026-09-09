/**
 * Classical zebra / pelican crossing detector (ITS-inspired):
 * look for a contiguous mid-road band with a stable stripe period
 * via row flips + autocorrelation, not just a single noisy row.
 */
export function detectZebraCrossing(video: HTMLVideoElement): {
  z: number
  width: number
  confidence: number
} | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null

  const w = 256
  const h = 144
  const c = detectZebraCrossing._c
  const ctx = detectZebraCrossing._ctx
  c.width = w
  c.height = h
  ctx.drawImage(video, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  const y0 = Math.floor(h * 0.38)
  const y1 = Math.floor(h * 0.72)
  const x0 = Math.floor(w * 0.16)
  const x1 = Math.floor(w * 0.84)

  type RowHit = { y: number; flips: number; period: number; contrast: number }
  const hits: RowHit[] = []

  for (let y = y0; y < y1; y++) {
    const row: number[] = []
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      row.push((data[i] + data[i + 1] + data[i + 2]) / 3)
    }

    // Local adaptive threshold (road asphalt vs paint)
    let sum = 0
    for (const v of row) sum += v
    const mean = sum / row.length
    const thresh = mean + 18

    let flips = 0
    let prev = row[0] > thresh
    for (let i = 1; i < row.length; i++) {
      const bright = row[i] > thresh
      if (bright !== prev) {
        flips++
        prev = bright
      }
    }

    // Stripe period via autocorrelation peak in plausible zebra spacing
    const period = bestPeriod(row, thresh)
    if (flips < 5 || flips > 22 || period < 6 || period > 28) continue

    let contrast = 0
    let n = 0
    for (let i = 1; i < row.length; i++) {
      contrast += Math.abs(row[i] - row[i - 1])
      n++
    }
    contrast /= Math.max(1, n)

    if (contrast < 6) continue
    hits.push({ y, flips, period, contrast })
  }

  if (hits.length < 3) return null

  // Find longest run of rows with similar period (connected stripe field)
  hits.sort((a, b) => a.y - b.y)
  let bestRun: RowHit[] = []
  let run: RowHit[] = [hits[0]]
  for (let i = 1; i < hits.length; i++) {
    const prev = run[run.length - 1]
    const cur = hits[i]
    const near = cur.y - prev.y <= 3
    const periodOk = Math.abs(cur.period - prev.period) <= 5
    if (near && periodOk) {
      run.push(cur)
    } else {
      if (run.length > bestRun.length) bestRun = run
      run = [cur]
    }
  }
  if (run.length > bestRun.length) bestRun = run

  if (bestRun.length < 4) return null

  const avgFlips = bestRun.reduce((s, r) => s + r.flips, 0) / bestRun.length
  const avgContrast = bestRun.reduce((s, r) => s + r.contrast, 0) / bestRun.length
  const midY = bestRun[Math.floor(bestRun.length / 2)].y

  const conf = Math.min(
    1,
    (bestRun.length / 10) * 0.45 + (avgFlips / 14) * 0.35 + Math.min(1, avgContrast / 18) * 0.2,
  )
  if (conf < 0.42) return null

  const t = (midY - y0) / Math.max(1, y1 - y0)
  const z = 16 + (1 - t) * 38
  const width = 7.5 + avgFlips * 0.18
  return { z, width, confidence: conf }
}

/** Dominant bright/dark spacing along a row (pixels). */
function bestPeriod(row: number[], thresh: number): number {
  const binary = row.map((v) => (v > thresh ? 1 : 0))
  const n = binary.length
  let bestLag = 0
  let bestScore = -1
  for (let lag = 6; lag <= 28; lag++) {
    let same = 0
    let count = 0
    for (let i = 0; i < n - lag; i++) {
      same += binary[i] === binary[i + lag] ? 1 : 0
      count++
    }
    const score = count ? same / count : 0
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  return bestScore > 0.55 ? bestLag : 0
}

detectZebraCrossing._c = document.createElement('canvas')
detectZebraCrossing._ctx = detectZebraCrossing._c.getContext('2d', {
  willReadFrequently: true,
})!
