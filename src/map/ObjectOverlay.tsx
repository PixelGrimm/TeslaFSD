import { useEffect, useRef } from 'react'
import type { WorldObject } from '../world/types'
import type { GeolocationState } from './useGeolocation'
import { relativeToLatLon } from './coordinateTransform'

interface ObjectOverlayProps {
  objects: WorldObject[]
  geolocation: GeolocationState
}

/**
 * Canvas overlay that renders detected objects on the map.
 * Converts vision coordinates to lat/lon and draws markers.
 */
export function ObjectOverlay({ objects, geolocation }: ObjectOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }

    ctx.clearRect(0, 0, w, h)

    // Only render if we have valid GPS
    if (
      geolocation.latitude === null ||
      geolocation.longitude === null ||
      geolocation.heading === null
    ) {
      return
    }

    const { latitude, longitude, heading } = geolocation

    // Draw detected objects
    for (const obj of objects) {
      // Convert relative vision coordinates to lat/lon
      // Note: In production, this would be used to project to screen coordinates
      // based on current map zoom/pan state
      relativeToLatLon(latitude, longitude, heading, obj.displayX, obj.displayZ)

      // For now, draw simple markers (in a real implementation, 
      // we'd project these to screen coordinates based on map zoom/pan)
      const color = getObjectColor(obj.className, obj.oncoming)
      
      // This is a simplified version - proper implementation would require
      // coordinate projection from lat/lon to screen pixels
      ctx.fillStyle = color
      ctx.shadowBlur = 12
      ctx.shadowColor = color
      
      // Draw at approximate screen position (placeholder)
      const screenX = w / 2 + obj.displayX * 10
      const screenY = h / 2 + obj.displayZ * 10
      
      if (screenX > 0 && screenX < w && screenY > 0 && screenY < h) {
        ctx.beginPath()
        ctx.arc(screenX, screenY, 8, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        
        // Draw label
        ctx.font = '600 10px "Inter", sans-serif'
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.fillText(obj.className, screenX, screenY - 12)
      }
    }
  }, [objects, geolocation])

  return <canvas ref={canvasRef} className="object-overlay" />
}

function getObjectColor(className: string, oncoming: boolean): string {
  if (oncoming) return '#ff9555'
  
  const colors: Record<string, string> = {
    car: '#4f9eff',
    truck: '#70b0ff',
    bus: '#90c5ff',
    motorcycle: '#b0d8ff',
    person: '#10d876',
    'traffic light': '#ffb84d',
    'stop sign': '#ff5757',
  }
  
  return colors[className] ?? '#ffffff'
}
