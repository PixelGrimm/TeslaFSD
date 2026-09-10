import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CurbDetector } from '../vision/curbs'
import type { CurbState } from '../vision/curbTypes'
import { estimateDepthMeters, estimateLateralMeters } from '../vision/depth'
import { VisionDetector } from '../vision/detector'
import { LaneDetector, LaneLayoutAnimator } from '../vision/lanes'
import { EgoMotionEstimator } from '../vision/motion'
import { SpeedLimitDetector } from '../vision/speedLimit'
import { sampleTrafficLightSignal } from '../vision/trafficLight'
import { IoUTracker } from '../vision/tracker'
import { detectZebraCrossing } from '../vision/zebra'
import type {
  EgoMotion,
  LaneState,
  OverlayDetection,
  PerceptionOverlay,
  PerceptionStats,
  SceneExtras,
  SpeedLimitSignState,
  WorldObject,
} from './types'

const INFER_INTERVAL_MS = 90
const LANE_INTERVAL_MS = 120
const CURB_INTERVAL_MS = 140
const LIMIT_INTERVAL_MS = 200
const URBAN_INTERVAL_MS = 280
const LERP = 0.14
const STALE_MS = 450
const VEHICLE_CLASSES = new Set(['car', 'truck', 'bus', 'motorcycle'])

const DEFAULT_LANES: LaneState = {
  sameDirectionLanes: 2,
  oncomingLanes: 0,
  oncomingSide: 1,
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
    { x: 6.8, z: 4 },
    { x: 6.8, z: 15 },
    { x: 6.8, z: 30 },
    { x: 6.8, z: 45 },
  ],
  roadHalfWidth: 5.0,
}

const DEFAULT_EXTRAS: SceneExtras = {
  zebra: null,
}

export function useWorldState(videoRef: RefObject<HTMLVideoElement | null>, active: boolean) {
  const [objects, setObjects] = useState<WorldObject[]>([])
  const [lanes, setLanes] = useState<LaneState>(DEFAULT_LANES)
  const [curbs, setCurbs] = useState<CurbState>(DEFAULT_CURBS)
  const [extras, setExtras] = useState<SceneExtras>(DEFAULT_EXTRAS)
  const [speedLimit, setSpeedLimit] = useState<number | 'national' | null>(null)
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
  const extrasRef = useRef<SceneExtras>({ ...DEFAULT_EXTRAS })
  const zebraSmoothRef = useRef<{ z: number; width: number; opacity: number } | null>(null)
  const speedSignRef = useRef<SpeedLimitSignState | null>(null)
  const speedDetRef = useRef<import('../vision/speedLimit').SpeedLimitDetection | null>(null)
  const speedRef = useRef(0)
  const rafRef = useRef(0)
  const lastInferRef = useRef(0)
  const lastLaneRef = useRef(0)
  const lastCurbRef = useRef(0)
  const lastLimitRef = useRef(0)
  const lastUrbanRef = useRef(0)
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
      lanesRef.current = laneAnimRef.current.update(lanesRawRef.current, dt)

      if (now - lastCurbRef.current >= CURB_INTERVAL_MS) {
        lastCurbRef.current = now
        curbsRef.current = curbDetRef.current.detect(video)
      }

      if (now - lastUrbanRef.current >= URBAN_INTERVAL_MS) {
        lastUrbanRef.current = now
        const zebraHit = detectZebraCrossing(video)
        // Lowered threshold for better visibility, sustained evidence required
        if (zebraHit && zebraHit.confidence >= 0.58) {
          const prev = zebraSmoothRef.current
          const nextOp = Math.min(1, (prev?.opacity ?? 0) + 0.4)
          // Show in 3D with lower buildup requirement
          zebraSmoothRef.current = {
            z: prev ? prev.z * 0.65 + zebraHit.z * 0.35 : zebraHit.z,
            width: prev ? prev.width * 0.7 + zebraHit.width * 0.3 : zebraHit.width,
            opacity: nextOp,
          }
        } else if (zebraSmoothRef.current) {
          zebraSmoothRef.current.opacity = Math.max(0, zebraSmoothRef.current.opacity - 0.25)
          if (zebraSmoothRef.current.opacity < 0.3) zebraSmoothRef.current = null
        }
        extrasRef.current = {
          zebra:
            zebraSmoothRef.current && zebraSmoothRef.current.opacity >= 0.45
              ? { ...zebraSmoothRef.current }
              : null,
        }
      }

      if (zebraSmoothRef.current && speedMps > 0.8) {
        zebraSmoothRef.current.z = Math.max(6, zebraSmoothRef.current.z - speedMps * dt)
        if (zebraSmoothRef.current.z < 8) {
          zebraSmoothRef.current.opacity = Math.min(
            zebraSmoothRef.current.opacity,
            Math.max(0, (zebraSmoothRef.current.z - 5) / 3),
          )
        }
      }

      if (now - lastLimitRef.current >= LIMIT_INTERVAL_MS) {
        lastLimitRef.current = now
        const det = limitDetRef.current.detect(video)
        speedDetRef.current = det
        // Reflect detector HUD (may clear weak false locks)
        setSpeedLimit(limitDetRef.current.getHudValue())

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
          let z = estimateDepthMeters(
            det.className,
            det.box.height,
            det.box.y + det.box.height,
          )
          let x = estimateLateralMeters(det.box.x + det.box.width / 2, z)

          const insideEgo = Math.abs(x) < 1.0 && z < 1.8
          if (insideEgo) continue

          if (z < 2.5) {
            z = 2.5
            x = estimateLateralMeters(det.box.x + det.box.width / 2, z)
          }

          const existing = map.get(det.id)

          if (existing) {
            x = existing.x * 0.55 + x * 0.45
            z = existing.z * 0.55 + z * 0.45
          }

          let approachRate = 0
          if (existing) {
            const dtObj = Math.max(0.05, (now - existing.lastSeen) / 1000)
            approachRate = (z - existing.z) / dtObj
          }

          const isVehicle = VEHICLE_CLASSES.has(det.className)
          const side = lane.oncomingSide
          const acrossDivider =
            lane.dividerX != null &&
            (side > 0 ? x > lane.dividerX + 0.4 : x < lane.dividerX - 0.4)
          const farOncoming =
            side > 0
              ? x > lane.egoLaneHalfWidth + 1.4
              : x < -lane.egoLaneHalfWidth - 1.2
          const closingFast = approachRate < -1.5 && z < 45
          const oncoming =
            isVehicle && (acrossDivider || (farOncoming && closingFast) || (farOncoming && z < 35))

          let signal = existing?.signal
          if (det.className === 'traffic light') {
            signal = sampleTrafficLightSignal(video, det.box, existing?.signal ?? 'off')
          }

          if (existing) {
            existing.x = x
            existing.z = z
            existing.score = det.score
            existing.className = det.className
            existing.lastSeen = now
            existing.opacity = 1
            existing.approachRate = approachRate
            existing.oncoming = oncoming
            if (signal) existing.signal = signal
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
              signal,
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
        setExtras({
          zebra: extrasRef.current.zebra ? { ...extrasRef.current.zebra } : null,
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
          speedLimit: speedDetRef.current?.locked
            ? {
                value: speedDetRef.current.value,
                box: { ...speedDetRef.current.box },
                locked: true,
              }
            : speedDetRef.current
              ? {
                  value: speedDetRef.current.value,
                  box: { ...speedDetRef.current.box },
                  locked: false,
                }
              : null,
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
    extras,
    motion,
    stats,
    overlay,
    speedLimit,
    speedSign,
    modelReady,
    modelError,
  }
}
