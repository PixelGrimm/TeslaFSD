/**
 * Zebra / pelican crossing — strict classical CV.
 * Requires a short horizontal stripe band with a stable period;
 * lane dashes and random texture should not stick forever.
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

  // Near–mid road only (avoid far clutter / building facades)
  const y0 = Math.floor(h * 0.48)
  const y1 = Math.floor(h * 0.78)
  const x0 = Math.floor(w * 0.22)
  const x1 = Math.floor(w * 0.78)

  type RowHit = { y: number; flips: number; period: number; contrast: number; duty: number }
  const hits: RowHit[] = []

  for (let y = y0; y < y1; y++) {
    const row: number[] = []
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      row.push((data[i] + data[i + 1] + data[i + 2]) / 3)
    }

    let sum = 0
    for (const v of row) sum += v
    const mean = sum / row.length
    const thresh = mean + 28 // stronger paint vs asphalt

    let flips = 0
    let brightCount = 0
    let prev = row[0] > thresh
    for (let i = 1; i < row.length; i++) {
      const bright = row[i] > thresh
      if (bright) brightCount++
      if (bright !== prev) {
        flips++
        prev = bright
      }
    }
    const duty = brightCount / row.length
    // Zebra: many alternating stripes, roughly half paint
    if (flips < 8 || flips > 18) continue
    if (duty < 0.22 || duty > 0.62) continue

    const period = bestPeriod(row, thresh)
    if (period < 8 || period > 22) continue

    let contrast = 0
    for (let i = 1; i < row.length; i++) contrast += Math.abs(row[i] - row[i - 1])
    contrast /= row.length - 1
    if (contrast < 10) continue

    hits.push({ y, flips, period, contrast, duty })
  }

  if (hits.length < 5) return null

  hits.sort((a, b) => a.y - b.y)
  let bestRun: RowHit[] = []
  let run: RowHit[] = [hits[0]]
  for (let i = 1; i < hits.length; i++) {
    const prev = run[run.length - 1]
    const cur = hits[i]
    const near = cur.y - prev.y <= 2
    const periodOk = Math.abs(cur.period - prev.period) <= 3
    if (near && periodOk) run.push(cur)
    else {
      if (run.length > bestRun.length) bestRun = run
      run = [cur]
    }
  }
  if (run.length > bestRun.length) bestRun = run

  // Contiguous band: thick enough to be a crossing, not a single noisy row,
  // but not the whole road (lane texture / shadows).
  if (bestRun.length < 6 || bestRun.length > 22) return null

  const avgFlips = bestRun.reduce((s, r) => s + r.flips, 0) / bestRun.length
  const avgContrast = bestRun.reduce((s, r) => s + r.contrast, 0) / bestRun.length
  const periodVar =
    bestRun.reduce((s, r) => s + Math.abs(r.period - bestRun[0].period), 0) / bestRun.length
  if (periodVar > 3.5) return null

  const midY = bestRun[Math.floor(bestRun.length / 2)].y
  const conf = Math.min(
    1,
    (bestRun.length / 14) * 0.35 +
      (avgFlips / 12) * 0.35 +
      Math.min(1, avgContrast / 22) * 0.2 +
      (1 - periodVar / 4) * 0.1,
  )
  if (conf < 0.62) return null

  const t = (midY - y0) / Math.max(1, y1 - y0)
  const z = 14 + (1 - t) * 28
  const width = 8 + avgFlips * 0.12
  return { z, width, confidence: conf }
}

function bestPeriod(row: number[], thresh: number): number {
  const binary = row.map((v) => (v > thresh ? 1 : 0))
  const n = binary.length
  let bestLag = 0
  let bestScore = -1
  for (let lag = 8; lag <= 22; lag++) {
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
  return bestScore > 0.62 ? bestLag : 0
}

detectZebraCrossing._c = document.createElement('canvas')
detectZebraCrossing._ctx = detectZebraCrossing._c.getContext('2d', {
  willReadFrequently: true,
})!
