import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import * as THREE from 'three'
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
      <color attach="background" args={['#dce2ea']} />
      <fog attach="fog" args={['#d8dde5', 65, 220]} />

      <ambientLight intensity={0.55} />
      <directionalLight
        position={[12, 32, 18]}
        intensity={1.35}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-35}
        shadow-camera-right={35}
        shadow-camera-top={35}
        shadow-camera-bottom={-35}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.0005}
      />
      <directionalLight
        position={[-8, 20, -15]}
        intensity={0.45}
        color="#a8c0e0"
      />
      <hemisphereLight args={['#f5f8fc', '#c5cdd8', 0.65]} />
      <pointLight position={[0, 8, -25]} intensity={1.2} distance={40} decay={2} color="#ffffff" />

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
      dpr={[1, 2]}
      gl={{ 
        antialias: true, 
        alpha: false, 
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.1
      }}
      shadows="soft"
      camera={{ position: [0, 9.5, 18], fov: 42, near: 0.1, far: 300 }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, 0.4, -55)
        gl.shadowMap.enabled = true
        gl.shadowMap.type = THREE.PCFSoftShadowMap
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
