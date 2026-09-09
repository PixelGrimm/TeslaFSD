import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CurbDetector } from '../vision/curbs'
import type { CurbState } from '../vision/curbTypes'
import { estimateDepthMeters, estimateLateralMeters } from '../vision/depth'
import { VisionDetector } from '../vision/detector'
import { LaneDetector, LaneLayoutAnimator } from '../vision/lanes'
import { EgoMotionEstimator } from '../vision/motion'
import { SpeedLimitDetector } from '../vision/speedLimit'
import { IoUTracker } from '../vision/tracker'
import type {
  EgoMotion,
  LaneState,
  OverlayDetection,
  PerceptionOverlay,
  PerceptionStats,
  SpeedLimitSignState,
  WorldObject,
} from './types'

const INFER_INTERVAL_MS = 90
const LANE_INTERVAL_MS = 120
const CURB_INTERVAL_MS = 140
const LIMIT_INTERVAL_MS = 200
const LERP = 0.22
const STALE_MS = 380
const VEHICLE_CLASSES = new Set(['car', 'truck', 'bus', 'motorcycle'])

const DEFAULT_LANES: LaneState = {
  sameDirectionLanes: 2,
  oncomingLanes: 0,
  marks: [
    { x: -1.8, kind: 'solid_white' },
    { x: 1.8, kind: 'dashed_white' },
    { x: 5.4, kind: 'solid_white' },
  ],
  egoLaneHalfWidth: 1.8,
  dividerX: null,
}

const DEFAULT_CURBS: CurbState = {
  left: [
    { x: -3.2, z: 4 },
    { x: -3.2, z: 15 },
    { x: -3.2, z: 30 },
    { x: -3.2, z: 45 },
  ],
  right: [
    { x: 3.2, z: 4 },
    { x: 3.2, z: 15 },
    { x: 3.2, z: 30 },
    { x: 3.2, z: 45 },
  ],
  roadHalfWidth: 3.2,
}

export function useWorldState(videoRef: RefObject<HTMLVideoElement | null>, active: boolean) {
  const [objects, setObjects] = useState<WorldObject[]>([])
  const [lanes, setLanes] = useState<LaneState>(DEFAULT_LANES)
  const [curbs, setCurbs] = useState<CurbState>(DEFAULT_CURBS)
  const [speedLimit, setSpeedLimit] = useState<number | null>(null)
  const [speedSign, setSpeedSign] = useState<SpeedLimitSignState | null>(null)
  const [motion, setMotion] = useState<EgoMotion>({
    speedMps: 0,
    speedMph: 0,
    moving: false,
  })
  const [stats, setStats] = useState<PerceptionStats>({
    fps: 0,
    inferMs: 0,
    objectCount: 0,
    oncomingCount: 0,
    laneCount: 1,
  })
  const [modelReady, setModelReady] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<PerceptionOverlay>({
    detections: [],
    lines: [],
    whitePeaks: [],
    yellowPeaks: [],
    bandTop: 0.55,
    bandBottom: 0.92,
    sameLanes: 2,
    oncomingLanes: 0,
    hasYellow: false,
  })

  const detectorRef = useRef(new VisionDetector())
  const trackerRef = useRef(new IoUTracker())
  const laneDetRef = useRef(new LaneDetector())
  const laneAnimRef = useRef(new LaneLayoutAnimator())
  const curbDetRef = useRef(new CurbDetector())
  const limitDetRef = useRef(new SpeedLimitDetector())
  const motionRef = useRef(new EgoMotionEstimator())
  const objectsRef = useRef<Map<number, WorldObject>>(new Map())
  const overlayDetsRef = useRef<OverlayDetection[]>([])
  const lanesRawRef = useRef<LaneState>(DEFAULT_LANES)
  const lanesRef = useRef<LaneState>(DEFAULT_LANES)
  const curbsRef = useRef<CurbState>(DEFAULT_CURBS)
  const speedSignRef = useRef<SpeedLimitSignState | null>(null)
  const speedRef = useRef(0)
  const rafRef = useRef(0)
  const lastInferRef = useRef(0)
  const lastLaneRef = useRef(0)
  const lastCurbRef = useRef(0)
  const lastLimitRef = useRef(0)
  const lastMotionTs = useRef(0)
  const frameTimesRef = useRef<number[]>([])
  const lastPublishRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await detectorRef.current.init()
        if (!cancelled) setModelReady(true)
      } catch (err) {
        if (!cancelled) {
          setModelError(err instanceof Error ? err.message : 'Failed to load detector')
        }
      }
    })()
    return () => {
      cancelled = true
      detectorRef.current.close()
      motionRef.current.stopDeviceMotion()
      laneDetRef.current.stopOrientationAssist()
    }
  }, [])

  useEffect(() => {
    if (!active) return
    motionRef.current.startDeviceMotion()
    motionRef.current.reset()
    laneDetRef.current.startOrientationAssist()
    return () => {
      motionRef.current.stopDeviceMotion()
      laneDetRef.current.stopOrientationAssist()
    }
  }, [active])

  const tick = useCallback(
    (now: number) => {
      rafRef.current = requestAnimationFrame(tick)
      if (!active) return

      const video = videoRef.current
      if (!video || video.readyState < 2 || video.videoWidth === 0) return

      const dt = lastMotionTs.current ? (now - lastMotionTs.current) / 1000 : 0.05
      lastMotionTs.current = now
      const speedMps = motionRef.current.update(video, dt)
      speedRef.current = speedMps

      if (now - lastLaneRef.current >= LANE_INTERVAL_MS) {
        lastLaneRef.current = now
        lanesRawRef.current = laneDetRef.current.detect(video)
      }
      // Always animate toward latest raw layout (smooth merges)
      lanesRef.current = laneAnimRef.current.update(lanesRawRef.current, dt)

      if (now - lastCurbRef.current >= CURB_INTERVAL_MS) {
        lastCurbRef.current = now
        curbsRef.current = curbDetRef.current.detect(video)
      }

      if (now - lastLimitRef.current >= LIMIT_INTERVAL_MS) {
        lastLimitRef.current = now
        const det = limitDetRef.current.detect(video)
        setSpeedLimit(det?.value ?? null)

        if (det) {
          const markXs = lanesRef.current.marks.map((m) => m.x)
          const leftEdge = markXs.length ? Math.min(...markXs) : -curbsRef.current.roadHalfWidth
          const rightEdge = markXs.length ? Math.max(...markXs) : curbsRef.current.roadHalfWidth
          const roadside = det.side < 0 ? leftEdge - 1.15 : rightEdge + 1.15
          const z = Math.min(42, Math.max(10, 3.1 / Math.max(0.045, det.imageH)))
          const prev = speedSignRef.current
          if (prev && prev.value === det.value) {
            prev.x = roadside
            prev.z = z * 0.35 + prev.z * 0.65
            prev.opacity = 1
          } else {
            speedSignRef.current = {
              value: det.value,
              x: roadside,
              z,
              displayX: roadside,
              displayZ: z,
              opacity: 1,
            }
          }
        } else if (speedSignRef.current) {
          speedSignRef.current.opacity = Math.max(0, speedSignRef.current.opacity - 0.08)
          if (speedSignRef.current.opacity <= 0.05) speedSignRef.current = null
        }
      }

      if (speedSignRef.current) {
        const s = speedSignRef.current
        if (speedMps > 0.8) s.z = Math.max(3.5, s.z - speedMps * dt)
        s.displayX += (s.x - s.displayX) * LERP
        s.displayZ += (s.z - s.displayZ) * LERP
        if (s.z < 5.5) s.opacity = Math.min(s.opacity, Math.max(0, (s.z - 3.5) / 2))
        if (s.opacity <= 0.02) speedSignRef.current = null
      }

      const map = objectsRef.current
      for (const obj of map.values()) {
        obj.displayX += (obj.x - obj.displayX) * LERP
        obj.displayZ += (obj.z - obj.displayZ) * LERP
        const age = now - obj.lastSeen
        obj.opacity = age > STALE_MS ? Math.max(0, 1 - (age - STALE_MS) / 400) : 1
        if (obj.opacity <= 0) map.delete(obj.id)
      }

      if (detectorRef.current.isReady() && now - lastInferRef.current >= INFER_INTERVAL_MS) {
        lastInferRef.current = now
        const t0 = performance.now()
        const raw = detectorRef.current.detect(video, now)
        const tracked = trackerRef.current.update(raw)
        const inferMs = performance.now() - t0
        const lane = lanesRef.current

        for (const det of tracked) {
          let z = estimateDepthMeters(det.className, det.box.height)
          let x = estimateLateralMeters(det.box.x + det.box.width / 2, z)

          // Only drop detections that sit inside the ego car mesh itself
          // (was too aggressive before and hid people standing ahead).
          const insideEgo = Math.abs(x) < 1.0 && z < 1.8
          if (insideEgo) continue

          // Keep close people/objects just ahead of the bumper, not inside the model.
          if (z < 2.5) {
            z = 2.5
            x = estimateLateralMeters(det.box.x + det.box.width / 2, z)
          }

          const existing = map.get(det.id)

          let approachRate = 0
          if (existing) {
            const dtObj = Math.max(0.05, (now - existing.lastSeen) / 1000)
            approachRate = (z - existing.z) / dtObj
          }

          const isVehicle = VEHICLE_CLASSES.has(det.className)
          const leftOfDivider = lane.dividerX != null && x < lane.dividerX - 0.5
          const farLeft = x < -lane.egoLaneHalfWidth - 1.2
          const closingFast = approachRate < -1.5 && z < 45
          const oncoming = isVehicle && (leftOfDivider || (farLeft && closingFast) || (x < -2.5 && closingFast))

          if (existing) {
            existing.x = x
            existing.z = z
            existing.score = det.score
            existing.className = det.className
            existing.lastSeen = now
            existing.opacity = 1
            existing.approachRate = approachRate
            existing.oncoming = oncoming
          } else {
            map.set(det.id, {
              id: det.id,
              className: det.className,
              score: det.score,
              x,
              z,
              displayX: x,
              displayZ: z,
              opacity: 1,
              lastSeen: now,
              oncoming,
              approachRate,
            })
          }
        }

        overlayDetsRef.current = tracked.map((det) => {
          const obj = map.get(det.id)
          return {
            id: det.id,
            className: det.className,
            score: det.score,
            box: det.box,
            oncoming: obj?.oncoming ?? false,
          }
        })

        frameTimesRef.current.push(now)
        frameTimesRef.current = frameTimesRef.current.filter((t) => now - t < 1000)

        let oncomingCount = 0
        for (const o of map.values()) if (o.oncoming) oncomingCount++

        setStats({
          fps: frameTimesRef.current.length,
          inferMs: Math.round(inferMs),
          objectCount: map.size,
          oncomingCount,
          laneCount: lanesRef.current.sameDirectionLanes,
        })
      }

      if (now - lastPublishRef.current >= 33) {
        lastPublishRef.current = now
        setObjects(Array.from(map.values()).map((o) => ({ ...o })))
        setLanes({
          ...lanesRef.current,
          marks: lanesRef.current.marks.map((m) => ({ ...m })),
        })
        setCurbs({
          roadHalfWidth: curbsRef.current.roadHalfWidth,
          left: curbsRef.current.left.map((p) => ({ ...p })),
          right: curbsRef.current.right.map((p) => ({ ...p })),
        })
        const mph = speedRef.current * 2.23694
        setMotion({
          speedMps: speedRef.current,
          speedMph: Math.round(mph),
          moving: speedRef.current > 0.5,
        })
        const peaks = laneDetRef.current.getOverlayPeaks()
        setOverlay({
          detections: overlayDetsRef.current.map((d) => ({ ...d, box: { ...d.box } })),
          lines: peaks.lines.map((l) => ({ ...l })),
          whitePeaks: [...peaks.whitePeaks],
          yellowPeaks: [...peaks.yellowPeaks],
          bandTop: peaks.bandTop,
          bandBottom: peaks.bandBottom,
          sameLanes: lanesRef.current.sameDirectionLanes,
          oncomingLanes: lanesRef.current.oncomingLanes,
          hasYellow: peaks.hasYellow,
          vpX: peaks.vpX,
        })
        setSpeedSign(speedSignRef.current ? { ...speedSignRef.current } : null)
      }
    },
    [active, videoRef],
  )

  useEffect(() => {
    if (!active || !modelReady) return
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [active, modelReady, tick])

  return {
    objects,
    lanes,
    curbs,
    motion,
    stats,
    overlay,
    speedLimit,
    speedSign,
    modelReady,
    modelError,
  }
}
