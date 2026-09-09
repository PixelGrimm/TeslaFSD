import type { Detection } from '../world/types'

interface Track {
  id: number
  className: Detection['className']
  score: number
  box: Detection['box']
  /** EMA-smoothed box for stable world placement */
  smoothBox: Detection['box']
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

/**
 * IoU tracker with confirmation + EMA box smoothing to cut flicker.
 */
export class IoUTracker {
  private nextId = 1
  private tracks: Track[] = []
  private readonly iouThreshold: number
  private readonly maxMisses: number
  private readonly minHits: number
  private readonly smooth: number

  constructor(iouThreshold = 0.3, maxMisses = 5, minHits = 3, smooth = 0.35) {
    this.iouThreshold = iouThreshold
    this.maxMisses = maxMisses
    this.minHits = minHits
    this.smooth = smooth
  }

  update(detections: Detection[]): Array<Detection & { id: number }> {
    const assigned = new Set<number>()
    const matched: Array<Detection & { id: number }> = []

    // Prefer high-score dets when matching
    const order = detections
      .map((d, i) => ({ d, i }))
      .sort((a, b) => b.d.score - a.d.score)

    for (const track of this.tracks) {
      let bestIdx = -1
      let bestIou = this.iouThreshold
      for (const { d, i } of order) {
        if (assigned.has(i)) continue
        // Allow brief class flicker only if IoU is very high
        const sameClass = d.className === track.className
        const score = iou(track.smoothBox, d.box)
        const need = sameClass ? bestIou : Math.max(bestIou, 0.55)
        if (score > need) {
          bestIou = score
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        const det = detections[bestIdx]
        assigned.add(bestIdx)
        track.box = det.box
        track.smoothBox = lerpBox(track.smoothBox, det.box, this.smooth)
        track.score = track.score * 0.6 + det.score * 0.4
        track.hits += 1
        track.misses = 0

        if (det.className === track.className) {
          track.classHits += 1
        } else if (det.score > track.score + 0.12 && bestIou > 0.55) {
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
        // Coast: keep last smooth box, still emit briefly so world doesn't pop
        if (track.hits >= this.minHitsFor(track.className) && track.misses <= 2) {
          matched.push({
            className: track.className,
            score: track.score * 0.9,
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
      if (det.score < 0.4) continue
      const id = this.nextId++
      this.tracks.push({
        id,
        className: det.className,
        score: det.score,
        box: det.box,
        smoothBox: { ...det.box },
        hits: 1,
        misses: 0,
        classHits: 1,
      })
    }

    return matched
  }

  private minHitsFor(className: string): number {
    if (className === 'person' || className === 'traffic light') return 4
    return this.minHits
  }

  reset() {
    this.tracks = []
    this.nextId = 1
  }
}
