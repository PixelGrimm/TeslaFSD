import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
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
      <color attach="background" args={['#c8d0dc']} />
      <fog attach="fog" args={['#d0d8e4', 50, 200]} />

      {/* Optimized lighting for mobile performance */}
      <ambientLight intensity={0.8} />
      <directionalLight
        position={[10, 32, 15]}
        intensity={1.5}
      />
      <hemisphereLight args={['#ffffff', '#8a96a4', 0.6]} />

      <Road lanes={lanes} motion={motion} curbs={curbs} />
      {extras.zebra && (
        <ZebraCrossing zebra={extras.zebra} roadHalfWidth={roadHalf} />
      )}
      <EgoCar motion={motion} />
      {objects.map((obj) => (
        <DetectedObject key={obj.id} obj={obj} />
      ))}
      {speedSign && <SpeedLimitSign sign={speedSign} />}
      
      {/* Lightweight post-processing for mobile performance */}
      {typeof window !== 'undefined' && window.innerWidth > 768 && (
        <EffectComposer enableNormalPass={false}>
          <Bloom 
            intensity={0.3} 
            luminanceThreshold={0.9} 
            luminanceSmoothing={0.85}
          />
          <Vignette offset={0.4} darkness={0.3} />
        </EffectComposer>
      )}
    </>
  )
}

export function FsdScene({ objects, lanes, curbs, motion, speedSign, extras }: FsdSceneProps) {
  return (
    <Canvas
      className="fsd-canvas"
      dpr={[1, 1.5]}
      gl={{ 
        antialias: false, 
        alpha: false, 
        powerPreference: 'high-performance',
        stencil: false,
        depth: true
      }}
      shadows={false}
      camera={{ position: [0, 9.5, 18], fov: 42, near: 0.1, far: 280 }}
      onCreated={({ camera }) => {
        camera.lookAt(0, 0.4, -55)
      }}
      performance={{ min: 0.5 }}
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
