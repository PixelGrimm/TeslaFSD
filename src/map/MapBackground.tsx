import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { GeolocationState } from './useGeolocation'

interface MapBackgroundProps {
  geolocation: GeolocationState
}

/**
 * OpenStreetMap background layer using Leaflet.
 * Centers on ego car position and rotates with heading.
 */
export function MapBackground({ geolocation }: MapBackgroundProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    // Create map centered on default location (will update with GPS)
    const map = L.map(mapContainerRef.current, {
      center: [37.7749, -122.4194], // San Francisco default
      zoom: 18,
      zoomControl: false,
      attributionControl: false,
    })

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'map-tiles',
    }).addTo(map)

    // Create custom ego car marker
    const egoIcon = L.divIcon({
      className: 'ego-car-marker',
      html: `<div style="
        width: 24px;
        height: 24px;
        background: #4f9eff;
        border: 3px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 0 20px rgba(79, 158, 255, 0.6), 0 4px 12px rgba(0, 0, 0, 0.4);
        position: relative;
      ">
        <div style="
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-bottom: 10px solid #4f9eff;
        "></div>
      </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })

    const marker = L.marker([37.7749, -122.4194], { icon: egoIcon }).addTo(map)

    mapRef.current = map
    markerRef.current = marker

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [])

  // Update map position and rotation when GPS changes
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return
    if (geolocation.latitude === null || geolocation.longitude === null) return

    const { latitude, longitude, heading } = geolocation

    // Update marker position
    markerRef.current.setLatLng([latitude, longitude])

    // Center map on ego car with smooth animation
    mapRef.current.setView([latitude, longitude], 18, {
      animate: true,
      duration: 0.5,
    })

    // Rotate map if heading is available
    if (heading !== null && mapRef.current) {
      const mapContainer = mapRef.current.getContainer()
      mapContainer.style.transform = `rotate(${-heading}deg)`
    }
  }, [geolocation])

  return (
    <div className="map-background">
      <div ref={mapContainerRef} className="map-container" />
      
      {geolocation.error && (
        <div className="map-error">
          <span>GPS Error: {geolocation.error}</span>
        </div>
      )}
      
      {geolocation.loading && (
        <div className="map-loading">
          <span>Acquiring GPS location...</span>
        </div>
      )}
      
      {geolocation.accuracy && geolocation.accuracy > 50 && (
        <div className="map-warning">
          <span>Low GPS accuracy: ±{Math.round(geolocation.accuracy)}m</span>
        </div>
      )}
    </div>
  )
}
