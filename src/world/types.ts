export type ObjectClass =
  | 'car'
  | 'truck'
  | 'bus'
  | 'motorcycle'
  | 'person'
  | 'traffic light'
  | 'stop sign'

export type LaneMarkKind = 'solid_white' | 'dashed_white' | 'double_yellow' | 'solid_yellow'

export interface Detection {
  className: ObjectClass
  score: number
  /** Normalized bbox [0,1]: x, y, width, height (top-left origin). */
  box: { x: number; y: number; width: number; height: number }
}

export interface WorldObject {
  id: number
  className: ObjectClass
  score: number
  /** Meters: +X right, +Z forward from ego. */
  x: number
  z: number
  /** Smoothed display position. */
  displayX: number
  displayZ: number
  opacity: number
  lastSeen: number
  /** True when vehicle is in opposing flow / approaching from ahead in opposite lane. */
  oncoming: boolean
  /** Recent depth change (m/s); negative means closing. */
  approachRate: number
}

export interface LaneMark {
  /** Lateral offset in meters from ego center (near camera / ego). */
  x: number
  /**
   * Lateral offset at the far end of the road.
   * When different from x, the mark converges (merge / taper).
   */
  xFar?: number
  kind: LaneMarkKind
  /** 0–1 fade while a mark is merging away. */
  opacity?: number
}

export interface LaneState {
  /** Number of same-direction lanes detected (1–4). */
  sameDirectionLanes: number
  /** Opposing-direction lanes left of the divider (0 if none). */
  oncomingLanes: number
  /** Detected marks sorted left→right in meters. */
  marks: LaneMark[]
  /** Ego lane half-width for blue path carpet. */
  egoLaneHalfWidth: number
  /** X of opposing divider (double yellow), if any. */
  dividerX: number | null
}

export interface EgoMotion {
  /** Estimated forward speed in m/s from camera optical flow + device motion. */
  speedMps: number
  /** Display speed in mph. */
  speedMph: number
  /** True when clearly moving. */
  moving: boolean
}

/** Detected roadside speed-limit sign for 3D placement. */
export interface SpeedLimitSignState {
  value: number
  /** World X (meters); negative = left of ego. */
  x: number
  /** Forward distance meters. */
  z: number
  /** Smoothed display pose. */
  displayX: number
  displayZ: number
  opacity: number
}

export interface PerceptionStats {
  fps: number
  inferMs: number
  objectCount: number
  oncomingCount: number
  laneCount: number
}

/** Image-space debug drawn on the live camera PiP. */
export interface OverlayDetection {
  id: number
  className: ObjectClass
  score: number
  box: { x: number; y: number; width: number; height: number }
  oncoming: boolean
}

export interface OverlayLaneLine {
  x: number
  color: 'white' | 'yellow'
  style: 'solid' | 'dashed'
}

export interface PerceptionOverlay {
  detections: OverlayDetection[]
  /** Classified lane lines for overlay (max ~6). */
  lines: OverlayLaneLine[]
  /** Normalized [0,1] x of white paint peaks. */
  whitePeaks: number[]
  /** Normalized [0,1] x of yellow paint peaks. */
  yellowPeaks: number[]
  /** Sample band in normalized y. */
  bandTop: number
  bandBottom: number
  sameLanes: number
  oncomingLanes: number
  hasYellow: boolean
  /** Estimated vanishing-point x (handles tilted / off-center camera). */
  vpX?: number
}
