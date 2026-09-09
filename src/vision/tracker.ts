import type { Detection } from '../world/types'

interface Track {
  id: number
  className: Detection['className']
  score: number
  box: Detection['box']
  hits: number
  misses: number
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

/**
 * IoU tracker that only emits confirmed tracks (minHits),
 * so one-frame glare flashes never spawn world objects.
 */
export class IoUTracker {
  private nextId = 1
  private tracks: Track[] = []
  private readonly iouThreshold: number
  private readonly maxMisses: number
  private readonly minHits: number

  constructor(iouThreshold = 0.28, maxMisses = 4, minHits = 3) {
    this.iouThreshold = iouThreshold
    this.maxMisses = maxMisses
    this.minHits = minHits
  }

  update(detections: Detection[]): Array<Detection & { id: number }> {
    const assigned = new Set<number>()
    const matched: Array<Detection & { id: number }> = []

    for (const track of this.tracks) {
      let bestIdx = -1
      let bestIou = this.iouThreshold
      for (let i = 0; i < detections.length; i++) {
        if (assigned.has(i)) continue
        if (detections[i].className !== track.className) continue
        const score = iou(track.box, detections[i].box)
        if (score > bestIou) {
          bestIou = score
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        const det = detections[bestIdx]
        assigned.add(bestIdx)
        track.box = det.box
        track.score = det.score
        track.hits += 1
        track.misses = 0
        if (track.hits >= this.minHits) {
          matched.push({ ...det, id: track.id })
        }
      } else {
        track.misses += 1
      }
    }

    this.tracks = this.tracks.filter((t) => t.misses <= this.maxMisses)

    for (let i = 0; i < detections.length; i++) {
      if (assigned.has(i)) continue
      const det = detections[i]
      const id = this.nextId++
      this.tracks.push({
        id,
        className: det.className,
        score: det.score,
        box: det.box,
        hits: 1,
        misses: 0,
      })
      // Not emitted until confirmed over multiple frames
    }

    return matched
  }

  reset() {
    this.tracks = []
    this.nextId = 1
  }
}
