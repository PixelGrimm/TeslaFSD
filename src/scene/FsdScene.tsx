import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import type { CurbState } from '../vision/curbTypes'
import type { EgoMotion, LaneState, SceneExtras, SpeedLimitSignState, WorldObject } from '../world/types'
import { DetectedObject } from './DetectedObject'
import { EgoCar } from './EgoCar'
import { Road } from './Road'
import { SpeedLimitSign } from './SpeedLimitSign'
import { ZebraCrossing } from './ZebraCrossing'

interface FsdSceneProps {
  objects: WorldObject[]
  lanes: LaneState
  curbs: CurbState
  motion: EgoMotion
  speedSign: SpeedLimitSignState | null
  extras: SceneExtras
}

function SceneContent({ objects, lanes, curbs, motion, speedSign, extras }: FsdSceneProps) {
  const markXs = lanes.marks.map((m) => m.x)
  const roadHalf =
    markXs.length > 1
      ? (Math.max(...markXs) - Math.min(...markXs)) / 2
      : curbs.roadHalfWidth

  return (
    <>
      <color attach="background" args={['#e4e6ea']} />
      <fog attach="fog" args={['#e4e6ea', 70, 200]} />

      <ambientLight intensity={0.75} />
      <directionalLight
        position={[8, 28, 12]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <hemisphereLight args={['#f2f4f7', '#b8bcc4', 0.55]} />

      <Road lanes={lanes} motion={motion} curbs={curbs} />
      {extras.zebra && (
        <ZebraCrossing zebra={extras.zebra} roadHalfWidth={roadHalf} />
      )}
      <EgoCar motion={motion} />
      {objects.map((obj) => (
        <DetectedObject key={obj.id} obj={obj} />
      ))}
      {speedSign && <SpeedLimitSign sign={speedSign} />}
    </>
  )
}

export function FsdScene({ objects, lanes, curbs, motion, speedSign, extras }: FsdSceneProps) {
  return (
    <Canvas
      className="fsd-canvas"
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      shadows
      camera={{ position: [0, 9.5, 18], fov: 42, near: 0.1, far: 280 }}
      onCreated={({ camera }) => {
        camera.lookAt(0, 0.4, -55)
      }}
    >
      <Suspense fallback={null}>
        <SceneContent
          objects={objects}
          lanes={lanes}
          curbs={curbs}
          motion={motion}
          speedSign={speedSign}
          extras={extras}
        />
      </Suspense>
    </Canvas>
  )
}
