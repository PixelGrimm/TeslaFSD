/** Approximate real-world object heights (meters) for monocular depth. */
const REAL_HEIGHT_M: Record<string, number> = {
  person: 1.7,
  car: 1.45,
  truck: 2.4,
  bus: 3.0,
  motorcycle: 1.35,
  'traffic light': 0.9,
  'stop sign': 0.8,
}

/**
 * Estimate distance from normalized bbox height.
 * Uses pinhole model with an assumed vertical FOV (~55°) and image height = 1.
 */
export function estimateDepthMeters(className: string, bboxHeightNorm: number): number {
  const realH = REAL_HEIGHT_M[className] ?? 1.5
  const h = Math.max(bboxHeightNorm, 0.02)
  // focal_y ≈ 1 / (2 * tan(vfov/2)); vfov≈55° → ~0.96
  const focalY = 0.96
  const distance = (realH * focalY) / h
  return Math.min(Math.max(distance, 3), 120)
}

/** Lateral offset in meters from normalized bbox center X and distance. */
export function estimateLateralMeters(bboxCenterXNorm: number, distanceM: number): number {
  // Approximate hfov ~70°
  const halfWidthAtDist = distanceM * Math.tan((70 * Math.PI) / 360)
  // Image left (x < 0.5) → world −X (left of ego when chase cam looks forward).
  return (bboxCenterXNorm - 0.5) * 2 * halfWidthAtDist
}

export function isTrackedClass(name: string): boolean {
  return name in REAL_HEIGHT_M
}
