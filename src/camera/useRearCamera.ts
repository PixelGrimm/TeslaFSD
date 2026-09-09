import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export interface RearCameraState {
  videoRef: RefObject<HTMLVideoElement | null>
  stream: MediaStream | null
  ready: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => void
}

export function useRearCamera(): RearCameraState {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    setStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop())
      return null
    })
    setReady(false)
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    stop()

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera API not available. Use Safari on iPad over HTTPS.')
      throw new Error('Camera API not available')
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      })

      const video = videoRef.current
      if (!video) {
        media.getTracks().forEach((t) => t.stop())
        setError('Video element missing.')
        throw new Error('Video element missing')
      }

      video.srcObject = media
      video.muted = true
      video.playsInline = true
      await video.play()

      await new Promise<void>((resolve) => {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          resolve()
          return
        }
        video.addEventListener('loadeddata', () => resolve(), { once: true })
      })

      setReady(true)
      setStream(media)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not access the rear camera.'
      setError(message)
      setReady(false)
      throw err instanceof Error ? err : new Error(message)
    }
  }, [stop])

  useEffect(() => () => stop(), [stop])

  return { videoRef, stream, ready, error, start, stop }
}
