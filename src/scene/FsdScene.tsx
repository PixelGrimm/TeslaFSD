import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { EffectComposer, Bloom, SMAA, Vignette, ToneMapping } from '@react-three/postprocessing'
import { Environment } from '@react-three/drei'
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
      <color attach="background" args={['#d8dce4']} />
      <fog attach="fog" args={['#d8dce4', 60, 220]} />

      {/* Enhanced lighting setup */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[10, 32, 15]}
        intensity={1.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-bias={-0.0001}
      />
      <hemisphereLight args={['#ffffff', '#8a96a4', 0.7]} />
      
      {/* Subtle environment lighting for reflections */}
      <Environment preset="city" />

      <Road lanes={lanes} motion={motion} curbs={curbs} />
      {extras.zebra && (
        <ZebraCrossing zebra={extras.zebra} roadHalfWidth={roadHalf} />
      )}
      <EgoCar motion={motion} />
      {objects.map((obj) => (
        <DetectedObject key={obj.id} obj={obj} />
      ))}
      {speedSign && <SpeedLimitSign sign={speedSign} />}
      
      {/* Post-processing effects */}
      <EffectComposer enableNormalPass={false}>
        <Bloom 
          intensity={0.4} 
          luminanceThreshold={0.85} 
          luminanceSmoothing={0.9}
          mipmapBlur
        />
        <ToneMapping />
        <Vignette offset={0.3} darkness={0.4} />
        <SMAA />
      </EffectComposer>
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
