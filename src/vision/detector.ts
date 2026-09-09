import type { Detection, ObjectClass } from '../world/types'
import { isTrackedClass } from './depth'

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite'

const ALLOWED = new Set([
  'car',
  'truck',
  'bus',
  'motorcycle',
  'person',
  'traffic light',
  'stop sign',
])

/** Higher bars for classes that false-trigger on road glare / signs. */
const MIN_SCORE: Record<string, number> = {
  car: 0.42,
  truck: 0.4,
  bus: 0.4,
  motorcycle: 0.45,
  person: 0.58,
  'traffic light': 0.55,
  'stop sign': 0.5,
}

type ObjectDetectorInstance = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => {
    detections: Array<{
      categories: Array<{ categoryName: string; score: number }>
      boundingBox?: { originX: number; originY: number; width: number; height: number }
    }>
  }
  close: () => void
}

export class VisionDetector {
  private detector: ObjectDetectorInstance | null = null
  private lastTs = -1
  private loading: Promise<void> | null = null

  async init(): Promise<void> {
    if (this.detector) return
    if (this.loading) return this.loading

    this.loading = (async () => {
      const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(WASM_CDN)
      this.detector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'CPU',
        },
        scoreThreshold: 0.35,
        maxResults: 16,
        runningMode: 'VIDEO',
      })
    })()

    try {
      await this.loading
    } finally {
      this.loading = null
    }
  }

  isReady(): boolean {
    return this.detector !== null
  }

  detect(video: HTMLVideoElement, timestampMs: number): Detection[] {
    if (!this.detector) return []

    let ts = timestampMs
    if (ts <= this.lastTs) ts = this.lastTs + 1
    this.lastTs = ts

    const result = this.detector.detectForVideo(video, ts)
    const detections: Detection[] = []

    for (const det of result.detections) {
      const category = det.categories[0]
      if (!category) continue
      const name = category.categoryName
      if (!ALLOWED.has(name) || !isTrackedClass(name)) continue
      if (category.score < (MIN_SCORE[name] ?? 0.45)) continue

      const box = det.boundingBox
      if (!box) continue

      const vw = video.videoWidth || 1
      const vh = video.videoHeight || 1
      const nb = {
        x: box.originX / vw,
        y: box.originY / vh,
        width: box.width / vw,
        height: box.height / vh,
      }

      if (!passesGeometry(name, nb)) continue

      detections.push({
        className: name as ObjectClass,
        score: category.score,
        box: nb,
      })
    }

    return detections
  }

  close() {
    this.detector?.close()
    this.detector = null
    this.lastTs = -1
  }
}

function passesGeometry(
  name: string,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  // Tiny noise blobs
  if (box.width < 0.025 || box.height < 0.03) return false
  if (box.width * box.height < 0.0012) return false

  if (name === 'person') {
    // People aren't in the sky / aren't ultra-wide
    if (box.y < 0.12) return false
    if (box.width / Math.max(0.01, box.height) > 1.1) return false
    // Highway windshield: reject far-horizon speckles
    if (box.height < 0.06 && box.y < 0.35) return false
  }

  if (name === 'traffic light') {
    // Real lights are small; huge boxes are glare / signs
    if (box.height > 0.22 || box.width > 0.12) return false
    if (box.y > 0.55) return false // lights aren't on the road surface
  }

  if (name === 'stop sign') {
    if (box.y > 0.7) return false
  }

  return true
}
