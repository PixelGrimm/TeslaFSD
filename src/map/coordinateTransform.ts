/**
 * Utilities to transform between:
 * - Vision coordinate system (meters from ego car, x/z)
 * - Geographic coordinates (latitude/longitude)
 */

const EARTH_RADIUS_M = 6378137 // Earth's radius in meters (WGS84)

/**
 * Convert relative position (meters from ego) to absolute lat/long.
 * 
 * @param egoLat - Ego car latitude
 * @param egoLon - Ego car longitude
 * @param egoHeading - Ego car heading in degrees (0 = North, 90 = East)
 * @param relativeX - Meters right of ego car (positive = right, negative = left)
 * @param relativeZ - Meters forward of ego car (negative = forward)
 * @returns {lat, lon} - Absolute position
 */
export function relativeToLatLon(
  egoLat: number,
  egoLon: number,
  egoHeading: number,
  relativeX: number,
  relativeZ: number
): { lat: number; lon: number } {
  // Convert relative coordinates to distance forward and right in ego's reference frame
  const distanceForward = -relativeZ // Vision uses -Z as forward
  const distanceRight = relativeX

  // Convert heading to radians
  const headingRad = (egoHeading * Math.PI) / 180

  // Rotate coordinates by heading to get north/east offsets
  const offsetNorth = distanceForward * Math.cos(headingRad) - distanceRight * Math.sin(headingRad)
  const offsetEast = distanceForward * Math.sin(headingRad) + distanceRight * Math.cos(headingRad)

  // Convert meter offsets to degrees
  const deltaLat = (offsetNorth / EARTH_RADIUS_M) * (180 / Math.PI)
  const deltaLon = (offsetEast / (EARTH_RADIUS_M * Math.cos((egoLat * Math.PI) / 180))) * (180 / Math.PI)

  return {
    lat: egoLat + deltaLat,
    lon: egoLon + deltaLon,
  }
}

/**
 * Calculate distance in meters between two lat/lon points.
 * Uses Haversine formula.
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_M * c
}

/**
 * Estimate heading from GPS coordinates (if device doesn't provide it).
 * Returns bearing from point1 to point2 in degrees.
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180)
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(dLon)

  const bearing = (Math.atan2(y, x) * 180) / Math.PI
  return (bearing + 360) % 360 // Normalize to 0-360
}
