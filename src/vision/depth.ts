/** Approximate real-world object heights (meters) for monocular depth. */
const REAL_HEIGHT_M: Record<string, number> = {
  person: 1.7,
  car: 1.52,
  truck: 2.65,
  bus: 3.1,
  motorcycle: 1.4,
  'traffic light': 0.85,
  'stop sign': 0.75,
}

/** Per-class scale tweak — bbox height often under/overestimates silhouette. */
const DEPTH_SCALE: Record<string, number> = {
  person: 1.05,
  car: 1.12,
  truck: 1.0,
  bus: 0.95,
  motorcycle: 1.15,
  'traffic light': 1.2,
  'stop sign': 1.15,
}

// iPad rear camera in landscape (mount on dash) — slightly wider than old 55°
const VFOV_RAD = (58 * Math.PI) / 180
const HFOV_RAD = (72 * Math.PI) / 180
const FOCAL_Y = 1 / (2 * Math.tan(VFOV_RAD / 2))

/**
 * Estimate distance from normalized bbox height + bottom contact.
 * Uses pinhole model tuned for iPad landscape FOV.
 */
export function estimateDepthMeters(
  className: string,
  bboxHeightNorm: number,
  bboxBottomYNorm?: number,
): number {
  const realH = REAL_HEIGHT_M[className] ?? 1.5
  const scale = DEPTH_SCALE[className] ?? 1
  const h = Math.max(bboxHeightNorm, 0.025)
  let distance = ((realH * FOCAL_Y) / h) * scale

  // Soft prior: objects whose feet sit lower in the frame are closer
  if (bboxBottomYNorm != null) {
    const groundHint = 4 + (1 - Math.min(1, Math.max(0, bboxBottomYNorm))) * 90
    distance = distance * 0.72 + groundHint * 0.28
  }

  const minZ = className === 'person' ? 2.5 : 4
  const maxZ = className === 'traffic light' || className === 'stop sign' ? 80 : 110
  return Math.min(Math.max(distance, minZ), maxZ)
}

/** Lateral offset in meters from normalized bbox center X and distance. */
export function estimateLateralMeters(bboxCenterXNorm: number, distanceM: number): number {
  const halfWidthAtDist = distanceM * Math.tan(HFOV_RAD / 2)
  // Image left (x < 0.5) → world −X (left of ego when chase cam looks forward).
  return (bboxCenterXNorm - 0.5) * 2 * halfWidthAtDist
}

export function isTrackedClass(name: string): boolean {
  return name in REAL_HEIGHT_M
}
