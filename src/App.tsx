import { useCallback, useEffect, useState } from 'react'
import { useRearCamera } from './camera/useRearCamera'
import { FsdScene } from './scene/FsdScene'
import { CameraOverlay } from './ui/CameraOverlay'
import { DashboardShell } from './ui/DashboardShell'
import { Onboarding } from './ui/Onboarding'
import { useWorldState } from './world/useWorldState'
import './styles/tesla.css'

export default function App() {
  const { videoRef, ready: cameraReady, error: cameraError, start, stop } = useRearCamera()
  const [started, setStarted] = useState(false)
  const [starting, setStarting] = useState(false)
  const [showPip, setShowPip] = useState(true)
  const [showLanes, setShowLanes] = useState(true)

  const { objects, lanes, curbs, extras, motion, overlay, speedLimit, speedSign, modelReady, modelError } =
    useWorldState(videoRef, started && cameraReady)

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        const lock = await navigator.wakeLock.request('screen')
        lock.addEventListener('release', () => {})
      }
    } catch {
      // Unsupported or denied — ignore.
    }
  }, [])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && started) void requestWakeLock()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [started, requestWakeLock])

  useEffect(() => () => stop(), [stop])

  const handleStart = async () => {
    setStarting(true)
    try {
      await start()
      await requestWakeLock()
      setStarted(true)
    } catch {
      // Error message is set on the camera hook for the onboarding screen.
    } finally {
      setStarting(false)
    }
  }

  return (
    <>
      <div className={`camera-pip-wrap ${started && showPip ? 'visible' : ''}`}>
        <video
          ref={videoRef}
          className="camera-pip-video"
          playsInline
          muted
          autoPlay
          style={
            started
              ? undefined
              : { position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }
          }
        />
        {started && (
          <CameraOverlay
            videoRef={videoRef}
            overlay={overlay}
            motion={motion}
            visible={showPip}
          />
        )}
      </div>

      {!started ? (
        <Onboarding
          modelReady={modelReady}
          modelError={modelError}
          cameraError={cameraError}
          onStart={handleStart}
          starting={starting}
        />
      ) : (
        <DashboardShell
          speedLimit={speedLimit}
          showPip={showPip}
          onTogglePip={() => setShowPip((v) => !v)}
          showLanes={showLanes}
          onToggleLanes={() => setShowLanes((v) => !v)}
        >
          {cameraError && <div className="runtime-error">{cameraError}</div>}
          <FsdScene
            objects={objects}
            lanes={showLanes ? lanes : { ...lanes, marks: [] }}
            curbs={curbs}
            motion={motion}
            speedSign={speedSign}
            extras={extras}
          />
        </DashboardShell>
      )}
    </>
  )
}
