export interface CurbPoint {
  /** Meters: +X right of ego, +Z forward. */
  x: number
  z: number
}

export interface CurbState {
  left: CurbPoint[]
  right: CurbPoint[]
  /** Smoothed half-width of drivable surface near ego. */
  roadHalfWidth: number
}
