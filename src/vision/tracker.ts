import type { Detection } from '../world/types'

interface Track {
  id: number
  className: Detection['className']
  score: number
  box: Detection['box']
  /** EMA-smoothed box for stable world placement */
  smoothBox: Detection['box']
  /** Constant-velocity prediction (DeepSORT-lite). */
  vx: number
  vy: number
  vw: number
  vh: number
  hits: number
  misses: number
  classHits: number
}

function iou(a: Detection['box'], b: Detection['box']): number {
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height
  const ix1 = Math.max(a.x, b.x)
  const iy1 = Math.max(a.y, b.y)
  const ix2 = Math.min(ax2, bx2)
  const iy2 = Math.min(ay2, by2)
  const iw = Math.max(0, ix2 - ix1)
  const ih = Math.max(0, iy2 - iy1)
  const inter = iw * ih
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

function centerDist(a: Detection['box'], b: Detection['box']): number {
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2
  return Math.hypot(ax - bx, ay - by)
}

function lerpBox(
  a: Detection['box'],
  b: Detection['box'],
  t: number,
): Detection['box'] {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  }
}

function predictBox(t: Track): Detection['box'] {
  return {
    x: t.smoothBox.x + t.vx,
    y: t.smoothBox.y + t.vy,
    width: Math.max(0.02, t.smoothBox.width + t.vw),
    height: Math.max(0.02, t.smoothBox.height + t.vh),
  }
}

/**
 * DeepSORT-lite: IoU + center distance association against a
 * constant-velocity predicted box, with coasting through brief misses.
 */
export class IoUTracker {
  private nextId = 1
  private tracks: Track[] = []
  private readonly iouThreshold: number
  private readonly maxMisses: number
  private readonly minHits: number
  private readonly smooth: number

  constructor(iouThreshold = 0.28, maxMisses = 8, minHits = 2, smooth = 0.4) {
    this.iouThreshold = iouThreshold
    this.maxMisses = maxMisses
    this.minHits = minHits
    this.smooth = smooth
  }

  update(detections: Detection[]): Array<Detection & { id: number }> {
    const assigned = new Set<number>()
    const matched: Array<Detection & { id: number }> = []

    const order = detections
      .map((d, i) => ({ d, i }))
      .sort((a, b) => b.d.score - a.d.score)

    // Match higher-confidence / longer-lived tracks first
    const trackOrder = [...this.tracks].sort((a, b) => b.hits - a.hits)

    for (const track of trackOrder) {
      const predicted = predictBox(track)
      let bestIdx = -1
      let bestCost = Infinity

      for (const { d, i } of order) {
        if (assigned.has(i)) continue
        const sameClass = d.className === track.className
        const iouPred = iou(predicted, d.box)
        const iouSmooth = iou(track.smoothBox, d.box)
        const overlap = Math.max(iouPred, iouSmooth)
        const dist = centerDist(predicted, d.box)
        // Cost inspired by DeepSORT: low IoU + far center = bad
        const cost = (1 - overlap) + dist * 1.8 + (sameClass ? 0 : 0.35)
        const minIou = sameClass ? this.iouThreshold : 0.5
        if (overlap < minIou && dist > 0.18) continue
        if (cost < bestCost) {
          bestCost = cost
          bestIdx = i
        }
      }

      if (bestIdx >= 0 && bestCost < 1.35) {
        const det = detections[bestIdx]
        assigned.add(bestIdx)

        const prev = track.smoothBox
        track.box = det.box
        track.smoothBox = lerpBox(track.smoothBox, det.box, this.smooth)

        // Update constant-velocity model
        const ax = 0.55
        track.vx = track.vx * (1 - ax) + (track.smoothBox.x - prev.x) * ax
        track.vy = track.vy * (1 - ax) + (track.smoothBox.y - prev.y) * ax
        track.vw = track.vw * (1 - ax) + (track.smoothBox.width - prev.width) * ax
        track.vh = track.vh * (1 - ax) + (track.smoothBox.height - prev.height) * ax

        track.score = track.score * 0.55 + det.score * 0.45
        track.hits += 1
        track.misses = 0

        if (det.className === track.className) {
          track.classHits += 1
        } else if (det.score > track.score + 0.1 && iou(track.smoothBox, det.box) > 0.55) {
          track.className = det.className
          track.classHits = 1
        }

        if (track.hits >= this.minHitsFor(track.className)) {
          matched.push({
            className: track.className,
            score: track.score,
            box: { ...track.smoothBox },
            id: track.id,
          })
        }
      } else {
        track.misses += 1
        // Coast along predicted motion so 3D objects don't pop
        track.smoothBox = predictBox(track)
        track.vx *= 0.92
        track.vy *= 0.92
        track.vw *= 0.85
        track.vh *= 0.85

        const coastLimit = track.className === 'person' ? 4 : 3
        if (track.hits >= this.minHitsFor(track.className) && track.misses <= coastLimit) {
          matched.push({
            className: track.className,
            score: track.score * Math.max(0.5, 1 - track.misses * 0.12),
            box: { ...track.smoothBox },
            id: track.id,
          })
        }
      }
    }

    this.tracks = this.tracks.filter((t) => t.misses <= this.maxMisses)

    for (let i = 0; i < detections.length; i++) {
      if (assigned.has(i)) continue
      const det = detections[i]
      if (det.score < 0.38) continue
      this.tracks.push({
        id: this.nextId++,
        className: det.className,
        score: det.score,
        box: det.box,
        smoothBox: { ...det.box },
        vx: 0,
        vy: 0,
        vw: 0,
        vh: 0,
        hits: 1,
        misses: 0,
        classHits: 1,
      })
    }

    return matched
  }

  private minHitsFor(className: string): number {
    if (className === 'person') return 3
    if (className === 'traffic light') return 3
    return this.minHits
  }

  reset() {
    this.tracks = []
    this.nextId = 1
  }
}
